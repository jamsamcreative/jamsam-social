import { phraseRegex } from "./suggest";

/**
 * Split raw HTML into text segments that may be linked and protected segments: comments, anchors, headings, code-like and
 * form/metadata elements (option, textarea, button, title), `[shortcode attr="…"]` open/close tags (attribute values may hold `]`),
 * and any other tag (attribute values may hold `>`; a tag with an unbalanced quote still ends at the first `>`).
 */
function segments(html: string): { text: string; linkable: boolean }[] {
  const out: { text: string; linkable: boolean }[] = [];
  const re = /<!--[\s\S]*?-->|<a\b[\s\S]*?<\/a>|<(h[1-6]|pre|code|script|style|option|textarea|button|title)\b[\s\S]*?<\/\1>|\[\/?[a-zA-Z][\w-]*(?:\s(?:[^\]"']|"[^"]*"|'[^']*')*)?\]|<(?:[^>"']|"[^"]*"|'[^']*')*>|<[^>]+>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ text: html.slice(last, m.index), linkable: true });
    out.push({ text: m[0], linkable: false });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ text: html.slice(last), linkable: true });
  return out;
}

/** Escape a value for safe use inside a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function wrapPhrase(rawHtml: string, phrase: string, href: string): { html: string; snippet: string } | null {
  const re = phraseRegex(phrase);
  const escapedHref = escapeAttr(href);
  const hrefPattern = escapedHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`<a href="${hrefPattern}">([^<]*)</a>`, "i").exec(rawHtml);
  if (existing) {
    const m = re.exec(existing[1]);
    const isExact = m !== null && m.index === 0 && m[0].length === existing[1].length;
    if (isExact) return { html: rawHtml, snippet: existing[0] };
    return null;
  }
  const segs = segments(rawHtml);
  for (const s of segs) {
    if (!s.linkable) continue;
    const m = re.exec(s.text);
    if (!m) continue;
    const snippet = `<a href="${escapedHref}">${m[0]}</a>`;
    s.text = s.text.slice(0, m.index) + snippet + s.text.slice(m.index + m[0].length);
    return { html: segs.map((x) => x.text).join(""), snippet };
  }
  return null;
}

export function unwrapSnippet(rawHtml: string, snippet: string): string | null {
  if (!rawHtml.includes(snippet)) return null;
  const inner = snippet.replace(/^<a [^>]*>/, "").replace(/<\/a>$/, "");
  return rawHtml.replace(snippet, () => inner);
}
