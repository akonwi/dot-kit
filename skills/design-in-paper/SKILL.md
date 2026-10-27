---
name: design-in-paper
description: Design UI in Paper (the Paper MCP canvas) before building it, then implement and verify the code against the canvas. Use whenever designing, redesigning, or visibly changing UI in a project that has a Paper file; when the user asks for mockups, options, explorations, states, or a design direction; when they mention Paper, artboards, or the canvas; when implementing a screen "from the design"; or when answering Paper comments, even if they never say "Paper". Not for Figma files.
---

# Design in Paper

Paper is the source of truth for how the UI looks; code follows it. Any new or
visibly changed UI is explored and decided on the canvas before code is
written. A project's own guidance (AGENTS.md, a design-language skill such as
`mica-design`) overrides this skill where they conflict.

## Before the first Paper call

1. Call `get_guide({ topic: "paper-mcp-instructions" })` once per session. It
   covers small `write_html` calls, screenshot review checkpoints and
   `finish_working_on_nodes`; follow it. Its aesthetic advice (mood brief,
   palette, expressive type) applies only to greenfield work. When the
   project has tokens or a design-language skill, use those and skip the
   mood brief.
2. Find the project's file with `list_resources`. Files are named after the
   project, sometimes with a qualifier (`Kit App`, `Ranger · iOS`). If no
   file or several files match, ask. Never rely on the default file: several
   files are open at once, and the default is whichever one the user last viewed.
3. Pass `fileId` on every call and `pageId` on page-scoped calls. The active
   page can change while you work. Check the file name in each response
   header.
4. Read before drawing: `get_basic_info` (pages, artboards, tokens), the
   artboards for the area you're changing, the project's design-language
   guidance, and the code that ships today.

## Workflow

```
- [ ] 1. Frame the question
- [ ] 2. Explore options on the canvas
- [ ] 3. Get a decision
- [ ] 4. Fold it into the canonical artboards
- [ ] 5. Implement from the canvas
- [ ] 6. Verify code against the canvas (loop until it matches)
- [ ] 7. Close out
```

**1. Frame.** State the question in one sentence and name what it touches:
screens, components, tokens, code.

**2. Explore.** On the Explorations page, create one `Explore · <topic>`
artboard per question. Inside it put options side by side: what ships today
first, then A, B, C… with genuinely different approaches. Show each option
in every scheme the project supports and across its full state set. Put the
key numbers on the canvas (sizes, contrast) instead of explaining in chat.
When redesigning existing UI, capture what ships on the Reference page
first.

**3. Decide.** Ask with `select_from_user` or `guided_questions`. Give the
trade-offs in plain terms and recommend one when you have a reason. If the user
is confused, make the canvas clearer instead of adding prose.
- A cancelled question means ask again, not "first option".
- Feedback is not a decision. "Looks good", "yes" or "proceed" after a
  review is sign-off.

**4. Spec.** Update the feature page's canonical artboards to the chosen
option, for every scheme and state. Rename the exploration
`Decided · <topic> → <choice>`, mark the winner on it, and add a line to
the feature's Notes card. Don't delete explorations. Screenshot, review
against the checkpoints, and get sign-off.

**5. Implement.** Take exact values from `get_jsx` (with
`includeNodeIds: false`) and `get_computed_styles`, never from screenshots.
Translate them into the codebase's conventions and tokens. If another
session implements the design, hand off the file name, page and artboard
names, and the decisions. Don't hand off node IDs.

**6. Verify.** Run the real UI and compare it with the artboards: layout and
copy visually, and sizes, spacing and colors against the computed styles.
- Code differs from the canvas → fix the code and compare again.
- The platform can't do what the canvas shows, or the built result looks
  better → ask the user, then update the canvas so it matches what ships.

**7. Close out.** Call `finish_working_on_nodes`. Resolve any Paper comments
you addressed. Record behavior the canvas can't show (timing, focus,
lifecycle) in the project's docs, not on the canvas.

**Changes that start in code.** If a fix or refactor changes how something
looks, go back to step 2. If it doesn't but leaves an artboard
inaccurate, update the artboard in the same session.

## File structure

One file per project; for each extra platform, a separate file named
`<Project> · <Platform>`. Pages run from the system, through the product, to
the workbench, with dividers between the groups (`arrange_pages`):

```
Overview            flow map of the product
──────────
Foundations         tokens, themes, type, color roles
Components          shared pieces reused across features
──────────
<Feature>           one page per feature or area: the canonical spec
<Feature>           …
──────────
Explorations        the scratch pad: open and decided questions
Reference           screenshots of what ships, outside references
```

