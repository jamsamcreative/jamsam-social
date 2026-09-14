"use client";
import { toast } from "sonner";

export function GoogleGrantSteps({ email, product }: { email: string | null; product: "ga4" | "gsc" }) {
  if (!email) return <p className="text-sm text-destructive">GOOGLE_SERVICE_ACCOUNT_JSON is not configured on the server, so Google connections can&apos;t be tested yet.</p>;
  const copy = () => navigator.clipboard.writeText(email).then(() => toast.success("Copied"));
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
      <p className="font-medium">Grant access to JamSam&apos;s service account:</p>
      <p className="flex items-center gap-2">
        <code className="break-all">{email}</code>
        <button type="button" className="underline" onClick={copy}>
          Copy
        </button>
      </p>
      {product === "ga4" ? (
        <p>GA4 → Admin → Property → Property access management → Add users → paste the email → role <b>Viewer</b>. The property ID is the number under Admin → Property settings.</p>
      ) : (
        <p>Search Console → Settings → Users and permissions → Add user → paste the email → <b>Full</b> (or Restricted). Use <code>sc-domain:client.com</code> for a domain property.</p>
      )}
    </div>
  );
}
