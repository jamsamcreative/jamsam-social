import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiModelSelect } from "@/components/settings/ai-model-select";
import { RunnerSelect } from "@/components/settings/runner-select";
import { getSetting, getDefaultRunner } from "@/lib/settings/queries";
import { DEFAULT_MODEL } from "@/lib/settings/models";
import { env } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";
import { createSupabaseOauthStore } from "@/lib/oauth/store";
import { ConnectedApps } from "@/components/settings/connected-apps";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [model, runner] = await Promise.all([getSetting("ai_model").then((v) => v ?? DEFAULT_MODEL), getDefaultRunner()]);
  const mcpUrl = `${env.NEXT_PUBLIC_APP_URL}/api/mcp`;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const apps = user ? (await createSupabaseOauthStore().listTokensForUser(user.id)).map((t) => ({ id: t.id, client_name: t.client_name, created_at: t.created_at, last_used_at: t.last_used_at })) : [];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Default runner</p>
            <p className="text-sm text-muted-foreground">
              MCP queues jobs for your own Claude session (free with your Claude subscription). In-app calls the Anthropic API immediately and bills per job.
            </p>
            <RunnerSelect value={runner} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">In-app model</p>
            <p className="text-sm text-muted-foreground">Used only by in-app jobs. Anthropic key: {env.ANTHROPIC_API_KEY ? "configured" : "not set (in-app jobs will fail)"}.</p>
            <AiModelSelect value={model} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MCP server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Connect a Claude session to write directly into this app. URL: <code>{mcpUrl}</code>.
          </p>
          <p className="font-medium">Claude.ai (web, phone, desktop)</p>
          <p>Settings → Connectors → Add custom connector → paste the URL above → Connect. You&apos;ll sign in to JamSam Social and click Allow.</p>
          <div className="space-y-1">
            <p className="font-medium">Connected apps</p>
            <ConnectedApps apps={apps} />
          </div>
          <p className="font-medium">Claude Code (uses the static <code>MCP_TOKEN</code> env var)</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{`claude mcp add --transport http jamsam ${mcpUrl} --header "Authorization: Bearer $MCP_TOKEN"`}</pre>
          <p className="text-muted-foreground">
            Jobs created with runner &quot;Queue for MCP&quot; wait on <code>list_jobs</code> until a connected session claims them.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Business Profile posting {env.GBP_ENABLED === "true" ? "(enabled)" : "(not enabled)"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Approved posts can also go out as Google posts to each client&apos;s Business Profile locations. Google gates this API behind an access request:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In the Google Cloud project, enable <i>My Business Account Management API</i>, <i>My Business Business Information API</i> and <i>Google My Business API</i>.</li>
            <li>Request access: <a className="underline" href="https://developers.google.com/my-business/content/prereqs#request-access" target="_blank" rel="noreferrer">developers.google.com/my-business → Request access</a> (uses the project ID; approval usually takes days to a couple of weeks).</li>
            <li>Create an OAuth client (Web application) with redirect URI <code>{env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback</code>; set <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code> and <code>GBP_ENABLED=true</code> on Vercel.</li>
            <li>Then each brand gets a &quot;Google Business Profile&quot; card under Connections with a Connect Google button and a location picker.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
