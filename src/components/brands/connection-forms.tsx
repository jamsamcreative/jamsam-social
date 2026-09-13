import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    { name: "api_key", label: "API key", secret: true, help: "Leave blank to keep the saved one." },
  ],
};

export function ConnectionFields({ provider, config }: { provider: Provider; config: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      {FIELDS[provider].map((f) => (
        <div key={f.name} className="space-y-1">
          <Label htmlFor={`${provider}-${f.name}`}>{f.label}</Label>
          <Input
            id={`${provider}-${f.name}`}
            name={f.name}
            type={f.secret ? "password" : (f.type ?? "text")}
            placeholder={f.placeholder}
            defaultValue={f.secret ? "" : String(config[f.name] ?? "")}
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