- **Overview:** the main journey, laid out left to right in the order the
  user meets it. Artboards are named `<Screen> · <State>`
  (`First run · Connect a provider`). One state per step, in the project's
  default scheme; full state sets
  live on the feature pages. A component library has no Overview and starts
  at Foundations.
- **Foundations and Components:** a component library splits Components
  into tiers instead (Mica: Atoms, Compounds, Navigation, Overlays). A file
  built on a shared design system holds only its own additions in
  Foundations and names the system file. Skip a page until it has content.
- **Feature pages:** named after the feature (`Servers`, `Session tabs`),
  with no versions or status (`v2`, `new`, `WIP`). They contain only
  canonical artboards, which show current truth: no options, "was/now",
  "fixed in" or commit hashes.
- **Explorations:** every open question is an `Explore · <topic>` artboard
  here, never on a feature page. Once decided it is renamed
  `Decided · <topic> → <choice>` and stays as the record. A canonical
  artboard replaced by a redesign moves here as `Superseded · <name>`.
  New artboards go at the right end of the row.
- **Reference:** what ships today and outside inspiration. Never treat it
  as a spec.
- **Page icons:** don't set them; dividers do the grouping.

**Every page except Explorations and Reference** has a `Notes · <page>`
artboard at the far left (520 wide, `height: fit-content`). It holds what
the page covers, the decisions with their dates ("Tab overflow: chevrons
over a menu · Oct 20"), open questions, and the code and doc paths it
maps to.

**Within a page:**
- Name artboards general to specific, separated by ` · `:
  `<Screen> · <Light|Dark> · <State>` (`Household · Dark · Load error`).
  If the project supports only one scheme, leave that segment out. Don't
  number artboards (`1 ·`, `S7 ·`, `2b ·`). Order comes from position on
  the canvas, and numbers go stale when artboards are added or removed.
- Give each screen a band: the Light row with the Dark row directly below,
  states left to right in the order the user meets them. Leave 80px
  between artboards and 160px between rows.
- **Frames:** iPhone 402×874; desktop 1440×900; sheets and settings panes
  at their real size. Spec and documentation artboards use
  `height: fit-content`.

In an existing file that doesn't follow this structure, put new work where
the structure says. Don't move or rename existing pages unless the user
asks.

## Canvas conventions

- **States:** draw everything the code must handle: default, empty, loading,
  first-load error, stale or offline, long content, menus and swipes,
  destructive confirmations.
- **Schemes:** Paper has no modes, so tokens come in twins (`--dark-*`, or
  `--light-*` when dark is the base). Bind every value to a token. Build
  both schemes from the same HTML with the prefix swapped; never restyle a
  duplicate by hand.
- **Refer to artboards by name:** never store node IDs in docs or code, and
  never show them to the user.

## Gotchas

- Unsupported CSS fails silently or drops the node:

  | Avoid | Use |
  |---|---|
  | `margin` | parent padding or `gap` |
  | `transform`, negative offsets | absolute positioning with fixed offsets |
  | `calc()`, `color-mix()` between colors | precomputed values or a derived token |
  | `outline` | `box-shadow: 0 0 0 2px <surface>, 0 0 0 4px <ring>` |
  | `border` shorthand plus `border-*-width` | longhands only |
  | `var()` in `border-width` | a literal px value |
  | mixed styling in one text node | separate text nodes in a flex-wrap row |

- Flex-wrap frames need `align-content: flex-start`. Absolute children need
  `position: relative` on the parent.
- Paper's list bullet glyph is too small. Draw list markers as 6px circles.
- In `write_html`, escape `<` and `>` in text, keep double quotes out of
  `layer-name`, and collapse whitespace between tags.
- `create_artboard` ignores `left`/`top`; set them afterwards with
  `update_styles`. `duplicate_nodes` puts a copied artboard wherever there's
  space, so move it into its row.
- Parallel writes into one parent can land out of order. Check with
  `get_children` and fix with `move_nodes`.
- A screenshot taken right after a write can miss the new node, so take it
  again before judging. Review at scale 1 or higher, because downscaled shots
  hide thin rules and small text.
- `get_children` fails on some IDs. `get_node_info` still returns
  `childIds`.
- SVG `stroke`/`fill` set as literals can't be re-themed later. Write icons
  with `var(--token)` from the start.
- Before renaming or revaluing a token, run `find_nodes` with
  `styleValue: "--token"` and with `textValue: "*token*"`. Bindings follow a
  `set_tokens` rename, but text that mentions the token doesn't.
- Paper has no reply tool for comments. Answer in chat, update the canvas,
  then call `set_comment_thread_status` with `resolved`.
