import Link from "next/link";
import { listImportsForBrand } from "@/lib/seo/queries";
import { dataFreshness } from "@/lib/seo/freshness";

type BrandLite = { id: string; name: string; slug: string };

function label(f: ReturnType<typeof dataFreshness>): { text: string; tone: string } {
  if (f.days_old === null) return { text: "No SEMrush data yet", tone: "text-muted-foreground" };
  const when = f.days_old === 0 ? "today" : f.days_old === 1 ? "yesterday" : `${f.days_old} days ago`;
  return { text: `SEMrush data updated ${when}`, tone: f.stale ? "text-amber-600" : "text-emerald-600" };
}

/** One row per brand: when its keyword research (CSV upload or Claude `import_keywords`) was last refreshed. */
export async function SemrushFreshness({ brands }: { brands: BrandLite[] }) {
  const rows = await Promise.all(brands.map(async (b) => ({ brand: b, ...label(dataFreshness(await listImportsForBrand(b.id))) })));
  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide">SEMrush data freshness</h2>
        <Link href="/seo" className="text-xs underline">Upload a new export</Link>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.brand.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={`inline-block h-2 w-2 rounded-full ${r.tone === "text-emerald-600" ? "bg-emerald-500" : r.tone === "text-amber-600" ? "bg-amber-500" : "bg-muted-foreground/40"}`} aria-hidden />
            <span className="w-48 shrink-0">{r.brand.name}</span>
            <span className={r.tone}>{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
