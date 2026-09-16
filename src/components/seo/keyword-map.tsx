import Link from "next/link";
import { normaliseKeyword } from "@/lib/seo/score";
import type { KeywordRow, SitePageRow } from "@/lib/seo/queries";

type ArticleTarget = { id: string; title: string; slug: string; status: string; primary_keyword: string | null; secondary_keywords: string[]; wp_link: string | null };
const th = "p-2 text-left text-xs font-medium text-muted-foreground";
const td = "p-2 align-top";

/** Every keyword that something targets, what targets it, and how it ranks — plus articles with no keyword at all. */
export function KeywordMap({ articles, pages, keywords }: { articles: ArticleTarget[]; pages: SitePageRow[]; keywords: KeywordRow[] }) {
  const byKw = new Map(keywords.map((k) => [k.keyword, k]));
  const rows: { keyword: string; targets: { kind: string; label: string; href: string }[]; k: KeywordRow | undefined }[] = [];
  const add = (kw: string, t: { kind: string; label: string; href: string }) => {
    const key = normaliseKeyword(kw);
    let r = rows.find((x) => x.keyword === key);
    if (!r) { r = { keyword: key, targets: [], k: byKw.get(key) }; rows.push(r); }
    r.targets.push(t);
  };
  for (const a of articles) if (a.primary_keyword) add(a.primary_keyword, { kind: "article", label: `${a.title} (${a.status})`, href: `/blog/${a.id}` });
  for (const p of pages) if (p.focus_keyword) add(p.focus_keyword, { kind: "live page", label: p.title, href: p.url });
  const collisions = rows.filter((r) => r.targets.length > 1);
  const noKeyword = articles.filter((a) => !a.primary_keyword);
  rows.sort((a, b) => b.targets.length - a.targets.length || a.keyword.localeCompare(b.keyword));
  return (
    <div className="space-y-6">
      {collisions.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">{collisions.length} keyword{collisions.length === 1 ? " is" : "s are"} targeted by more than one page — those pages compete with each other in search. Consolidate or re-target.</p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><th className={th}>Keyword</th><th className={th}>Targeted by</th><th className={th}>Our position</th><th className={th}>Volume</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={4}>No blog post or page has a primary/focus keyword yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.keyword} className={`border-t ${r.targets.length > 1 ? "bg-amber-50/50" : ""}`}>
                <td className={`${td} font-medium`}>{r.keyword}</td>
                <td className={td}>{r.targets.map((t, i) => <span key={i} className="block"><span className="text-xs text-muted-foreground">{t.kind}: </span>{t.href.startsWith("/") ? <Link className="underline" href={t.href}>{t.label}</Link> : <a className="underline" href={t.href} target="_blank" rel="noreferrer">{t.label}</a>}</span>)}</td>
                <td className={`${td} tabular-nums`}>{r.k?.our_position ? `#${Math.round(r.k.our_position)}` : "—"}</td>
                <td className={`${td} tabular-nums`}>{r.k?.volume?.toLocaleString("en-US") ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {noKeyword.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Blog posts without a primary keyword</p>
          <ul className="list-disc pl-5 text-sm">{noKeyword.map((a) => <li key={a.id}><Link className="underline" href={`/blog/${a.id}`}>{a.title}</Link> <span className="text-xs text-muted-foreground">{a.status}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
