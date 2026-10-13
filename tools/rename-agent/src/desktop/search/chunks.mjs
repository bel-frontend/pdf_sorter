import { createHash } from "node:crypto";
export function splitChunks(pages, { size = 2000, overlap = 400 } = {}) {
  if (!Number.isInteger(size) || size < 100 || overlap < 0 || overlap >= size)
    throw new Error("Няправільны памер фрагмента або overlap");
  let text = "",
    spans = [];
  for (const page of [...pages].sort((a, b) => a.number - b.number)) {
    if (!page.text?.trim()) continue;
    if (text) text += "\n\n";
    const start = text.length;
    text += page.text;
    spans.push({
      start,
      end: text.length,
      number: page.number > 0 ? page.number : null,
    });
  }
  const chunks = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const minimum = start + Math.max(overlap + 1, Math.floor(size * 0.7));
      for (const separator of ["\n\n", "\n", ". ", " "]) {
        const boundary = text.lastIndexOf(separator, end - 1);
        if (boundary >= minimum) {
          end = boundary + separator.length;
          break;
        }
      }
    }
    const matches = spans.filter(
      (page) => page.end > start && page.start < end,
    );
    chunks.push({
      text: text.slice(start, end),
      start,
      end,
      pageStart: matches[0]?.number ?? null,
      pageEnd: matches.at(-1)?.number ?? null,
      kind: "text",
    });
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}
export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
