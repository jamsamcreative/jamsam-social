import { describe, it, expect } from "vitest";
import { buildWeek, onThisDay } from "./build";
import type { Candidate, HistoryRow, ResolvedSlot } from "./types";

const slot = (date: string, dow: number, platform: ResolvedSlot["platform"]): ResolvedSlot => ({ date, dow, platform, at: `${date}T22:30:00.000Z`, low_sample: false });
const week = [
  slot("2026-09-14", 1, "facebook"), slot("2026-09-14", 1, "instagram"),
  slot("2026-09-16", 3, "facebook"), slot("2026-09-16", 3, "instagram"),
  slot("2026-09-18", 5, "facebook"),
];
const cand = (id: string, lane: Candidate["lane"]): Candidate => ({ id, lane, reason: "r", title: id, media: [] });
const lanes = (o: Partial<Record<Candidate["lane"], Candidate[]>>) => ({ new_page: [], recycle: [], promo: [], filler: [], ...o });

describe("buildWeek", () => {
  it("fills days in ranking order, lanes in priority order, pairing FB+IG slots on a day", () => {
    const r = buildWeek({ slots: week, dayRanking: [3, 1, 5], lanes: lanes({ new_page: [cand("project:n1", "new_page")], recycle: [cand("history:r1", "recycle")], filler: [cand("project:f1", "filler"), cand("project:f2", "filler")] }), recycleCap: 3, skipped: new Set(), existingCandidateIds: new Set(), existingDates: new Set() });
    expect(r.picks.map((p) => [p.date, p.candidate.id])).toEqual([["2026-09-16", "project:n1"], ["2026-09-14", "history:r1"], ["2026-09-18", "project:f1"]]);
    expect(r.picks[0].slots.map((s) => s.platform)).toEqual(["facebook", "instagram"]);
    expect(r.picks[2].slots).toHaveLength(1);
    expect(r.emptyDays).toEqual([]);
    expect(r.summary).toEqual({ new_page: 1, recycle: 1, promo: 0, filler: 1, slots: 3 });
  });
  it("caps recycles, honours skipped and existing candidates, reports empty days", () => {
    const r = buildWeek({ slots: week, dayRanking: [1, 3, 5], lanes: lanes({ recycle: [cand("history:a", "recycle"), cand("history:b", "recycle"), cand("history:c", "recycle")], filler: [cand("project:x", "filler")] }), recycleCap: 1, skipped: new Set(["history:a"]), existingCandidateIds: new Set(["project:x"]), existingDates: new Set() });
    expect(r.picks.map((p) => p.candidate.id)).toEqual(["history:b"]);
    expect(r.emptyDays).toEqual(["2026-09-16", "2026-09-18"]);
  });
  it("leaves days that already have a planned post alone", () => {
    const r = buildWeek({ slots: week, dayRanking: [1, 3, 5], lanes: lanes({ filler: [cand("project:1", "filler"), cand("project:2", "filler"), cand("project:3", "filler")] }), recycleCap: 3, skipped: new Set(), existingCandidateIds: new Set(), existingDates: new Set(["2026-09-14"]) });
    expect(r.picks.map((p) => p.date)).toEqual(["2026-09-16", "2026-09-18"]);
  });
  it("is deterministic", () => {
    const args = { slots: week, dayRanking: [1, 3, 5], lanes: lanes({ filler: [cand("project:1", "filler"), cand("project:2", "filler")] }), recycleCap: 3, skipped: new Set<string>(), existingCandidateIds: new Set<string>(), existingDates: new Set<string>() };
    expect(buildWeek(args)).toEqual(buildWeek(args));
  });
});

describe("onThisDay", () => {
  const h = (id: string, published_at: string, interactions: number, platform: HistoryRow["platform"] = "facebook"): HistoryRow => ({ id, brand_id: "b", platform, external_id: id, published_at, caption: id, media: [], permalink: null, likes: interactions, comments: 0, shares: 0, reach: null, interactions, post_id: null });
  it("returns rows within ±1 calendar day in earlier years with a ratio against the platform median", () => {
    const history = [h("a", "2025-09-14T20:00:00Z", 40), h("b", "2025-09-15T20:00:00Z", 10), h("c", "2024-09-13T20:00:00Z", 20), h("far", "2025-09-20T20:00:00Z", 99), h("thisyear", "2026-09-14T20:00:00Z", 5), h("base", "2025-01-01T20:00:00Z", 20)];
    const out = onThisDay({ history, date: "2026-09-14", tz: "America/Los_Angeles", years: 3 });
    expect(out.map((o) => o.row.id)).toEqual(["a", "b", "c"]);
    expect(out[0].ratio).toBe(2); // median of [40,10,20,99,5,20] = 20
    expect(out[0].label).toBe("Well above normal · 40 · 2.0x the usual");
  });
});
