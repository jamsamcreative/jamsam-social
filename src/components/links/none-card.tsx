import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { NoneCard as NoneCardData } from "@/lib/links/queries";
import type { NoneReason } from "@/lib/links/types";

/** Verdict headline + explanation per `NoneCard.reason`, worded per spec §UI. */
const VERDICTS: Record<NoneReason, { headline: string; body: string }> = {
  "site-wide term": {
    headline: "The topic words are site-wide terms",
    body: "Every phrase that does appear is a site-wide term for this brand, so linking it would fire on nearly every article instead of pointing at this one. Add the link by hand where it genuinely belongs.",
  },
  "only inside itself or in posts that already link here": {
    headline: "Nowhere left to add it",
    body: "The phrase was found, but only inside this post itself or in articles that already link here. Check whether it's really orphaned — its inbound links may all be coming from index pages, which don't count.",
  },
  "no other post mentions the topic": {
    headline: "No other article mentions the topic",
    body: "The phrases below appear in no other post's running text, so there are no words to wrap. This one needs a sentence written into a related article before a link can exist.",
  },
};

/** One orphan with no safe suggestion: title/url/brand, the verdict for its reason, and the phrases that were tried. */
export function NoneCard({ none: n }: { none: NoneCardData }) {
  const verdict = VERDICTS[n.reason as NoneReason] ?? { headline: n.reason, body: "" };
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <a href={n.orphanUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {n.orphanTitle}
          </a>
          {n.utility && <Badge variant="outline">Utility page</Badge>}
          <span className="text-xs text-muted-foreground">{n.brandName}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{n.orphanUrl}</p>
        <p className="font-medium">{verdict.headline}</p>
        <p className="text-sm text-muted-foreground">{verdict.body}</p>
        {n.phrasesTried.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-sm underline underline-offset-2">Phrases tried ({n.phrasesTried.length})</summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {n.phrasesTried.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
