# Editor Syntax Highlighting — Design

## Goal

Add lightweight Markdown syntax highlighting to the editor pane (the left/right `<textarea>`) so the source view gains visual structure: headings, emphasis, code, links, lists, blockquotes, and fenced code blocks all render with distinct colors. The preview pane is unaffected — this is purely about making the writing surface easier to scan.

## Scope

In:
- ATX headings (`#`–`######`)
- `**strong**`, `*em*`, `` `inline code` ``
- Inline links `[text](url)`
- Unordered list markers (`-`, `*`, `+`) and ordered (`1.`)
- Blockquote lines (`>`)
- Fenced code blocks (`` ``` ``) — the block region is tinted, but the contents are not language-aware (no nested syntax highlighting inside)
- Light + dark palettes
- Config flag `editor.syntax_highlighting` (default `true`)

Out (deliberate non-goals):
- Setext headings (`===`/`---` underlines)
- Reference-style links, autolinks (`<https://…>`), inline HTML
- Nested-emphasis correctness (visual hint only — not a parser)
- Tables, footnotes, definition lists
- Language-aware highlighting inside code fences
- Incremental tokenization, web workers, virtualization

## Approach: overlay technique

The editor stays a real `<textarea>`. A `<pre>` element is positioned absolutely behind it with the same content, syntax-highlighted via wrapped `<span class="tok-…">` nodes. The textarea itself gets `color: transparent; background: transparent; caret-color: var(--editor-fg);` so only its caret and native selection are visible — everything else shows through from the layer below.

Why this approach:
- Preserves the textarea, so `editor.ts`, `scroll-sync.ts`, cursor tracking, drag-and-drop, IME, undo, and `selectionchange` all keep working unchanged.
- Tiny code addition. No new dependencies.
- Smallest deviation from the project's "minimal" character.

Risks:
- Any drift in font metrics, padding, line-height, `tab-size`, or `white-space` between the textarea and the `<pre>` causes visible misalignment. Both layers must use exactly the same values, sourced from one block of CSS rules.

## DOM & CSS

`src/index.html` — wrap the existing textarea, add the highlight `<pre>` as a sibling rendered behind it:

```html
<div class="pane editor-pane" id="editor-pane">
  <div class="editor-stack">
    <pre class="editor-highlight" id="editor-highlight" aria-hidden="true"></pre>
    <textarea id="editor" spellcheck="false" class="wrap"></textarea>
  </div>
</div>
```

CSS rules in `src/styles/app.css`:

- `.editor-stack` — `position: relative; flex: 1; display: flex;` so the textarea continues to flex-fill the pane the same way it does today.
- `.editor-highlight` — absolutely positioned over the same area as the textarea, `pointer-events: none; overflow: hidden; margin: 0;`. Same `font-family`, `font-size`, `line-height`, `padding`, `tab-size`, and wrap mode (`white-space: pre-wrap; word-break: break-word;` when `.wrap`, `white-space: pre;` when `.nowrap`) as the textarea.
- `#editor` — keeps its current geometry rules, plus `position: relative; z-index: 1; color: transparent; background: transparent; caret-color: var(--editor-fg);`.
- `.editor-highlight` `z-index: 0`, sits beneath the textarea.
- A trailing newline in the source needs a mirrored extra blank line in the highlight layer; the renderer appends a single space after a final `\n` so the last empty line takes vertical space.

### Selection visibility

The textarea's native selection highlight remains visible (it's drawn by the browser regardless of `color: transparent`). No styling change is needed for selection.

## Tokenizer (`src/highlight.ts`)

Public API:

```ts
export function renderHighlight(source: string): string;
```

Returns an HTML string ready to set as `innerHTML` on the highlight `<pre>`. All `<`, `>`, `&`, `"` in source text are escaped.

Single pass over lines, tracking one bit of state (`inFence: boolean`).

### Block-level dispatch (per line)

