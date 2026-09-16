import Link from "next/link";
import type { ContentSocialVM } from "@/lib/reports/queries";
import { fmtInt } from "@/lib/reports/format";

const th = "p-2 text-left text-xs font-medium text-muted-foreground";
const td = "p-2";

export function ContentSocial({ vm }: { vm: ContentSocialVM }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Facebook posts published" value={fmtInt(vm.published.facebook)} />
        <Stat label="Instagram posts published" value={fmtInt(vm.published.instagram)} />
        <Stat label="Typical Facebook engagement" value={vm.fbWithheld ? "—" : fmtInt(vm.medianEngagement.facebook)} sub={vm.fbWithheld ? "Meta withholds this for the Page" : "median per post"} />
        <Stat label="Typical Instagram engagement" value={fmtInt(vm.medianEngagement.instagram)} sub="median per post" />
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top posts by engagement</p>
        {vm.excludedRecent > 0 && <p className="text-xs text-muted-foreground">{vm.excludedRecent} post{vm.excludedRecent === 1 ? "" : "s"} published in the last 72 hours are left out until their numbers settle.</p>}
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Post</th><th className={th}>Platform</th><th className={th}>Engagement</th><th className={th}>Published</th></tr></thead>
          <tbody>
            {vm.topPosts.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={4}>No published posts in this range.</td></tr>}
            {vm.topPosts.map((p) => (
              <tr key={`${p.id}-${p.platform}`} className="border-t">
                <td className={td}><Link href={`/posts/${p.id}`} className="underline">{p.title}</Link>{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted-foreground underline">view</a>}</td>
                <td className={td}>{p.platform === "facebook" ? "Facebook" : "Instagram"}</td><td className={`${td} tabular-nums`}>{fmtInt(p.engagement)}</td><td className={td}>{new Date(p.published_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinterest</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Pins published" value={fmtInt(vm.pins.published)} />
          <Stat label="Typical pin impressions" value={fmtInt(vm.pins.medianImpressions)} sub="median per pin, lifetime" />
        </div>
        {vm.pins.top.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Pin</th><th className={th}>Impressions</th><th className={th}>Saves</th><th className={th}>Published</th></tr></thead>
            <tbody>
              {vm.pins.top.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className={td}><Link href={`/pins/${p.id}`} className="underline">{p.title}</Link>{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted-foreground underline">view</a>}</td>
                  <td className={`${td} tabular-nums`}>{fmtInt(p.impressions)}</td><td className={`${td} tabular-nums`}>{fmtInt(p.saves)}</td><td className={td}>{new Date(p.published_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Blog posts published</p>
        {vm.articlesPublished.length === 0 ? <p className="text-sm text-muted-foreground">No blog posts published in this range.</p> : (
          <ul className="space-y-1 text-sm">
            {vm.articlesPublished.map((a) => (
              <li key={a.id}><Link href={`/blog/${a.id}`} className="underline">{a.title}</Link> <span className="text-xs text-muted-foreground">{new Date(a.published_at).toLocaleDateString()}</span>{a.wp_link && <a href={a.wp_link} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted-foreground underline">live</a>}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>;
}
