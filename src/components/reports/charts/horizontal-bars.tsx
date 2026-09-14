import { SERIES } from "./palette";

export type HBar = { label: string; value: number; share: number; paid: boolean };

/** Every bar carries its own number, so the split reads without colour. Paid = orange, earned/direct = blue. */
export function HorizontalBars({ bars, format }: { bars: HBar[]; format: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="space-y-1.5">
      {bars.map((b) => (
        <div key={b.label} className="grid grid-cols-[130px_1fr] items-center gap-2 text-xs">
          <span className="truncate" title={b.label}>{b.label}</span>
          <div className="flex items-center gap-2">
            <div className="h-3 rounded-r-sm" style={{ width: `${Math.max(1, (b.value / max) * 100)}%`, background: b.paid ? SERIES.b : SERIES.a }} title={`${b.label}: ${format(b.value)}`} />
            <span className="whitespace-nowrap text-muted-foreground">{format(b.value)} · {Math.round(b.share * 100)}%</span>
          </div>
        </div>
      ))}
      <p className="flex gap-4 pt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: SERIES.b }} /> Paid channels</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: SERIES.a }} /> Earned and direct</span>
      </p>
    </div>
  );
}
