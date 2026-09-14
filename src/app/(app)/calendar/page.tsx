import Link from "next/link";
import { listBrands } from "@/lib/brands/queries";
import { getCurrentBrandSlug } from "@/lib/current-brand";
import { listTargetsInRange } from "@/lib/posts/queries";
import { listPinsInRange } from "@/lib/pins/queries";
import { monthGrid, dayKeyInZone, addMonths } from "@/lib/calendar/grid";
import { zonedLocalToUtc, utcToZonedLocal } from "@/lib/time/zoned";
import { MonthGrid, type Chip } from "@/components/calendar/month-grid";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams;
  const [brands, currentSlug] = await Promise.all([listBrands(), getCurrentBrandSlug()]);
  const brand = brands.find((b) => b.slug === currentSlug) ?? brands[0];
  if (!brand) {
    return (
      <p className="text-muted-foreground">
        Create a brand first.{" "}
        <Link className="underline" href="/brands/new">
          New brand
        </Link>
      </p>
    );
  }
  const tz = brand.timezone;
  const todayLocal = utcToZonedLocal(new Date().toISOString(), tz);
  const m = /^\d{4}-\d{2}$/.test(monthParam ?? "") ? monthParam! : todayLocal.slice(0, 7);
  const [year, month] = m.split("-").map(Number);
  const grid = monthGrid(year, month);
  const fromIso = zonedLocalToUtc(`${grid.days[0].date}T00:00`, tz);
  const lastDay = new Date(Date.UTC(year, month - 1, 1));
  lastDay.setUTCDate(1 - lastDay.getUTCDay() + 42);
  const toIso = zonedLocalToUtc(`${lastDay.toISOString().slice(0, 10)}T00:00`, tz);

  const [targets, pins] = await Promise.all([listTargetsInRange(brand.id, fromIso, toIso), listPinsInRange(brand.id, fromIso, toIso)]);
  const chipsByDay: Record<string, Chip[]> = {};
  for (const p of pins) {
    if (!p.scheduled_at) continue;
    const day = dayKeyInZone(p.scheduled_at, tz);
    const status = p.status === "published" ? "published" : p.status === "failed" ? "failed" : p.status === "publishing" ? "publishing" : "pending";
    (chipsByDay[day] ??= []).push({ id: p.id, post_id: p.id, title: p.title, platform: "pinterest", status, scheduled_at: p.scheduled_at, movable: ["draft", "pending_approval", "approved", "failed"].includes(p.status), href: `/pins/${p.id}` });
  }
  for (const t of targets) {
    if (!t.scheduled_at) continue;
    const day = dayKeyInZone(t.scheduled_at, tz);
    (chipsByDay[day] ??= []).push({
      id: t.id,
      post_id: t.post.id,
      title: t.post.title,
      platform: t.platform,
      status: t.status,
      scheduled_at: t.scheduled_at,
      movable: t.status === "pending" && t.post.status !== "publishing",
    });
  }
  for (const k of Object.keys(chipsByDay)) chipsByDay[k].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const fmt = (x: { year: number; month: number }) => `${x.year}-${String(x.month).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {brand.name} · {tz}. Drag a scheduled post to another day to move it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/calendar?month=${fmt(prev)}`} />}>
            ←
          </Button>
          <span className="w-40 text-center font-medium">{label}</span>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/calendar?month=${fmt(next)}`} />}>
            →
          </Button>
          <Button size="sm" nativeButton={false} render={<Link href="/posts/new" />}>
            New post
          </Button>
        </div>
      </div>
      <MonthGrid days={grid.days} chipsByDay={chipsByDay} timezone={tz} today={todayLocal.slice(0, 10)} />
    </div>
  );
}
