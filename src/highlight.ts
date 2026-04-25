const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

function renderInline(s: string): string {
  return escape(s);
}

function renderBlock(line: string): string {
  return renderInline(line);
}

export function renderHighlight(source: string): string {
  if (source === "") return "";
  const lines = source.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    out.push(renderBlock(line));
  }
  let html = out.join("\n");
  if (source.endsWith("\n")) html += " ";
  return html;
}
