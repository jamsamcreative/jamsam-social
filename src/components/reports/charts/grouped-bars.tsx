import { SERIES, chartFrame as F, niceMax, compact } from "./palette";
import { ShowNumbers } from "./show-numbers";

export type GroupedBarsProps = { points: { label: string; a: number; b: number }[]; seriesA: string; seriesB: string; format: (n: number) => string; ariaLabel: string };

/** Two series per bucket, one axis, 2px gap between adjacent bars, rounded data ends, hover titles. */
export function GroupedBars({ points, seriesA, seriesB, format, ariaLabel }: GroupedBarsProps) {
  const max = niceMax(Math.max(0, ...points.flatMap((p) => [p.a, p.b])));
  const plotW = F.w - F.padL - F.padR, plotH = F.h - F.padT - F.padB;
  const slot = plotW / Math.max(1, points.length);
  const barW = Math.max(4, Math.min(28, slot * 0.32));
  const y = (v: number) => F.padT + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const Bar = ({ x, v, color, title }: { x: number; v: number; color: string; title: string }) =>
    v > 0 ? (
      <rect x={x} y={y(v)} width={barW} height={F.padT + plotH - y(v)} rx={4} ry={4} fill={color}>
        <title>{title}</title>
      </rect>
    ) : null;
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${F.w} ${F.h}`} className="w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={F.padL} x2={F.w - F.padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={F.padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.7}>
              {compact(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = F.padL + slot * i + slot / 2;
          return (
            <g key={p.label}>
              <Bar x={cx - barW - 1} v={p.a} color={SERIES.a} title={`${p.label} · ${seriesA}: ${format(p.a)}`} />
              <Bar x={cx + 1} v={p.b} color={SERIES.b} title={`${p.label} · ${seriesB}: ${format(p.b)}`} />
              {(points.length <= 14 || i % Math.ceil(points.length / 12) === 0) && (
                <text x={cx} y={F.h - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: SERIES.a }} /> {seriesA}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: SERIES.b }} /> {seriesB}</span>
      </figcaption>
      <ShowNumbers>
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="p-1">Period</th><th className="p-1">{seriesA}</th><th className="p-1">{seriesB}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.label} className="border-t"><td className="p-1">{p.label}</td><td className="p-1">{format(p.a)}</td><td className="p-1">{format(p.b)}</td></tr>)}</tbody>
        </table>
      </ShowNumbers>
    </figure>
  );
}
