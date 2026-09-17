import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SuggestionCard as SuggestionCardData } from "@/lib/links/queries";

/** Wraps the first case-insensitive occurrence of `phrase` in `context` with `<mark>`, preserving the context's own casing. Safe — split the string, no `dangerouslySetInnerHTML`. */
function highlightPhrase(context: string, phrase: string): ReactNode {
  if (!phrase) return context;
  const idx = context.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx === -1) return context;
  const before = context.slice(0, idx);
  const match = context.slice(idx, idx + phrase.length);
  const after = context.slice(idx + phrase.length);
  return (
    <>
      {before}
      <mark className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-900/60">{match}</mark>
      {after}
    </>
  );
}

type Props = { suggestion: SuggestionCardData; disabled: boolean; onApprove: () => void; onReject: () => void };

/** One pending suggestion: orphan + host + the phrase in context, highlighted. Approve/Reject share the page's single `disabled` flag. */
export function SuggestionCard({ suggestion: s, disabled, onApprove, onReject }: Props) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <a href={s.orphanUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {s.orphanTitle}
          </a>
          <Badge variant="outline">Orphaned</Badge>
          <span className="text-xs text-muted-foreground">{s.brandName}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{s.orphanUrl}</p>
        <p className="text-sm">
          Link from: <a href={s.hostUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">{s.hostTitle}</a>
        </p>
        <p className="text-sm text-muted-foreground">{highlightPhrase(s.context, s.phrase)}</p>
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={disabled} onClick={onApprove}>Approve</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onReject}>Reject</Button>
        </div>
      </CardContent>
    </Card>
  );
}
