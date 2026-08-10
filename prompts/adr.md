---
description: Start or iterate on an Architecture Decision Record
---
We need to start or work on an ADR for: $@

Process:
1. Check whether this project has ADR scaffolding:
   - `docs/README.md`
   - `docs/adrs/`
2. If ADR scaffolding is missing, stop and recommend running `/init-adrs` first.
3. Review existing `docs/adrs/` records to match local conventions.
4. If the ADR topic is unclear, ask concise clarifying questions before writing.
5. Determine the next ADR number from `docs/adrs/NNNN-*.md`.
6. Propose a short kebab-case filename: `docs/adrs/NNNN-topic.md`.
7. Draft the ADR using the local structure, usually:
   - `# NNNN: Title`
   - `## Status`
   - `## Context`
   - `## Decision`
   - `## Consequences`
   - `## Related`
8. Use `Proposed` status unless I explicitly say the decision is accepted.
9. Keep the ADR focused on durable architecture/design decisions, not implementation minutiae.
10. Link related ADRs/docs when relevant.
11. After drafting, summarize open questions and ask whether to revise, accept, or leave as proposed.
