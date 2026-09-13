# JamSam Social

Multi-client marketing-ops platform for JamSam Digital. Next.js + Supabase on Vercel.

## Local setup
1. `cp .env.example .env.local` and fill in values (see spec for where each comes from).
2. `npm install`
3. `npm run dev` → http://localhost:3000

## Database
Migrations live in `supabase/migrations`. Apply with `npx supabase db push` (after `npx supabase link --project-ref dpihndeejbirskdrjfeh`).

## Tests
- `npm test` — unit (Vitest)
- `npm run e2e` — Playwright smoke (needs E2E_EMAIL/E2E_PASSWORD in .env.local)

Specs and plans: `docs/superpowers/`.
