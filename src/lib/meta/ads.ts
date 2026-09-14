import { META_GRAPH } from "@/lib/connections/meta";
import { fetchWithTimeout } from "@/lib/connections/http";

export type MetaInsightRow = {
  date_start: string;
  date_stop: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  clicks?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
};
type Paged<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string } };

async function graph<T>(url: string, fetchImpl: typeof fetch): Promise<Paged<T>> {
  const res = await fetchWithTimeout(url, {}, 30_000, fetchImpl);
  const body = (await res.json()) as Paged<T>;
  if (!res.ok) throw new Error(`Meta responded ${res.status}: ${body.error?.message ?? "unknown error"}`);
  return body;
}

export async function metaAdAccounts(token: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string; currency: string }[]> {
  const u = new URL(`${META_GRAPH}/me/adaccounts`);
  u.searchParams.set("fields", "id,name,currency,account_status");
  u.searchParams.set("limit", "100");
  u.searchParams.set("access_token", token);
  const body = await graph<{ id: string; name: string; currency: string }>(u.toString(), fetchImpl);
  return (body.data ?? []).map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
}

export async function metaAdAccountInfo(adAccountId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<{ name: string; currency: string }> {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const u = new URL(`${META_GRAPH}/${id}`);
  u.searchParams.set("fields", "name,currency");
  u.searchParams.set("access_token", token);
  const res = await fetchWithTimeout(u, {}, 15_000, fetchImpl);
  const body = (await res.json()) as { name?: string; currency?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`Meta responded ${res.status}: ${body.error?.message ?? "unknown error"}`);
  return { name: body.name ?? id, currency: body.currency ?? "USD" };
}

/** Daily insights, campaign or account level, following pagination. */
export async function metaAdInsights(
  adAccountId: string,
  token: string,
  opts: { since: string; until: string; level: "campaign" | "account" },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaInsightRow[]> {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const u = new URL(`${META_GRAPH}/${id}/insights`);
  u.searchParams.set("level", opts.level);
  u.searchParams.set("time_increment", "1");
  u.searchParams.set("time_range", JSON.stringify({ since: opts.since, until: opts.until }));
  u.searchParams.set("fields", "date_start,date_stop,campaign_id,campaign_name,spend,clicks,impressions,inline_link_clicks,actions");
  u.searchParams.set("limit", "500");
  u.searchParams.set("access_token", token);
  const out: MetaInsightRow[] = [];
  let next: string | undefined = u.toString();
  for (let page = 0; next && page < 50; page++) {
    const body: Paged<MetaInsightRow> = await graph<MetaInsightRow>(next, fetchImpl);
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return out;
}
