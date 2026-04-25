import { getCurrentWindow } from "@tauri-apps/api/window";

export interface Titlebar {
  setFilename(name: string): void;
  setDirty(dirty: boolean): void;
  setHomeDir(dir: string): void;
}

export function createTitlebar(el: HTMLElement): Titlebar {
  const filenameEl = el.querySelector<HTMLElement>(".filename")!;
  const minBtn = el.querySelector<HTMLButtonElement>("#btn-min")!;
  const maxBtn = el.querySelector<HTMLButtonElement>("#btn-max")!;
  const closeBtn = el.querySelector<HTMLButtonElement>("#btn-close")!;
  const win = getCurrentWindow();

  minBtn.addEventListener("click", () => win.minimize());
  maxBtn.addEventListener("click", () => win.toggleMaximize());
  closeBtn.addEventListener("click", () => win.close());

  let homeDir: string | null = null;

  function tildify(p: string): string {
    if (!homeDir) return p;
    const norm = p.replace(/\\/g, "/");
    const home = homeDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (norm === home) return "~";
    if (norm.startsWith(home + "/")) return "~" + norm.slice(home.length);
    return p;
  }

  return {
    setFilename(name) {
      if (name === "") {
        filenameEl.textContent = "Untitled";
        filenameEl.title = "";
      } else {
        filenameEl.textContent = tildify(name);
        filenameEl.title = name;
      }
    },
    setDirty(dirty) {
      el.classList.toggle("dirty", dirty);
    },
    setHomeDir(dir) {
      homeDir = dir;
      // Re-render current filename if one is already set.
      const current = filenameEl.title;
      if (current) filenameEl.textContent = tildify(current);
    },
  };
}
