# src (TypeScript frontend)

The Vite-built TS frontend: editor textarea, markdown-it preview, scroll sync, and the IPC layer that talks to the Rust backend.

## File map

```
src/
├── index.html
├── main.ts                          # boot + orchestration
├── editor.ts                        # textarea wrapper (line math, cursor tracking)
├── preview.ts                       # markdown-it renderer + source-line anchors
├── highlight.ts                     # editor readability/syntax highlighter
├── scroll-sync.ts                   # editor↔preview sync (interpolated + cursor-aware)
├── splitter.ts                      # draggable column splitter
├── titlebar.ts                      # custom titlebar + window controls
├── shortcuts.ts                     # keybinding registry
├── recent.ts                        # recent-files modal
├── confirm.ts                       # confirm dialog
├── toast.ts                         # toast helper
├── ipc.ts                           # typed wrapper over Tauri invoke/events
├── types.ts                         # shared TS types (mirror Rust structs)
├── markdown-it-task-lists.d.ts      # local types for the task-list plugin
├── public/
│   ├── madame_logo.png              # app logo (titlebar asset + source for madame_icon.png)
│   ├── madame_icon.png              # squircle-composited icon (source for platform icons)
│   └── madame_screenshot.png        # README hero shot
├── styles/
│   ├── app.css
│   └── markdown.css                 # GitHub-style markdown body styling
└── tests/                           # vitest specs
```

## Dependencies

Runtime:
- `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs` — Tauri 2 JS bindings.
- `markdown-it`, `markdown-it-anchor`, `markdown-it-task-lists` — Markdown rendering.
- `highlight.js` — code highlighting.
- `github-markdown-css` — preview styling.

Build/test:
- `vite`, `vitest`, `typescript`, `jsdom`.

For setup commands, see [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