1. If the line matches `^\s*```[\w-]*\s*$`: toggle `inFence`. Wrap the whole line as `<span class="tok-codeblock"><span class="tok-markup">…</span></span>`.
2. While `inFence`: emit `<span class="tok-codeblock">…</span>` for the line content (escaped, no inline parsing).
3. Otherwise classify:
   - `^(#{1,6}) (.*)$` → heading. Wrap the level marker as `tok-markup`, run the rest through the inline tokenizer wrapped in `tok-heading`. All levels share one style; level number doesn't drive any visual difference.
   - `^(\s*)> (.*)$` → blockquote. Marker `>` is `tok-markup`, rest goes through inline tokenizer inside `tok-quote`. Lazy continuation lines (no `>`) are not detected — they render as plain text. Acceptable for a visual hint.
   - `^(\s*)([-*+]|\d+\.) (.*)$` → list item. Marker becomes `tok-list-marker`, rest through inline tokenizer.
   - Else → inline tokenize the whole line.

### Inline pass (single-line scan, left to right)

Recognizers, tried in order at each position:

- `` ` `` … `` ` `` (no nested parsing inside) → `tok-code`. Backticks are `tok-markup`.
- `[` … `](` … `)` → `tok-link-text` for the bracket contents, `tok-link-url` for the URL. Brackets and parens are `tok-markup`. The closing `)` ends the URL — no support for parens-in-URLs.
- `**` … `**` → `tok-strong`. Markers are `tok-markup`.
- `*` … `*` → `tok-em`. Markers are `tok-markup`. Empty `**` (zero-length emphasis) is left as plain text.
- Any other character → accumulated into a `text` run.

Runs of plain text are not wrapped in spans (keeps DOM small).

Each line ends with a literal `\n` so wrap math matches the textarea exactly.

## Palette

CSS variables in `src/styles/app.css`. Light values are the default; dark values override under `@media (prefers-color-scheme: dark)`.

| Token class | Light | Dark | Style |
|---|---|---|---|
| `.tok-markup` | `#a0a4ab` | `#6e7681` | — |
| `.tok-heading` | `#1f6feb` | `#79c0ff` | `font-weight: bold` |
| `.tok-strong` | inherit | inherit | `font-weight: bold` |
| `.tok-em` | inherit | inherit | `font-style: italic` |
| `.tok-code` | `#7d4cdb` on `rgba(125,76,219,0.08)` | `#c8a2ff` on `rgba(200,162,255,0.10)` | — |
| `.tok-codeblock` | bg `rgba(125,76,219,0.06)` | bg `rgba(200,162,255,0.07)` | — |
| `.tok-link-text` | `#0a7d4f` | `#7ee2b8` | — |
| `.tok-link-url` | `#a0a4ab` | `#6e7681` | — |
| `.tok-quote` | `#737880` | `#9aa0a6` | `font-style: italic` |
| `.tok-list-marker` | `#c2410c` | `#ffa657` | — |

Body text (no class) inherits `var(--editor-fg)`. All heading levels share one style — h1–h6 don't all need different colors at this scale.

## Config wiring

**Backend** (`src-tauri/src/config.rs`) — extend the editor config struct:

```rust
pub struct Editor {
    // ...existing fields...
    #[serde(default = "default_true")]
    pub syntax_highlighting: bool,
}
```

Default is `true`, applied via serde default so existing `madame_config.yaml` files without the key still load. The first-run YAML template gains:

```yaml
editor:
  syntax_highlighting: true
```

**Frontend** — `src/types.ts` mirrors the new field. `Editor.applyConfig({...})` accepts `syntax_highlighting: boolean`. When `false`, the editor stack receives a class (e.g. `.no-highlight`) that:
- hides `.editor-highlight` (`display: none`),
- restores `color: var(--editor-fg)` on the textarea.

When `true`, the opposite. The flag is read on startup via `applyConfig`. Whether toggling the YAML re-applies without a restart depends on the existing config-reload path; the implementation plan should verify this and either reuse that path or document that a restart is required.

## Performance

- **Idle scheduling.** Editor `input` events schedule a re-render via `requestAnimationFrame`, coalescing multiple events in the same frame. The textarea updates immediately (it's just typing); the highlight layer catches up on the next frame.
- **Direct scroll sync.** `scroll` events on the textarea immediately copy `scrollTop` and `scrollLeft` to the highlight `<pre>` (no rAF) so the layer never visibly drifts during scrolling.
- **Skip when hidden.** When the editor pane has `.hidden` (preview-only mode), don't run the tokenizer.

No incremental re-tokenization, no web worker, no virtualization. Re-evaluate only if real-world usage shows lag.

## Files

**New**
- `src/highlight.ts` — tokenizer + `renderHighlight(source: string): string`. ~150 lines.
- `src/tests/highlight.test.ts` — vitest spec covering: heading levels, fenced block start/middle/end, blockquote, ordered + unordered list markers, link, strong, em, inline code, plain line, HTML-escape correctness. ~10 cases.

**Modified**
- `src/index.html` — wrap textarea in `.editor-stack`, add `<pre class="editor-highlight">`.
- `src/styles/app.css` — `.editor-stack` layout, `.editor-highlight` positioning + transparent textarea rules, `.tok-*` classes, palette vars (light + dark).
- `src/editor.ts` — accept the highlight `<pre>` element; on `input` (rAF-coalesced) and `scroll`, update the layer; honor `syntax_highlighting` in `applyConfig`.
- `src/main.ts` — pass the highlight element into `createEditor`.
- `src/types.ts` — add `syntax_highlighting: boolean` to the editor config type.
- `src-tauri/src/config.rs` — `syntax_highlighting: bool` field, defaulted true.

**Untouched**
- `scroll-sync.ts`, `splitter.ts`, `preview.ts`, `titlebar.ts`, `recent.ts`, `confirm.ts`, `toast.ts`, `shortcuts.ts`.

## Testing

- Unit tests for `renderHighlight` cover the cases listed above. Each test asserts the produced HTML string contains the expected `tok-*` spans for representative inputs.
- Manual verification:
  - Type into the editor; highlight stays aligned with text as you type, scroll, wrap.
  - Toggle `editor.syntax_highlighting: false` in `madame_config.yaml`; relaunch — editor renders as plain text again, no overlay visible.
  - Light/dark mode switch — palette updates without restart.
  - Word-wrap on/off (toggled via config) — overlay continues to align.
  - Large file (10K+ lines) — no perceptible typing lag.
