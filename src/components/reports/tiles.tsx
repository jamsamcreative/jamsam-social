import type { Tile } from "@/lib/metrics/aggregate";
import { fmtMoney, fmtInt, fmtPct, fmtPos, fmtDelta } from "@/lib/reports/format";

const fmt = (t: Tile) => (t.format === "money" ? fmtMoney(t.value) : t.format === "pct" ? fmtPct(t.value) : t.format === "pos" ? fmtPos(t.value) : fmtInt(t.value));

export function Tiles({ tiles, invertGood = [] }: { tiles: Tile[]; invertGood?: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => {
        const delta = fmtDelta(t.change);
        const good = t.change === null ? null : invertGood.includes(t.label) ? t.change <= 0 : t.change >= 0;
        return (
          <div key={t.label} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(t)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {delta && <span className={good ? "font-medium text-green-700" : "font-medium text-red-700"}>{delta} vs the previous period</span>}
              {delta && t.sub ? " · " : ""}
              {t.sub}
              {!delta && !t.sub && "—"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
