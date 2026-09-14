import Link from "next/link";
import type { OverviewVM } from "@/lib/metrics/aggregate";
import type { ContentSocialVM } from "@/lib/reports/queries";
import { bucketLabel } from "@/lib/metrics/ranges";
import { fmtMoney, fmtInt, fmtPct, fmtDelta } from "@/lib/reports/format";
import { Tiles } from "./tiles";
import { GroupedBars } from "./charts/grouped-bars";
import { LineChart } from "./charts/line-chart";
import { HorizontalBars } from "./charts/horizontal-bars";

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}
function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {children}
    </div>
  );
}
const th = "p-2 text-left text-xs font-medium text-muted-foreground";
const td = "p-2 tabular-nums";
const Change = ({ n }: { n: number | null }) => {
  const d = fmtDelta(n);
  return d ? <span className={n! >= 0 ? "text-green-700" : "text-red-700"}>{d}</span> : <span className="text-muted-foreground">—</span>;
};

export function Overview({ vm, social, mode, slug }: { vm: OverviewVM; social: ContentSocialVM; mode: "week" | "month"; slug: string }) {
  const lbl = (b: string) => bucketLabel(b, mode);
  const empty = !vm.hasAds && !vm.hasGa4;
  return (
    <div className="space-y-8">
      <Tiles tiles={vm.tiles} invertGood={["Meta ads cost / lead", "Google Ads cost / lead"]} />
      {empty && (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          No marketing data for this range yet. Connect Google Analytics, Search Console or Meta Ads under{" "}
          <Link href={`/brands/${slug}/connections`} className="underline">Connections</Link>, then Sync now.
        </p>
      )}

      {vm.hasAds && (
        <Section title="Paid media" intro="What went out the door, and what came back.">
          <Panel title="Spend by period" note="Both platforms share one axis because both are money in the same currency. Conversions are deliberately not overlaid — two different units on one plot invents a relationship the numbers do not contain.">
            <GroupedBars points={vm.spendByBucket.map((p) => ({ label: lbl(p.bucket), a: p.meta, b: p.google }))} seriesA="Meta ads" seriesB="Google Ads" format={(n) => fmtMoney(n)} ariaLabel="Ad spend by period, Meta versus Google" />
          </Panel>
          <Panel title="By platform" note="Cost per lead is the column to read across. A dash means no leads were recorded, which is not the same as a cost per lead of zero.">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>Platform</th><th className={th}>Spend</th><th className={th}>Link clicks</th><th className={th}>CTR</th><th className={th}>CPC</th><th className={th}>Arrived</th><th className={th}>Leads</th><th className={th}>Cost / lead</th></tr></thead>
              <tbody>
                {vm.byPlatform.map((p) => (
                  <tr key={p.platform} className="border-t">
                    <td className={td}>{p.platform}<span className="block text-xs text-muted-foreground">{p.campaigns} campaign{p.campaigns === 1 ? "" : "s"}</span></td>
                    <td className={td}>{fmtMoney(p.spend)}</td><td className={td}>{fmtInt(p.clicks)}</td><td className={td}>{fmtPct(p.ctr, 2)}</td><td className={td}>{fmtMoney(p.cpc, 2)}</td>
                    <td className={td}>{p.arrived === null ? "—" : `${Math.round(p.arrived * 100)}%`}</td><td className={td}>{fmtInt(p.leads)}</td><td className={td}>{fmtMoney(p.cpl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          {vm.metaCampaigns.length > 0 && (
            <Panel title="Meta ads campaigns" note="Leads and cost per lead are Meta's own, attributed by its pixel on a 7-day click window. Sorted by spend, so a campaign that spent heavily and converted nothing sits at the top rather than being buried.">
              <CampaignTable rows={vm.metaCampaigns} />
            </Panel>
          )}
          {vm.adsCampaigns.length > 0 && (
            <Panel title="Google Ads campaigns" note="Leads are GA4 key events credited to the last click, so they are counted differently from the Meta table above and the two should not be compared row to row.">
              <CampaignTable rows={vm.adsCampaigns} />
            </Panel>
          )}
        </Section>
      )}

      {vm.hasGa4 && (
        <Section title="Website" intro="Where the visits came from, and how much of that we paid for.">
          <Panel title="Traffic by channel" note="Every bar is labelled with its own number, so the split reads without relying on colour.">
            <HorizontalBars bars={vm.channels.map((c) => ({ label: c.channel, value: c.sessions, share: c.share, paid: c.paid }))} format={(n) => `${fmtInt(n)} sessions`} />
            <table className="mt-3 w-full text-sm">
              <thead><tr><th className={th}>Channel</th><th className={th}>Sessions</th><th className={th}>vs previous period</th><th className={th}>vs same period last year</th></tr></thead>
              <tbody>
                {vm.channels.map((c) => (
                  <tr key={c.channel} className="border-t">
                    <td className={td}>{c.channel}</td><td className={td}>{fmtInt(c.sessions)}</td>
                    <td className={td}><Change n={c.change} />{c.prev > 0 && <span className="text-xs text-muted-foreground"> from {fmtInt(c.prev)}</span>}</td>
                    <td className={td}>{c.lastYear === null ? <span className="text-muted-foreground">—</span> : <><Change n={c.lyChange} /><span className="text-xs text-muted-foreground"> from {fmtInt(c.lastYear)}</span></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Paid against earned, by period" note="The question this answers is whether the earned half is growing on its own, or whether the total only moves when the ad budget does.">
            <LineChart points={vm.paidVsEarned.map((p) => ({ label: lbl(p.bucket), a: p.earned, b: p.paid }))} seriesA="Earned and direct" seriesB="Paid" format={(n) => `${fmtInt(n)} sessions`} ariaLabel="Sessions by period, paid versus earned" />
          </Panel>
        </Section>
      )}

      <Section title="Organic social" intro="A summary. The detail is on the Content & social tab.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Posts published</p><p className="mt-1 text-2xl font-semibold">{social.published.facebook + social.published.instagram}</p><p className="text-xs text-muted-foreground">FB {social.published.facebook} · IG {social.published.instagram}</p></div>
          <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Typical Facebook post</p><p className="mt-1 text-2xl font-semibold">{social.fbWithheld ? "—" : fmtInt(social.medianEngagement.facebook)}</p><p className="text-xs text-muted-foreground">{social.fbWithheld ? "Meta withholds engagement for this Page" : "median engagement per post"}</p></div>
          <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Typical Instagram post</p><p className="mt-1 text-2xl font-semibold">{fmtInt(social.medianEngagement.instagram)}</p><p className="text-xs text-muted-foreground">median engagement per post</p></div>
        </div>
      </Section>

      <Section title="How to read these numbers">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Cost per lead is shown per platform and never combined, because the two lead counts overlap. Meta claims a lead through its own pixel and attribution window; Google Ads leads are GA4 key events credited to the last click. Adding them up would double count.</li>
          <li>A lead here means the GA4 key events chosen for this brand (usually a form submission). Phone calls, messaging conversations and file downloads are not counted unless you add those events.</li>
          <li>Website leads are the site&apos;s own count and are the only figure that reflects a real person in the pipeline. Treat the platform figures as a measure of ad delivery, not of sales.</li>
          <li>Meta restates the last few weeks of figures as its attribution windows close, so recent days move slightly on every sync. Google Analytics data for a day is final about 48 hours later; Search Console lags about 3 days.</li>
          <li>Posts published in the last 72 hours are excluded from the engagement medians because interactions arrive over the following days.</li>
        </ul>
      </Section>
    </div>
  );
}

function CampaignTable({ rows }: { rows: OverviewVM["metaCampaigns"] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr><th className={th}>Campaign</th><th className={th}>Spend</th><th className={th}>Clicks</th><th className={th}>CTR</th><th className={th}>Leads</th><th className={th}>Cost / lead</th></tr></thead>
      <tbody>
        {rows.slice(0, 25).map((r) => (
          <tr key={r.name} className="border-t">
            <td className={`${td} max-w-xs truncate`} title={r.name}>{r.name}</td><td className={td}>{fmtMoney(r.spend)}</td><td className={td}>{fmtInt(r.clicks)}</td><td className={td}>{fmtPct(r.ctr, 2)}</td><td className={td}>{r.leads ? fmtInt(r.leads) : "—"}</td><td className={td}>{fmtMoney(r.cpl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
