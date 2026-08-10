#!/usr/bin/env python3
"""Ask before risky tool calls in explicitly enabled projects."""

import json
import os
import re
import sys
import threading
from pathlib import Path

MAX_FRAME_BYTES = 16 * 1024 * 1024
RISKY_PATTERNS = (r"\bgit\s+commit\b", r"\bnpm\s+publish\b")
TOGGLE_COMMAND_ID = "toggle-tool-approval"
CONFIG_PATH = Path(__file__).with_name("config.json")


def normalize_project(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


class Endpoint:
    def __init__(self):
        self.write_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.pending = {}
        self.sequence = 0
        self.stopping = threading.Event()
        self.current_project = None
        self.enabled_projects = self.load_config()

    def load_config(self):
        if not CONFIG_PATH.exists():
            return set()
        config = json.loads(CONFIG_PATH.read_text())
        projects = config.get("enabledProjects")
        if not isinstance(projects, list) or not all(
            isinstance(project, str) and project for project in projects
        ):
            raise ValueError("config.json enabledProjects must be an array of paths")
        return {normalize_project(project) for project in projects}

    def save_config(self):
        with self.state_lock:
            projects = sorted(self.enabled_projects)
        temporary_path = CONFIG_PATH.with_suffix(".json.tmp")
        temporary_path.write_text(
            json.dumps({"enabledProjects": projects}, indent=2) + "\n"
        )
        temporary_path.replace(CONFIG_PATH)

    def send(self, message):
        data = json.dumps(message, separators=(",", ":"))
        if len(data.encode()) > MAX_FRAME_BYTES:
            raise RuntimeError("Outbound frame exceeds 16 MiB")
        with self.write_lock:
            sys.stdout.write(data + "\n")
            sys.stdout.flush()

    def request(self, method, params=None):
        event, result = threading.Event(), {}
        with self.state_lock:
            self.sequence += 1
            request_id = f"plugin-{self.sequence}"
            self.pending[request_id] = (event, result)
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        self.send(message)
        event.wait()
        if "error" in result:
            raise RuntimeError(result["error"].get("message", "Kit request failed"))
        return result.get("result")

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def set_current_project(self, project):
        cwd = project.get("cwd") if isinstance(project, dict) else None
        if not isinstance(cwd, str) or not cwd:
            return
        with self.state_lock:
            self.current_project = normalize_project(cwd)

    def is_enabled(self):
        with self.state_lock:
            return self.current_project in self.enabled_projects

    def toggle_current_project(self):
        with self.state_lock:
            project = self.current_project
            if project is None:
                raise RuntimeError("No active project")
            enabled = project not in self.enabled_projects
            if enabled:
                self.enabled_projects.add(project)
            else:
                self.enabled_projects.remove(project)
        self.save_config()
        self.notify(
            "kit/ui/toast",
            {
                "title": f"Tool approval {'enabled' if enabled else 'disabled'}",
                "subtitle": project,
                "variant": "info",
            },
        )

    def approve(self, tool_call):
        if not self.is_enabled():
            return {"action": "allow"}

        command = tool_call.get("input", {}).get("command", "")
        risky = (
            tool_call.get("name") == "bash"
            and isinstance(command, str)
            and any(re.search(pattern, command) for pattern in RISKY_PATTERNS)
        )
        if not risky:
            return {"action": "allow"}

        approved = self.request(
            "kit/ui/confirm",
            {
                "title": f"Allow {tool_call['name']}?",
                "message": command or "(no command)",
                "confirmLabel": "Allow",
                "cancelLabel": "Block",
                "defaultValue": False,
            },
        )
        if approved:
            return {"action": "allow"}
        return {
            "action": "reject-and-continue",
            "message": f"The user rejected {tool_call['name']}.",
        }

    def handle_notification(self, method, params):
        if method == "kit/events/project.changed":
            self.set_current_project(params)

    def handle(self, message):
        if "method" not in message:
            with self.state_lock:
                pending = self.pending.pop(message.get("id"), None)
            if pending:
                pending[1].update(message)
                pending[0].set()
            return

        method = message["method"]
        params = message.get("params", {})
        if "id" not in message:
            self.handle_notification(method, params)
            return

        try:
            if method == "initialize":
                if params.get("protocolVersion") != 1:
                    raise ValueError("Unsupported protocol version")
                self.set_current_project(params.get("context", {}).get("project", {}))
                result = {"protocolVersion": 1}
            elif method == "shutdown":
                result = None
                self.stopping.set()
            elif method == "kit/commands/execute":
                if params.get("id") != TOGGLE_COMMAND_ID:
                    raise KeyError("Method not found")
                self.toggle_current_project()
                result = None
            elif method == "kit/tool-calls/before-execute":
                result = self.approve(params["toolCall"])
            else:
                raise KeyError("Method not found")

            self.send({"jsonrpc": "2.0", "id": message["id"], "result": result})
            if method == "initialize":
                self.request(
                    "kit/commands/register",
                    {
                        "id": TOGGLE_COMMAND_ID,
                        "description": "Toggle tool approval for the current project",
                        "category": "Tool Approval",
                    },
                )
                self.request("kit/tool-calls/register-interceptor")
        except KeyError as error:
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": -32601, "message": str(error)},
                }
            )
        except Exception as error:
            print(error, file=sys.stderr)
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {"code": -32000, "message": str(error)},
                }
            )

    def run(self):
        for line in sys.stdin:
            if len(line.encode()) > MAX_FRAME_BYTES:
                break
            if not line.strip():
                continue
            try:
                frame = json.loads(line)
                for message in frame if isinstance(frame, list) else [frame]:
                    if message.get("method") == "shutdown" or "id" not in message:
                        self.handle(message)
                    else:
                        threading.Thread(
                            target=self.handle,
                            args=(message,),
                            daemon=True,
                        ).start()
            except Exception as error:
                print(error, file=sys.stderr)
            if self.stopping.is_set():
                break


Endpoint().run()
