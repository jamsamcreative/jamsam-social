"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { enqueueJob } from "@/lib/jobs/actions";

type Decision = "new" | "rewrite" | "optimize";
type Runner = "in_app" | "mcp";

export function NewFromBrief({ brandId, defaultRunner }: { brandId: string; defaultRunner: Runner }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [decision, setDecision] = useState<Decision>("new");
  const [notes, setNotes] = useState("");
  const [runner, setRunner] = useState<Runner>(defaultRunner);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () =>
    start(async () => {
      const r = await enqueueJob({
        brandId,
        type: "article",
        runner,
        input: {
          topic,
          primary_keyword: primary || undefined,
          secondary_keywords: secondary.split(",").map((s) => s.trim()).filter(Boolean),
          decision,
          notes: notes || undefined,
        },
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(runner === "mcp" ? "Queued — run it from your Claude session (see Jobs)" : "Writing article — see Jobs");
      setOpen(false);
      router.push("/jobs");
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        ✨ New from brief
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write an article with AI</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="topic">Topic</Label>
              <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="How to stain a cedar deck in Spokane" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pk">Primary keyword</Label>
                <Input id="pk" value={primary} onChange={(e) => setPrimary(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sk">Secondary keywords (comma separated)</Label>
                <Input id="sk" value={secondary} onChange={(e) => setSecondary(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="brief-decision">Decision</Label>
                <select id="brief-decision" value={decision} onChange={(e) => setDecision(e.target.value as Decision)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
                  <option value="new">New article</option>
                  <option value="rewrite">Rewrite</option>
                  <option value="optimize">Optimize</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="brief-runner">Runner</Label>
                <select id="brief-runner" value={runner} onChange={(e) => setRunner(e.target.value as Runner)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
                  <option value="mcp">MCP — your Claude account (free)</option>
                  <option value="in_app">In-app — Anthropic API (paid)</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Angle, must-mention points, links to include…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || topic.trim().length < 3} onClick={submit}>
              {pending ? "Queuing…" : "Write article"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
