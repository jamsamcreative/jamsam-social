"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { suggestIdeasPrompt, writePostPrompt } from "@/lib/blog/claude-prompts";

export type Suggested = { keyword: string; volume: number | null; difficulty: number | null; competitor: string | null; competitor_position: number | null; action: string };

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied — paste it into Claude`);
  } catch {
    toast.error("Could not copy; select the text and copy it by hand");
  }
}

export function ClaudePrompts({ brandSlug, brandName, suggested }: { brandSlug: string; brandName: string; suggested: Suggested[] }) {
  const [keyword, setKeyword] = useState("");
  const ideas = suggestIdeasPrompt(brandSlug, brandName);
  const write = writePostPrompt(brandSlug, brandName, keyword || undefined);
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide">Create blog posts with Claude</h2>
        <p className="text-sm text-muted-foreground">Paste a prompt into Claude (Desktop, Code or claude.ai) connected to JamSam Social. Drafts land in the list below for you to review — nothing is pushed to WordPress until you do it.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">1 · Suggest blog post ideas</h3>
            <Button size="sm" variant="outline" onClick={() => copy(ideas, "Ideas prompt")}>Copy prompt</Button>
          </div>
          <p className="text-xs text-muted-foreground">Claude reads this brand&apos;s SEMrush and keyword data, drops topics the site already covers, and hands back a ranked shortlist.</p>
          <Textarea readOnly value={ideas} rows={7} className="font-mono text-xs" aria-label="Suggest ideas prompt" />
        </div>
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">2 · Write a blog post</h3>
            <Button size="sm" variant="outline" onClick={() => copy(write, "Write prompt")}>Copy prompt</Button>
          </div>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Target keyword (optional — Claude picks one if blank)" aria-label="Target keyword" />
          <Textarea readOnly value={write} rows={7} className="font-mono text-xs" aria-label="Write post prompt" />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide">Suggested opportunities for {brandName}</h3>
        {suggested.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keyword data yet — import SEMrush data on the SEO page, or ask Claude to run import_keywords.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {suggested.map((s) => (
              <li key={s.keyword} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span>
                  <span className="font-medium">{s.keyword}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {s.volume !== null ? `${s.volume.toLocaleString("en-US")} vol` : "— vol"} · {s.difficulty !== null ? `KD ${s.difficulty}` : "KD —"}
                    {s.competitor ? ` · ${s.competitor}${s.competitor_position ? ` #${s.competitor_position}` : ""}` : ""} · {s.action}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => { setKeyword(s.keyword); void copy(writePostPrompt(brandSlug, brandName, s.keyword), `Prompt for "${s.keyword}"`); }}>Copy prompt</Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Straight from the ranked keyword gap data. &ldquo;Copy prompt&rdquo; fills in the keyword so you can hand it to Claude.</p>
      </div>
    </section>
  );
}
