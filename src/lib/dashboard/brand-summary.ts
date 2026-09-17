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
