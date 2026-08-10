---
description: Initialize ADR documentation scaffolding for this project
---
Set up an Architecture Decision Record system for this project.

Process:
1. Review the project context:
   - README files
   - existing `docs/`
   - `AGENTS.md` / `CLAUDE.md`
   - notable architecture or design notes
2. If ADR docs already exist, summarize the current structure and propose improvements instead of overwriting.
3. If ADR docs do not exist, create:
   - `docs/README.md`
   - `docs/adrs/`
   - `docs/adrs/0001-record-architecture-decisions.md`
4. Use this ADR structure:
   - `# NNNN: Title`
   - `## Status`
   - `## Context`
   - `## Decision`
   - `## Consequences`
   - `## Related`
5. Use `Accepted` for the initial ADR that establishes ADR usage.
6. Keep the initial docs lightweight and project-agnostic unless the project context clearly suggests specific conventions.
7. Summarize what was created and how to add the next ADR.
