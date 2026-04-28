import { renderHighlight } from "./highlight";

export interface Editor {
  getText(): string;
  setText(text: string): void;
  onChange(cb: (text: string) => void): void;
  focus(): void;
  applyConfig(cfg: { tab_size: number; tab_inserts_spaces: boolean; word_wrap: boolean; font_family: string | null; font_size: number; syntax_highlighting: boolean }): void;
  getElement(): HTMLTextAreaElement;
  getVisibleTopLine(): number;
  scrollToLine(line: number): void;
  getCursorLine(): number;
  getCursorY(): number;
  onCursorMove(cb: (line: number) => void): void;
}

export function createEditor(el: HTMLTextAreaElement, highlight: HTMLElement): Editor {
  let tabSize = 2;
  let tabInsertsSpaces = true;
  let highlightingEnabled = true;
  let rafId: number | null = null;

  const stack = el.parentElement; // .editor-stack

  const scheduleHighlight = () => {
    if (!highlightingEnabled) return;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!highlightingEnabled) return;
      highlight.innerHTML = renderHighlight(el.value);
    });
  };

  const listeners: Array<(t: string) => void> = [];

  el.addEventListener("input", () => {
    const t = el.value;
    for (const cb of listeners) cb(t);
    scheduleHighlight();
  });

  el.addEventListener("scroll", () => {
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const insert = tabInsertsSpaces ? " ".repeat(tabSize) : "\t";
      el.value = el.value.slice(0, start) + insert + el.value.slice(end);
      el.selectionStart = el.selectionEnd = start + insert.length;
      el.dispatchEvent(new Event("input"));
    }
  });

  return {
    getText: () => el.value,
    setText: (t) => {
      el.value = t;
      el.dispatchEvent(new Event("input"));
    },
    onChange: (cb) => { listeners.push(cb); },
    focus: () => el.focus(),
    applyConfig(cfg) {
      tabSize = cfg.tab_size;
      tabInsertsSpaces = cfg.tab_inserts_spaces;
      el.classList.toggle("wrap", cfg.word_wrap);
      el.classList.toggle("nowrap", !cfg.word_wrap);
      highlight.classList.toggle("wrap", cfg.word_wrap);
      highlight.classList.toggle("nowrap", !cfg.word_wrap);
      if (cfg.font_family) {
        el.style.fontFamily = cfg.font_family;
        highlight.style.fontFamily = cfg.font_family;
      }
      el.style.fontSize = `${cfg.font_size}px`;
      highlight.style.fontSize = `${cfg.font_size}px`;
      const tabPx = `${cfg.tab_size}`;
      el.style.tabSize = tabPx;
      highlight.style.tabSize = tabPx;

      highlightingEnabled = cfg.syntax_highlighting;
      if (stack) stack.classList.toggle("no-highlight", !highlightingEnabled);
      if (highlightingEnabled) {
        scheduleHighlight();
      } else {
        highlight.innerHTML = "";
      }
    },
    getElement: () => el,
    getVisibleTopLine() {
      // Walk highlight's text nodes and use Range to find which source line
      // is at the top of the editor's viewport. Wrap-aware: a single source
      // line may span multiple visual lines, so scrollTop / lineHeight gives
      // a visual-line index, not a source-line index.
      if (highlight.firstChild) {
        const editorTop = el.getBoundingClientRect().top;
        const cs = getComputedStyle(el);
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const target = el.scrollTop;
        let prevLine = 0;
        let prevY = 0;
        let line = 0;
        let foundAny = false;
        const walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode() as Text | null;
        while (node) {
          const text = node.nodeValue ?? "";
          for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
              const range = document.createRange();
              range.setStart(node, i + 1);
              range.setEnd(node, i + 1);
              const rect = range.getBoundingClientRect();
              if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.right === 0) {
                line++;
                continue;
              }
              foundAny = true;
              const y = rect.top - editorTop - paddingTop + el.scrollTop;
              line++;
              if (y > target) {
                const span = y - prevY;
                if (span <= 0) return prevLine;
                const frac = (target - prevY) / span;
                return prevLine + frac * (line - prevLine);
              }
              prevLine = line;
              prevY = y;
            }
          }
          node = walker.nextNode() as Text | null;
        }
        if (foundAny) return prevLine;
      }
      // Fallback (highlight disabled / not yet rendered / jsdom): no wrap.
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return el.scrollTop / lineHeight;
    },
    scrollToLine(line) {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      el.scrollTop = line * lineHeight;
    },
    getCursorLine() {
      const before = el.value.slice(0, el.selectionStart);
      let line = 0;
      for (let i = 0; i < before.length; i++) {
        if (before.charCodeAt(i) === 10) line++;
      }
      return line;
    },
    getCursorY() {
      // Walk highlight's text nodes to find the cursor's character and use
      // a Range to measure its real visual Y. This is wrap-aware: with word
      // wrap enabled, source line N may render across multiple visual lines,
      // so line * lineHeight is not the cursor's real position.
      const target = el.selectionStart;
      if (highlight.firstChild) {
        let acc = 0;
        const walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode() as Text | null;
        while (node) {
          const text = node.nodeValue ?? "";
          const len = text.length;
          if (acc + len >= target) {
            const offset = target - acc;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset);
            const rect = range.getBoundingClientRect();
            if (rect.top !== 0 || rect.bottom !== 0 || rect.left !== 0 || rect.right !== 0) {
              return rect.top - el.getBoundingClientRect().top;
            }
            // Range can return an empty rect at end-of-line; back up one char.
            if (offset > 0) {
              range.setStart(node, offset - 1);
              range.setEnd(node, offset);
              const rect2 = range.getBoundingClientRect();
              if (rect2.top !== 0 || rect2.bottom !== 0) {
                return rect2.top - el.getBoundingClientRect().top;
              }
            }
            break;
          }
          acc += len;
          node = walker.nextNode() as Text | null;
        }
      }
      // Fallback (highlight disabled / not yet rendered / jsdom): assume no wrap.
      const cs = getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight) || 20;
      const paddingTop = parseFloat(cs.paddingTop) || 0;
      let line = 0;
      for (let i = 0; i < target; i++) {
        if (el.value.charCodeAt(i) === 10) line++;
      }
      return paddingTop + line * lineHeight - el.scrollTop;
    },
    onCursorMove(cb) {
      const handler = () => {
        if (document.activeElement !== el) return;
        const before = el.value.slice(0, el.selectionStart);
        let line = 0;
        for (let i = 0; i < before.length; i++) {
          if (before.charCodeAt(i) === 10) line++;
        }
        cb(line);
      };
      document.addEventListener("selectionchange", handler);
      el.addEventListener("keyup", handler);
      el.addEventListener("click", handler);
      el.addEventListener("input", handler);
    },
  };
}
