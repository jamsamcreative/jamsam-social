import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiModelSelect } from "@/components/settings/ai-model-select";
import { getSetting } from "@/lib/settings/queries";
import { DEFAULT_MODEL } from "@/lib/settings/models";
import { env } from "@/lib/env";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const model = (await getSetting("ai_model")) ?? DEFAULT_MODEL;
  const mcpUrl = `${env.NEXT_PUBLIC_APP_URL}/api/mcp`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Model used by in-app jobs. Anthropic key: {env.ANTHROPIC_API_KEY ? "configured" : "missing"}.</p>
          <AiModelSelect value={model} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MCP server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Connect a Claude session to write directly into this app. URL: <code>{mcpUrl}</code>. Token: the <code>MCP_TOKEN</code> environment variable (not shown here).
          </p>
          <p className="font-medium">Claude Code</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{`claude mcp add --transport http jamsam ${mcpUrl} --header "Authorization: Bearer $MCP_TOKEN"`}</pre>
          <p className="font-medium">Claude.ai</p>
          <p>Settings → Connectors → Add custom connector → URL above; when asked for authentication, paste the token as a Bearer token.</p>
          <p className="text-muted-foreground">
            Jobs created with runner &quot;Queue for MCP&quot; wait on <code>list_jobs</code> until a connected session claims them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
