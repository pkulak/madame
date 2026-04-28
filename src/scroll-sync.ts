import type { Editor } from "./editor";
import type { Preview } from "./preview";

export interface ScrollSync {
  setEnabled(on: boolean): void;
}

export function createScrollSync(editor: Editor, preview: Preview): ScrollSync {
  let enabled = true;
  let suppressUntil = 0;

  const suppressMs = 50;
  const now = () => performance.now();

  editor.getElement().addEventListener("scroll", () => {
    if (!enabled) return;
    if (now() < suppressUntil) return;
    suppressUntil = now() + suppressMs;
    const line = editor.getVisibleTopLine();
    preview.scrollToSourceLine(line);
  });

  preview.getScroller().addEventListener("scroll", () => {
    if (!enabled) return;
    if (now() < suppressUntil) return;
    suppressUntil = now() + suppressMs;
    const line = preview.getFirstVisibleSourceLine();
    editor.scrollToLine(line);
  });

  editor.onCursorMove((line) => {
    if (!enabled) return;
    if (now() < suppressUntil) return;
    suppressUntil = now() + suppressMs;
    // Place the line's heading in the preview at the same Y as the cursor
    // sits in the editor. The browser clamps scrollTop at the top/bottom
    // of the file, which gives the right behavior near the document edges.
    preview.scrollToSourceLine(line, editor.getCursorY());
  });

  // After each edit, the preview re-renders (debounced ~100ms). When its
  // scrollHeight changes the browser may clamp scrollTop, firing a scroll
  // event that is not user-initiated. Suppress the preview→editor sync
  // long enough to cover the debounce + render + resulting scroll.
  editor.onChange(() => {
    suppressUntil = now() + 300;
  });

  return {
    setEnabled(on) { enabled = on; },
  };
}
