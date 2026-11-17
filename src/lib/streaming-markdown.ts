/**
 * A reply that is still being written can stop half-way through Markdown ("**free deli"),
 * which would show stray asterisks or back-ticks until the closing marker arrives. For
 * display only, unfinished bold, italics and code are closed and a half-written link is
 * hidden; the saved reply is never changed.
 */
export function closeOpenMarkdown(text: string) {
  let result = text;

  // A link whose address is still arriving: "[our policy](https://exa" shows as text.
  result = result.replace(/\[([^\]]*)\]\([^)]*$/, "$1");
  // A link whose text is still arriving: "[our pol".
  result = result.replace(/\[([^\]]*)$/, "$1");

  // Code spans first: markers inside code don't count as bold or italics.
  if ((result.match(/`/g) ?? []).length % 2 === 1) {
    result += "`";
  }

  const outsideCode = result.replace(/`[^`]*`/g, "");
  const bold = (outsideCode.match(/\*\*/g) ?? []).length;
  // A trailing lone "*" may be the start of "**": wait for the next piece.
  if (/(^|[^*])\*$/.test(result) && bold % 2 === 0) {
    return result.slice(0, -1);
  }

  if (bold % 2 === 1) {
    result += "**";
  }

  // Italics: single asterisks that are not part of "**" and not list bullets ("* item").
  const singles = outsideCode.replace(/\*\*/g, "").replace(/^\s*\*\s/gm, "").match(/\*/g) ?? [];

  if (singles.length % 2 === 1) {
    result += "*";
  }

  return result;
}
