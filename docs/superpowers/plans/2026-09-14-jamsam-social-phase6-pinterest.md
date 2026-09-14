# JamSam Social Phase 6: Pinterest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pinterest boards sync, pin drafts with approval + cron scheduling + publishing, nightly pin analytics, AI pin jobs (single + bulk from the content bank), MCP tools.

**Architecture:** Mirrors Phase 2 posts: a `pins` table with the same status machine, `claim_due_pins`/`reset_stale_pins` RPCs, `processPin(pin, deps)` pure over injected deps, a Pinterest client (`src/lib/pinterest/`) with OAuth + token refresh, a `pin` job type wired through the existing runner/tools, and UI pages under `/pins`.

**Tech Stack:** Next.js 16, Supabase, Pinterest API v5, zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-jamsam-social-phase6-pinterest-design.md`

## Global Constraints

- `validatePin` rules are enforced in code before any pin reaches `pending_approval` or Pinterest.
- Tokens are refreshed via `withPinterestToken(brandId)`; never call Pinterest with a token that expires in < 3 days without refreshing first.
- Approve requires `scheduled_at`; publishing only happens from the cron claim loop (or Publish now = approve with now).
- Commit per task with the standard trailers; typecheck/lint/test green before each commit.

---

### Task 1: Migration, types, env, Pinterest client + OAuth
- `0010_pinterest.sql` (enum, `pin_boards`, `pins`, RPCs, RLS, job_type 'pin'); DB types; env `PINTEREST_APP_ID/SECRET` optional.
- `src/lib/pinterest/client.ts`: `pinterestAuthUrl`, `exchangeCode`, `refreshToken`, `listBoards`, `createPin`, `pinAnalytics`, `userAccount`; `withPinterestToken(brandId)` in `src/lib/pinterest/token.ts` (refresh + persist + failing state). Routes `/api/auth/pinterest/{start,callback}`. Tests with fake fetch.

### Task 2: Pin domain (pure) + queries/actions
- `src/lib/pins/rules.ts`: `validatePin`, `buildPinPayload`; `src/lib/pins/status.ts`: transitions. Tests.
- `src/lib/pins/queries.ts`, `src/lib/pins/actions.ts`: save, submit, approve (schedule), publishNow, retry, archive, reschedule, syncBoards.
- Store: `listBoards`, `createPinDraft`, `listRecentPinTitles`, `listUnpinned`.

### Task 3: Publisher + analytics
- `src/lib/publishers/pins.ts`: `processPin(pin, deps)`; extend `runPublishCycle` with pins; `src/lib/insights/pins.ts` nightly analytics for pins ≤ 90 days; board medians helper. Tests.

### Task 4: AI pin jobs + tools
- Schemas (`pin` input/result), instructions, brief (asset/project + boards + recent titles), tools `list_pin_boards`, `create_pin`, `list_unpinned`; runner terminal tool `create_pin`. Tests.

### Task 5: UI
- `/pins` list, `/pins/new`, `/pins/[id]`, `PinForm` with image picker (media + projects), board select + Sync boards, ✨ Write pin; `PinActions`; calendar pin chips; connection card Connect Pinterest + boards; content bank bulk "Queue pin jobs"; media card "Write a pin"; Reports content tab pins.

### Task 6: E2E, live, deploy, merge
- E2E draft → submit → approve → calendar → archive. Live after trial approval. Deploy, PR, merge.
