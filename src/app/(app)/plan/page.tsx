import Link from "next/link";
import { redirect } from "next/navigation";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { getPlanPageData } from "@/lib/plan/queries";
import { weekStartFor } from "@/lib/plan/materialise";
import { addDays, normaliseWeekStart } from "@/lib/plan/timing";
import { WeekToolbar } from "@/components/plan/week-toolbar";
import { PlanDay } from "@/components/plan/plan-day";
import { RecyclePool } from "@/components/plan/recycle-pool";

export const metadata = { title: "Plan" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week: weekParam } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) return <p className="text-muted-foreground">Create a brand first. <Link className="underline" href="/brands/new">New brand</Link></p>;
  const thisWeek = weekStartFor(new Date(), brand.timezone);
  // Any ?week= value is snapped to its Monday; a non-Monday key would mis-place slots and double-book the week.
  let weekStart = thisWeek;
  if (weekParam) {
    try { weekStart = normaliseWeekStart(weekParam); } catch { weekStart = thisWeek; }
    if (weekStart !== weekParam) redirect(`/plan?week=${weekStart}`);
  }
  const data = await getPlanPageData(brand.id, weekStart, brand.timezone);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekly plan</h1>
        <p className="text-sm text-muted-foreground">New project pages first, then proven posts due to run again, then promos and filler. Nothing goes out until you approve it.</p>
      </div>
      <WeekToolbar brandId={brand.id} brandSlug={brand.slug} weekStart={weekStart} thisWeek={thisWeek} prev={addDays(weekStart, -7)} next={addDays(weekStart, 7)} built={Boolean(data.week)} timingSource={data.timingSource} summary={data.week?.summary ?? null} counts={data.counts} weeksOnFile={data.weeksOnFile.length} emptyDays={data.emptyDays} />
      <RecyclePool pool={data.recyclePool} />
      <div className="space-y-4">
        {data.days.map((d) => <PlanDay key={d.date} brandId={brand.id} weekStart={weekStart} day={d} tz={brand.timezone} />)}
      </div>
    </div>
  );
}
