export function McpHint({ mcpUrl, waiting }: { mcpUrl: string; waiting: number }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <p>
        <span className="font-medium">
          {waiting} job{waiting === 1 ? "" : "s"} waiting for your Claude session.
        </span>{" "}
        Jobs on the MCP runner are written by Claude Code or Claude.ai using your own account (no API charges). Connect once, then tell Claude to
        &quot;check jamsam jobs and do the queued ones&quot;.
      </p>
      <pre className="overflow-x-auto rounded bg-background p-2 text-xs">{`claude mcp add --transport http jamsam ${mcpUrl} --header "Authorization: Bearer $MCP_TOKEN"`}</pre>
    </div>
  );
}
