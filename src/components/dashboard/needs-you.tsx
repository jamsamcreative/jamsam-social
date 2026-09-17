import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { NeedsYou } from "@/lib/dashboard/brand-summary";

function Tile({ title, count, sub, href }: { title: string; count: number; sub: string; href: string }) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-1 p-4">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-semibold tabular-nums">{count}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function NeedsYouSection({ needs, slug }: { needs: NeedsYou; slug: string }) {
  const { approval, attention, claude } = needs;
  const approvalSub =
    approval.count === 0
      ? "Nothing publishes until you approve it"
      : [approval.posts && plural(approval.posts, "post"), approval.pins && plural(approval.pins, "pin"), approval.links && plural(approval.links, "internal link")].filter(Boolean).join(" · ");
  const attentionSub =
    attention.count === 0
      ? "Nothing failed or overdue"
      : [attention.failed && `${attention.failed} failed`, attention.overdue && `${attention.overdue} overdue`, attention.connections && plural(attention.connections, "failing connection")].filter(Boolean).join(" · ");
  const claudeSub =
    claude.count === 0
      ? claude.inProgress
        ? `${claude.inProgress} in progress`
        : "Open Claude with the connector to write these"
      : `Open Claude with the connector to write these${claude.inProgress ? ` · ${claude.inProgress} in progress` : ""}`;
  const approvalHref = approval.links > 0 && approval.posts === 0 && approval.pins === 0 ? "/blog/links" : approval.pins > 0 && approval.posts === 0 ? "/pins?status=pending" : "/posts?status=pending";
  const attentionHref =
    attention.connections > 0 && attention.failed === 0 && attention.overdue === 0 ? `/brands/${slug}/connections` : attention.overdue > 0 && attention.failed === 0 ? "/calendar" : "/jobs";

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs you</h2>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <span className="text-5xl font-bold tabular-nums">{needs.total}</span>
            <div>
              <p className="font-medium">Open items</p>
              <p className="text-sm text-muted-foreground">across approvals, publishing, writing and SEO</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">{needs.scheduled}</span>
            <div className="text-sm">
              <p>approved and scheduled</p>
              <Link href="/calendar" className="text-xs underline">
                See the calendar →
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Tile title="Awaiting approval" count={approval.count} sub={approvalSub} href={approvalHref} />
        <Tile title="Needs attention" count={attention.count} sub={attentionSub} href={attentionHref} />
        <Tile title="Waiting on Claude" count={claude.count} sub={claudeSub} href="/jobs" />
      </div>
    </section>
  );
}
