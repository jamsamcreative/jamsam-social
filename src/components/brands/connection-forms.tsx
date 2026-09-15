import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type React from "react";
import type { Provider } from "@/lib/connections/types";

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string; type?: string };

export const FIELDS: Record<Provider, Field[]> = {
  wordpress: [
    { name: "site_url", label: "Site URL", placeholder: "https://client.com", type: "url" },
    { name: "username", label: "WordPress username" },
    {
      name: "app_password",
      label: "Application password",
      secret: true,
      help: "WP Admin → Users → Profile → Application Passwords. Leave blank to keep the saved one.",
    },
  ],
  meta: [
    { name: "page_id", label: "Facebook Page ID" },
    {
      name: "page_access_token",
      label: "Page access token (long-lived)",
      secret: true,
      help: "From Graph API Explorer with pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish. Leave blank to keep the saved one.",
    },
  ],
  pinterest: [
    {
      name: "access_token",
      label: "Access token",
      secret: true,
      help: "From your Pinterest developer app with boards:read, pins:read, pins:write. Leave blank to keep the saved one.",
    },
    { name: "refresh_token", label: "Refresh token (optional)", secret: true },
  ],
  semrush: [
    { name: "database", label: "Database", placeholder: "us" },
    { name: "competitors", label: "Competitor domains (comma separated, up to 5)", placeholder: "dcbuilding.com, mqsbarn.com", help: "Used for the keyword gap refresh on the SEO page." },
    { name: "api_key", label: "API key", secret: true, help: "Needs a Business plan with API units (v3 Analytics API key). On Pro/Guru, ask Claude to pull SEMrush data with the import_keywords tool instead. Leave blank to keep the saved one." },
  ],
  google_analytics: [{ name: "property_id", label: "GA4 property ID", placeholder: "450532525", help: "Numeric ID from GA4 → Admin → Property settings. Google Ads spend appears automatically when the Ads account is linked to this property." }],
  search_console: [{ name: "site_url", label: "Search Console property", placeholder: "sc-domain:client.com", help: "Domain property: sc-domain:client.com. URL-prefix property: https://client.com/ (with trailing slash)." }],
  meta_ads: [
    { name: "ad_account_id", label: "Ad account ID", placeholder: "act_1234567890" },
    { name: "access_token", label: "Marketing API token (ads_read)", secret: true, help: "A user/system-user token with ads_read for the client's ad account. This is separate from the Page token used for publishing. Leave blank to keep the saved one." },
  ],
  gbp: [],
};

export function ConnectionFields({ provider, config, extras }: { provider: Provider; config: Record<string, unknown>; extras?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      {extras}
      {FIELDS[provider].map((f) => (
        <div key={f.name} className="space-y-1">
          <Label htmlFor={`${provider}-${f.name}`}>{f.label}</Label>
          <Input
            id={`${provider}-${f.name}`}
            name={f.name}
            type={f.secret ? "password" : (f.type ?? "text")}
            placeholder={f.placeholder}
            defaultValue={f.secret ? "" : Array.isArray(config[f.name]) ? (config[f.name] as string[]).join(", ") : String(config[f.name] ?? "")}
            autoComplete="off"
          />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          {provider === "wordpress" && f.name === "app_password" && (
            <p className="text-xs text-muted-foreground">
              For Yoast SEO fields, install the{" "}
              <a href="/api/wp-plugin/jamsam-connector.zip" className="underline">
                JamSam helper plugin
              </a>{" "}
              on the site (Plugins → Add New → Upload Plugin).
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
