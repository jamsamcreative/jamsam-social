import { notFound } from "next/navigation";
import { getPin, type PinInsightsJson } from "@/lib/pins/queries";
import { getBrandBySlug } from "@/lib/brands/queries";
import { pinFormData } from "@/lib/pins/page-data";
import { PinForm } from "@/components/pins/pin-form";
import { PinActions } from "@/components/pins/pin-actions";
import { PinStatusBadge } from "@/components/pins/status-badge";
import { formatInZone } from "@/lib/time/zoned";

export const maxDuration = 300;

export default async function PinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pin = await getPin(id);
  if (!pin) notFound();
  const brand = await getBrandBySlug(pin.brand.slug);
  if (!brand) notFound();
  const editable = !["publishing", "published", "archived"].includes(pin.status);
  const ins = pin.insights as PinInsightsJson;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">{pin.title}</h1><PinStatusBadge status={pin.status} /></div>
          <p className="text-sm text-muted-foreground">
            {pin.brand.name} · {pin.board_name ?? pin.board_id}
            {pin.scheduled_at && ` · scheduled ${formatInZone(pin.scheduled_at, pin.brand.timezone)}`}
            {pin.published_at && ` · published ${formatInZone(pin.published_at, pin.brand.timezone)}`}
            {pin.attempts > 0 && pin.status !== "published" && ` · attempt ${pin.attempts}/3`}
          </p>
          {pin.error && <p className="text-sm text-destructive">{pin.error}</p>}
          {ins && <p className="text-sm text-muted-foreground">Impressions {ins.impressions ?? 0} · Saves {ins.saves ?? 0} · Pin clicks {ins.pin_clicks ?? 0} · Outbound clicks {ins.outbound_clicks ?? 0}{ins.fetched_at ? ` · as of ${new Date(ins.fetched_at).toLocaleDateString()}` : ""}</p>}
        </div>
        <PinActions pin={pin} />
      </div>
      {editable ? (
        <PinForm brand={brand} pin={pin} {...(await pinFormData(brand.id))} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pin.image_url} alt={pin.alt_text ?? ""} className="w-full rounded-md border object-cover" />
          <div className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap">{pin.description}</p>
            {pin.link && <p>Link: <a href={pin.link} className="underline" target="_blank" rel="noreferrer">{pin.link}</a></p>}
            {pin.alt_text && <p className="text-muted-foreground">Alt: {pin.alt_text}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
