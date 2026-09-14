import { SERIES, chartFrame as F, niceMax, compact } from "./palette";
import { ShowNumbers } from "./show-numbers";

export type LineChartProps = { points: { label: string; a: number; b?: number }[]; seriesA: string; seriesB?: string; format: (n: number) => string; ariaLabel: string; color?: "a" | "b" };

/** One or two lines on one axis, 2px strokes, 8px markers with a surface ring, hover titles on markers. Two measures of different scale get two charts, never a second axis. */
export function LineChart({ points, seriesA, seriesB, format, ariaLabel, color = "a" }: LineChartProps) {
  const keys: ("a" | "b")[] = seriesB ? ["a", "b"] : ["a"];
  const colorOf = (k: "a" | "b") => (seriesB ? SERIES[k] : SERIES[color]);
  const max = niceMax(Math.max(0, ...points.flatMap((p) => [p.a, p.b ?? 0])));
  const plotW = F.w - F.padL - F.padR, plotH = F.h - F.padT - F.padB;
  const x = (i: number) => F.padL + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => F.padT + plotH - (v / max) * plotH;
  const val = (p: LineChartProps["points"][number], k: "a" | "b") => (k === "a" ? p.a : (p.b ?? 0));
  const path = (key: "a" | "b") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val(p, key)).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map((t) => t * max);
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${F.w} ${F.h}`} className="w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={F.padL} x2={F.w - F.padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={F.padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.7}>{compact(t)}</text>
          </g>
        ))}
        {keys.map((k) => (
          <g key={k}>
            <path d={path(k)} fill="none" stroke={colorOf(k)} strokeWidth={2} strokeLinejoin="round" />
            {points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(val(p, k))} r={4} fill={colorOf(k)} stroke="var(--background, #fff)" strokeWidth={2}>
                <title>{`${p.label} · ${k === "a" ? seriesA : seriesB}: ${format(val(p, k))}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {points.map((p, i) =>
          points.length <= 14 || i % Math.ceil(points.length / 12) === 0 ? (
            <text key={p.label} x={x(i)} y={F.h - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>{p.label}</text>
          ) : null,
        )}
      </svg>
      {seriesB && (
        <figcaption className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: SERIES.a }} /> {seriesA}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: SERIES.b }} /> {seriesB}</span>
        </figcaption>
      )}
      <ShowNumbers>
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="p-1">Period</th><th className="p-1">{seriesA}</th>{seriesB && <th className="p-1">{seriesB}</th>}</tr></thead>
          <tbody>{points.map((p) => <tr key={p.label} className="border-t"><td className="p-1">{p.label}</td><td className="p-1">{format(p.a)}</td>{seriesB && <td className="p-1">{format(p.b ?? 0)}</td>}</tr>)}</tbody>
        </table>
      </ShowNumbers>
    </figure>
  );
}
