import type { CreatePinPayload } from "@/lib/pinterest/client";

export type PinLike = { board_id: string; title: string; description: string; link: string | null; alt_text: string | null; image_url: string };
export type PinCheck = { errors: string[]; warnings: string[] };

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

/** Hard rules reject; soft ones warn. Mirrors the pin_spec the AI is given. */
export function validatePin(p: PinLike, brandHost?: string | null): PinCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const title = p.title.trim(), desc = p.description.trim();
  if (!p.board_id) errors.push("Pick a board");
  if (!title) errors.push("Title is required");
  if (title.length > 100) errors.push(`Title is ${title.length} chars; Pinterest allows 100`);
  if (!desc) errors.push("Description is required");
  if (desc.length > 500) errors.push(`Description is ${desc.length} chars; Pinterest allows 500`);
  if (desc && (desc.length < 100 || desc.length > 300)) warnings.push(`Description is ${desc.length} chars; aim for 100–300 (it is indexed search text)`);
  if (EMOJI.test(title) || EMOJI.test(desc)) errors.push("No emoji in pin titles or descriptions");
  if (/(^|\s)#\w+/.test(title) || /(^|\s)#\w+/.test(desc)) errors.push("No hashtags in pin titles or descriptions");
  if (!/^https?:\/\//.test(p.image_url)) errors.push("Pick an image");
  if (p.link) {
    if (!/^https:\/\//.test(p.link)) errors.push("Link must start with https://");
    else if (brandHost) {
      try {
        const h = new URL(p.link).hostname.replace(/^www\./, "");
        if (h !== brandHost.replace(/^www\./, "")) warnings.push(`Link points to ${h}; pins should link to the brand's own site (${brandHost})`);
      } catch {
        errors.push("Link is not a valid URL");
      }
    }
  } else warnings.push("No link — a pin without a destination sends nobody to the site");
  if (p.alt_text && p.alt_text.length > 500) errors.push("Alt text is limited to 500 chars");
  return { errors, warnings };
}

export function buildPinPayload(p: PinLike): CreatePinPayload {
  return { board_id: p.board_id, title: p.title.trim().slice(0, 100), description: p.description.trim().slice(0, 500), ...(p.link ? { link: p.link } : {}), ...(p.alt_text ? { alt_text: p.alt_text.slice(0, 500) } : {}), media_source: { source_type: "image_url", url: p.image_url } };
}

/** Per-board rollup for the boards list: measured pins and median impressions. */
export function boardStats(pins: { board_id: string; insights: { impressions?: number } | null; status: string }[]): Record<string, { pins: number; measured: number; median_impressions: number | null }> {
  const out: Record<string, { pins: number; measured: number; median_impressions: number | null; imps: number[] }> = {};
  for (const p of pins) {
    const b = (out[p.board_id] ??= { pins: 0, measured: 0, median_impressions: null, imps: [] });
    b.pins++;
    if (p.status === "published" && p.insights && typeof p.insights.impressions === "number") { b.measured++; b.imps.push(p.insights.impressions); }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => {
    const s = [...v.imps].sort((a, b) => a - b);
    const m = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
    return [k, { pins: v.pins, measured: v.measured, median_impressions: m }];
  }));
}
