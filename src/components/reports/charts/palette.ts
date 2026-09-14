/** Validated with the dataviz palette validator (light + dark): CVD ΔE 30, normal ΔE 33, contrast ≥ 3:1. */
export const SERIES = { a: "#2a78d6", b: "#eb6834" } as const;
export const INK = { grid: "currentColor", muted: "currentColor" } as const;
export const chartFrame = { w: 720, h: 240, padL: 48, padR: 12, padT: 12, padB: 28 };
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${Math.round(n)}`);
