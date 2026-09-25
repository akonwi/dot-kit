"""Offline protocol smoke tests: python3 -m unittest discover -s plugins/git."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import unittest


class CIPluginTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kit-ci-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text("#!/usr/bin/env python3\n"
                      "import json,time\nfrom pathlib import Path\n"
                      "assert __import__('sys').argv[1:] == ['pr','checks','--json','bucket']\n"
                      "data=json.loads(Path('checks.json').read_text())\n"
                      "time.sleep(data.get('delay',0))\n"
                      "print(data['output'])\nraise SystemExit(data['exit'])\n")
        gh.chmod(0o700)
        git = bin_dir / "git"
        git.write_text("#!/bin/sh\nprintf '# branch.head fixture\\n'\n")
        git.chmod(0o700)
        self.frames = queue.Queue()
        self.process = subprocess.Popen(
            [shutil.which("bun"), str(Path(__file__).with_name("plugin.ts").resolve())],
            cwd=self.project,
            env={**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.close)
        def read():
            for line in self.process.stdout:
                try:
                    self.frames.put(json.loads(line))
                except ValueError:
                    self.frames.put({"invalid_stdout": line})
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        self.reader.join(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()

    def send(self, frame):
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", **frame}) + "\n")
        self.process.stdin.flush()

    def fixture(self, output, status=0, project=None, delay=0):
        (project or self.project).joinpath("checks.json").write_text(json.dumps(
            {"output": output, "exit": status, "delay": delay}))

    def receive(self):
        frame = self.frames.get(timeout=5)
        self.assertEqual(frame.get("jsonrpc"), "2.0", frame)
        if "method" in frame:
            self.assertIn(frame["method"], ["kit/footer/set", "kit/footer/clear"])
            self.assertEqual(frame["params"]["id"], "ci")
            self.assertNotIn("clickable", frame["params"])
            self.send({"id": frame["id"], "result": None})
        return frame

    def initialize(self):
        self.send({"id": 1, "method": "initialize", "params": {
            "protocolVersion": 1,
            "context": {"project": {"cwd": str(self.project), "git": {"branch": "fixture"}}}}})
        self.assertEqual(self.receive()["result"], {"protocolVersion": 1})
        self.assertEqual(self.receive()["method"], "kit/footer/clear")

    def changed(self, project=None, branch="fixture"):
        self.send({"method": "kit/events/project.changed", "params": {
            "cwd": str(project or self.project), "git": {"branch": branch}}})
        self.assertEqual(self.receive()["method"], "kit/footer/clear")

    def shutdown(self):
        self.send({"id": 99, "method": "shutdown"})
        self.assertEqual(self.receive(), {"jsonrpc": "2.0", "id": 99, "result": None})
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.assertEqual(self.process.stderr.read(), "")

    def test_status_updates_and_missing_data(self):
        self.fixture('[{"bucket":"pass"}]')
        self.initialize()
        self.assertEqual(self.receive()["params"]["content"][0]["text"], "CI pass 1/1")
        for output, status, text, color in [
            ('[{"bucket":"fail"},{"bucket":"pass"}]', 1, 'CI fail 1/2', 'errorText'),
            ('[{"bucket":"pending"}]', 8, 'CI pending 1/1', 'warningText'),
            ('[{"bucket":"cancel"}]', 1, 'CI canceled 1/1', 'errorText'),
            ('[{"bucket":"skipping"}]', 0, 'CI skipped 1/1', 'textMuted'),
            ('[]', 0, 'CI none', 'textMuted'),
        ]:
            self.fixture(output, status)
            self.changed()
            content = self.receive()["params"]["content"]
            self.assertEqual(content, [{"text": text, "style": {"fg": color}}])
        for output, status in [('no pull request', 1), ('not json', 0), ('[]', 4)]:
            self.fixture(output, status)
            self.changed()
            self.assertEqual(self.receive()["method"], "kit/footer/clear")
        self.changed(branch=None)
        self.assertEqual(self.receive()["method"], "kit/footer/clear")
        self.shutdown()

    def test_project_change_discards_old_checks(self):
        self.fixture('[{"bucket":"fail"}]', 1, delay=0.3)
        self.initialize()
        second = self.root / "second"
        second.mkdir()
        self.fixture('[{"bucket":"pass"}]', project=second)
        self.changed(second)
        self.assertEqual(self.receive()["params"]["content"][0]["text"], "CI pass 1/1")
        # An older response must not restore the previous project's CI status.
        with self.assertRaises(queue.Empty):
            self.frames.get(timeout=0.6)
        self.shutdown()


if __name__ == "__main__":
    unittest.main()
