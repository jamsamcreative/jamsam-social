export const fmtMoney = (n: number | null, digits = 0) => (n === null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
export const fmtInt = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtPct = (n: number | null, digits = 1) => (n === null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const fmtPos = (n: number | null) => (n === null ? "—" : n.toFixed(1));
export const fmtDelta = (n: number | null) => (n === null ? null : `${n >= 0 ? "+" : ""}${Math.round(n)}%`);
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
