---
name: skill-authoring
description: Write, revise, or review an agent skill (a SKILL.md with optional references/, scripts/, assets/). Use when the user wants to create a new skill, turn a workflow or project guidance into a reusable skill, consolidate scattered agent instructions, improve a skill's triggering description, or tighten an existing skill that is too long, vague, or ignored, even if they just say "make this reusable for agents" or "formalize this guidance".
---

# Skill Authoring

A skill is only worth its context cost if it changes what the agent does. Every
line must correct a mistake the agent would otherwise make or supply a fact it
cannot know.

## Workflow

Progress:
- [ ] 1. Gather source material
- [ ] 2. Define scope and trigger
- [ ] 3. Draft SKILL.md
- [ ] 4. Self-review against the checklist below
- [ ] 5. Run on a real task, read the trace, revise
- [ ] 6. Install

### 1. Gather source material

Do not write a skill from general knowledge; the result is generic advice the
agent already follows. Before drafting, collect project-specific material:

- Existing guidance: AGENTS.md / CLAUDE.md sections, other skills, READMEs, ADRs, runbooks
- Corrections the user made in past sessions (search the knowledge base or session history when available)
- Real inputs and outputs: file layouts, naming schemes, tool calls that worked
- Failures and their fixes: issues, review comments, fix commits

When consolidating guidance from several projects, list where they agree,
where they conflict, and what is project-specific. Put the shared
method in the skill, leave project-specific rules (palettes, file names, domain terms)
in each project, and ask the user to resolve real conflicts instead of picking silently.

### 2. Define scope and trigger

Scope the skill like a function: one coherent unit of work. Too narrow forces
several skills to load together; too broad makes activation imprecise. If it
covers two jobs that are rarely done together, split it.

Write the `description` before the body. It is the only part the agent sees
when deciding whether to load the skill.

- Say what it does, then "Use when…" with the user intents that should trigger it
- Name the intent, not the mechanics; include phrasings where the user does not name the domain ("even if they don't mention X")
- Be slightly pushy: under-triggering is the more common failure
- Exclude near-misses explicitly if a neighbouring skill owns them
- Max 1024 characters; aim for 2–4 sentences

### 3. Draft SKILL.md

Frontmatter (required fields only unless needed):

```yaml
---
name: lowercase-hyphenated   # 1-64 chars, a-z 0-9 -, no leading/trailing/double hyphen, matches directory name
description: …
---
```

Optional: `license`, `compatibility` (only for real environment requirements),
`metadata` (string→string), `allowed-tools` (experimental).

Body guidance:

- **Omit what the agent knows.** No explanations of common tools, formats, or concepts. For each line ask: "Would the agent get this wrong without this?" If not, cut it.
- **Procedures over declarations.** Teach the method for the class of task, not the answer for one instance. Specific details (commands, names, constraints) are fine inside a general method.
- **Defaults, not menus.** Pick one approach; mention an alternative only with its condition ("For scanned PDFs, use X instead").
- **Match strictness to fragility.** Explain the *why* where judgement applies. Give exact commands and "do not modify" where order, consistency, or destructive operations matter. Calibrate each section independently.
- **Moderate detail.** Concise steps plus one working example usually beat exhaustive coverage. Leave rare edge cases to the agent's judgement.

Use these patterns when they fit:

- **Gotchas**: the most valuable section in most skills. List concrete facts that defy reasonable assumptions (quirky APIs, misleading names, silent failures). Keep them in SKILL.md, not a reference file, so the agent reads them before hitting the problem.
- **Checklist**: for multi-step workflows with dependencies or gates.
- **Validation loop**: do → validate (script, screenshot, reference checklist) → fix → repeat until it passes.
- **Plan-validate-execute**: for batch or destructive work, write a structured plan, check it against the source of truth, then execute.
- **Templates**: when output has a fixed shape, show a concrete template instead of describing it in prose.
- **Scripts**: when the agent rebuilds the same logic each run, write a tested script in `scripts/` with clear error messages.

### Size and progressive disclosure

- Keep SKILL.md under ~500 lines / ~5,000 tokens; it loads in full on activation.
- Move bulky or situational material to `references/`, `assets/`, or `scripts/`, one level deep, linked by relative path.
- State **when** to load each file: "Read `references/errors.md` if the API returns a non-200 status", not "see references/ for more".

## Self-review checklist

- [ ] `name` is valid and matches the directory
- [ ] Description states what + when, covers indirect phrasings, ≤1024 chars
- [ ] Every section passes the "would the agent get this wrong?" test
- [ ] Grounded in sourced, specific material; no generic best-practice filler
- [ ] Each choice point has a default
- [ ] Fragile steps are exact; flexible steps explain why
- [ ] Gotchas are in SKILL.md
- [ ] Every reference file has an explicit load condition
- [ ] Under ~500 lines
- [ ] Project-specific rules stay in the projects unless the skill is project-scoped

## Refine with real execution

A first draft is a hypothesis. Run it against a real task (or ask the user to)
and read the execution trace, not only the final output:

- Agent tried several approaches → instruction too vague, or no default
- Agent followed an instruction that didn't apply → scope too broad or the condition is missing
- Agent ignored the skill → description doesn't match how the user asks
- User corrected the agent → add the correction to Gotchas

For triggering, draft ~10 should-trigger prompts (varied phrasing, some indirect)
and ~10 near-miss should-not-trigger prompts that share keywords but need
something else. Revise the description against them.

## Install

Default for reusable personal skills: create `skills/<name>/` in the dot-kit
repository and add `skills/<name>` to the right file in `profiles/` (`common`
for everything, `work` for work-only). Do not run `install.sh` unless asked.

For a skill tied to one project, create it at `<project>/.agents/skills/<name>/SKILL.md` instead.
