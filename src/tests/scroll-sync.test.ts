import { describe, it, expect, vi } from "vitest";
import { createScrollSync } from "../scroll-sync";

function mockEditor() {
  let top = 0;
  let cursorY = 0;
  const scrollListeners: Array<() => void> = [];
  const changeListeners: Array<(t: string) => void> = [];
  const cursorListeners: Array<(line: number) => void> = [];
  return {
    getVisibleTopLine: () => Math.floor(top / 20),
    scrollToLine: vi.fn((line: number) => { top = line * 20; }),
    getCursorY: () => cursorY,
    getElement() {
      const el = document.createElement("div") as any;
      el.addEventListener = (_e: string, fn: () => void) => { if (_e === "scroll") scrollListeners.push(fn); };
      return el;
    },
    onChange: (cb: (t: string) => void) => { changeListeners.push(cb); },
    onCursorMove: (cb: (line: number) => void) => { cursorListeners.push(cb); },
    fireScroll(newTop: number) { top = newTop; scrollListeners.forEach((f) => f()); },
    fireChange() { changeListeners.forEach((f) => f("")); },
    fireCursorMove(line: number, y = 0) { cursorY = y; cursorListeners.forEach((f) => f(line)); },
  };
}

function mockPreview() {
  let line = 0;
  let visible = true;
  const listeners: Array<() => void> = [];
  const scroller = document.createElement("div") as any;
  scroller.addEventListener = (_e: string, fn: () => void) => { if (_e === "scroll") listeners.push(fn); };
  return {
    getFirstVisibleSourceLine: () => line,
    scrollToSourceLine: vi.fn((l: number) => { line = l; }),
    isSourceLineVisible: vi.fn((_l: number) => visible),
    getElement: () => document.createElement("div"),
    getScroller: () => scroller,
    fireScroll(newLine: number) { line = newLine; listeners.forEach((f) => f()); },
    setVisible(v: boolean) { visible = v; },
  };
}

describe("scroll-sync", () => {
  it("syncs editor scroll to preview", () => {
    const ed = mockEditor();
    const pv = mockPreview();
    createScrollSync(ed as any, pv as any);
    ed.fireScroll(200); // line 10
    expect(pv.scrollToSourceLine).toHaveBeenCalledWith(10);
  });

  it("syncs preview scroll to editor", () => {
    const ed = mockEditor();
    const pv = mockPreview();
    createScrollSync(ed as any, pv as any);
    pv.fireScroll(7);
    expect(ed.scrollToLine).toHaveBeenCalledWith(7);
  });

  it("suppresses feedback loop within 50ms window", async () => {
    const ed = mockEditor();
    const pv = mockPreview();
    createScrollSync(ed as any, pv as any);
    ed.fireScroll(200); // editor → preview (line 10)
    expect(pv.scrollToSourceLine).toHaveBeenCalledTimes(1);
    // Preview scroll event fires as a consequence — must not bounce back.
    pv.fireScroll(10);
    expect(ed.scrollToLine).not.toHaveBeenCalled();
  });

  it("can be disabled", () => {
    const ed = mockEditor();
    const pv = mockPreview();
    const sync = createScrollSync(ed as any, pv as any);
    sync.setEnabled(false);
    ed.fireScroll(200);
    expect(pv.scrollToSourceLine).not.toHaveBeenCalled();
  });

  it("suppresses preview→editor sync briefly after an editor edit", () => {
    const ed = mockEditor();
    const pv = mockPreview();
    createScrollSync(ed as any, pv as any);
    ed.fireChange();
    pv.fireScroll(7);
    expect(ed.scrollToLine).not.toHaveBeenCalled();
  });

  it("on cursor move, aligns the cursor's source line with its Y in the editor", () => {
    const ed = mockEditor();
    const pv = mockPreview();
    createScrollSync(ed as any, pv as any);

    // Cursor on line 50, sitting 200px down in the editor's viewport.
    ed.fireCursorMove(50, 200);

    // Preview should place line 50's heading at Y=200 in its viewport.
    expect(pv.scrollToSourceLine).toHaveBeenCalledWith(50, 200);
  });
});
