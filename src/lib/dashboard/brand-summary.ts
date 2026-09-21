import { relativeTime, daysUntil } from "@/lib/time/relative";
import { PROVIDER_LABELS, type Provider } from "@/lib/connections/types";

export const OVERDUE_MS = 15 * 60_000;

export type NeedsYouInput = {
  posts: { status: string }[];
  targets: { status: string; scheduled_at: string | null; post_status: string }[];
  pins: { status: string; scheduled_at: string | null }[];
  jobs: { status: string; runner: string }[];
  pendingLinks: number;
  failingConnections: number;
};

export type NeedsYou = {
  total: number;
  approval: { count: number; posts: number; pins: number; links: number };
  attention: { count: number; failed: number; overdue: number; connections: number };
  claude: { count: number; inProgress: number };
  scheduled: number;
};

export function isOverdue(scheduledAt: string | null, now: Date): boolean {
  return scheduledAt !== null && now.getTime() - Date.parse(scheduledAt) > OVERDUE_MS;
}

const isFuture = (at: string | null, now: Date) => at !== null && Date.parse(at) > now.getTime();
const LIVE_POST = new Set(["approved", "publishing"]);

export function summariseNeedsYou(input: NeedsYouInput, now = new Date()): NeedsYou {
  const pendingPosts = input.posts.filter((p) => p.status === "pending_approval").length;
  const pendingPins = input.pins.filter((p) => p.status === "pending_approval").length;
  const approval = { count: pendingPosts + pendingPins + input.pendingLinks, posts: pendingPosts, pins: pendingPins, links: input.pendingLinks };

  const failed =
    input.posts.filter((p) => p.status === "failed").length +
    input.pins.filter((p) => p.status === "failed").length +
    input.targets.filter((t) => t.status === "failed").length +
    input.jobs.filter((j) => j.status === "failed").length;
  const liveTargets = input.targets.filter((t) => t.status === "pending" && LIVE_POST.has(t.post_status));
  const approvedPins = input.pins.filter((p) => p.status === "approved");
  const overdue = liveTargets.filter((t) => isOverdue(t.scheduled_at, now)).length + approvedPins.filter((p) => isOverdue(p.scheduled_at, now)).length;
  const attention = { count: failed + overdue + input.failingConnections, failed, overdue, connections: input.failingConnections };

  const mcp = input.jobs.filter((j) => j.runner === "mcp");
  const claude = { count: mcp.filter((j) => j.status === "queued").length, inProgress: mcp.filter((j) => j.status === "claimed" || j.status === "running").length };

  const scheduled = liveTargets.filter((t) => t.post_status === "approved" && isFuture(t.scheduled_at, now)).length + approvedPins.filter((p) => isFuture(p.scheduled_at, now)).length;

  return { total: approval.count + attention.count + claude.count, approval, attention, claude, scheduled };
}


export type CheckState = "ok" | "pending" | "warn";
export type HealthCheck = { key: string; state: CheckState; label: string; detail: string; href?: string };
export type HealthInput = {
  slug: string;
  providers: Provider[];
  connections: { provider: string; status: string; last_checked: string | null; last_error: string | null }[];
  metaExpiresAt: string | null;
  overdue: number;
  lastPublishedAt: string | null;
  syncRuns: { source: string; last_ok_at: string | null; last_error: string | null }[];
};
export type Health = { checks: HealthCheck[]; allGood: boolean };

/** What you lose while a provider is not connected. */
const NOT_CONNECTED: Record<Provider, string> = {
  wordpress: "blog can't publish",
  meta: "drafts only",
  meta_ads: "no ad metrics",
  google_analytics: "no traffic data",
  search_console: "no search data",
  pinterest: "pins stay drafts",
  semrush: "keyword data from CSV/GSC only",
  gbp: "no Google posts",
};
export const EXPIRY_WARN_DAYS = 7;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function metaExpiry(expiresAt: string, now: Date): { state: CheckState; suffix: string } {
  const days = daysUntil(expiresAt, now);
  if (days < 0) return { state: "warn", suffix: ` — data access expired ${shortDate(expiresAt)} — reconnect Meta` };
  if (days <= EXPIRY_WARN_DAYS) return { state: "warn", suffix: ` — data access expires in ${days} day${days === 1 ? "" : "s"} (${shortDate(expiresAt)}) — reconnect Meta` };
  return { state: "ok", suffix: ` — data access good through ${shortDate(expiresAt)}` };
}

export function deriveHealthChecks(input: HealthInput, now = new Date()): Health {
  const checks: HealthCheck[] = [];
  const connectionsHref = `/brands/${input.slug}/connections`;

  if (input.overdue > 0) checks.push({ key: "publisher", state: "warn", label: "Publisher", detail: `${input.overdue} item${input.overdue === 1 ? "" : "s"} overdue`, href: "/calendar" });
  else checks.push({ key: "publisher", state: "ok", label: "Publisher", detail: input.lastPublishedAt ? `last published ${relativeTime(input.lastPublishedAt, now)}` : "nothing scheduled yet" });

  for (const p of input.providers) {
    const c = input.connections.find((x) => x.provider === p);
    const label = PROVIDER_LABELS[p];
    if (!c || c.status === "not_connected") {
      checks.push({ key: p, state: "pending", label, detail: `Not connected — ${NOT_CONNECTED[p]}`, href: connectionsHref });
    } else if (c.status === "failing") {
      checks.push({ key: p, state: "warn", label, detail: `Failing — ${c.last_error ?? "unknown error"}`, href: connectionsHref });
    } else {
      const checked = c.last_checked ? `checked ${relativeTime(c.last_checked, now)}` : "not checked yet";
      if (p === "meta" && input.metaExpiresAt) {
        const e = metaExpiry(input.metaExpiresAt, now);
        checks.push({ key: p, state: e.state, label, detail: e.state === "ok" ? `Connected — ${checked}${e.suffix}` : `Connected${e.suffix}`, href: connectionsHref });
      } else {
        checks.push({ key: p, state: "ok", label, detail: `Connected — ${checked}`, href: connectionsHref });
      }
    }
  }

  for (const s of input.syncRuns) {
    const label = `${PROVIDER_LABELS[s.source as Provider] ?? s.source} sync`;
    if (s.last_error) checks.push({ key: `sync:${s.source}`, state: "warn", label, detail: s.last_error, href: "/reports" });
    else checks.push({ key: `sync:${s.source}`, state: "ok", label, detail: s.last_ok_at ? `last ok ${relativeTime(s.last_ok_at, now)}` : "not run yet", href: "/reports" });
  }

  return { checks, allGood: checks.every((c) => c.state === "ok") };
}

export type GscArticle = { id: string; title: string; status: string; wp_link: string | null; pushed_at: string | null; gsc_submitted_at: string | null };

/** Articles the app pushed to WordPress that nobody has yet submitted to Search Console. Newest push first. */
export function gscQueue<T extends GscArticle>(articles: T[]): T[] {
  return articles
    .filter((a) => a.wp_link && (a.status === "pushed_to_wp" || a.status === "published") && !a.gsc_submitted_at)
    .sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
}

/** Overview ordering: most to do first, failures ahead of mere approvals, then alphabetical. */
export function sortByNeeds<T extends { name: string; needs: { total: number; attention: { count: number } } }>(brands: T[]): T[] {
  return [...brands].sort((a, b) => b.needs.total - a.needs.total || b.needs.attention.count - a.needs.attention.count || a.name.localeCompare(b.name));
}
