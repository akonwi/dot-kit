---
name: figma
description: Inspect Figma designs and turn them into implementation-ready UI requirements. Use when the user asks to review a Figma screen, flow, component, prototype, or design handoff; extract visual details; compare implementation against Figma; or identify missing states and responsive behavior.
---

# Figma design inspection

Use the configured Figma MCP server through Kit's `mcp` tool. Do not scrape Figma pages or infer implementation details from a URL alone.

## Workflow

1. Clarify the target screen, flow, component, or frame when it is not clear from the request.
2. Discover or inspect the relevant Figma MCP tools before calling unfamiliar operations.
3. Gather enough design context to understand:
   - frame and component hierarchy;
   - layout constraints, spacing, sizing, and alignment;
   - typography, color, borders, elevation, and reusable tokens;
   - component variants and reusable assets;
   - hover, focus, disabled, loading, empty, success, and error states;
   - prototype interactions and transitions;
   - responsive behavior and breakpoint differences.
4. Compare related frames and variants rather than treating one screenshot as the complete specification.
5. Call out ambiguities, missing states, inaccessible patterns, and implementation risks instead of guessing.

## Output

Return concise, implementation-ready guidance using this structure when useful:

- **Design target** — screen, flow, frame, and intended user outcome
- **Structure** — hierarchy and component boundaries
- **Visual requirements** — spacing, dimensions, typography, color, and tokens
- **States and interactions** — checklist of required behavior
- **Responsive behavior** — known adaptations and assumptions
- **Assets and reuse** — existing components, icons, and styles to reuse
- **Open questions** — missing or ambiguous design decisions

Cite frame or component names when available. Avoid editing code unless the user explicitly asks for implementation.
