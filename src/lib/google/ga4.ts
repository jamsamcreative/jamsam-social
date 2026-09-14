import { googleJson, type GoogleDeps } from "./api";

export type Ga4Row = { dims: string[]; metrics: number[] };
export type Ga4ReportBody = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  limit?: number;
  orderBys?: unknown[];
  dimensionFilter?: unknown;
};
type Raw = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
};

export async function ga4RunReport(propertyId: string, body: Ga4ReportBody, deps: GoogleDeps) {
  const raw = await googleJson<Raw>(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, deps, { method: "POST", body: JSON.stringify({ limit: 100000, ...body }) });
  return {
    dimensionHeaders: (raw.dimensionHeaders ?? []).map((h) => h.name),
    metricHeaders: (raw.metricHeaders ?? []).map((h) => h.name),
    rows: (raw.rows ?? []).map((r) => ({ dims: (r.dimensionValues ?? []).map((v) => v.value), metrics: (r.metricValues ?? []).map((v) => Number(v.value) || 0) })) as Ga4Row[],
  };
}

export async function ga4ListKeyEvents(propertyId: string, deps: GoogleDeps): Promise<{ eventName: string }[]> {
  const raw = await googleJson<{ keyEvents?: { eventName: string }[] }>(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/keyEvents?pageSize=200`, deps);
  return (raw.keyEvents ?? []).map((k) => ({ eventName: k.eventName }));
}

export async function ga4PropertyName(propertyId: string, deps: GoogleDeps): Promise<string | null> {
  try {
    const raw = await googleJson<{ displayName?: string }>(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`, deps);
    return raw.displayName ?? null;
  } catch {
    return null;
  }
}
