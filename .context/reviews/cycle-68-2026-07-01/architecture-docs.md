# Cycle 68 Architecture / Docs Review

Reviewer: main-lane architecture/docs
Date: 2026-07-01
HEAD reviewed: `e221b01a` (`fix(cycle-67): 🐛 align backfill warnings and controls`)

## Inventory

Required context read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-67-2026-07-01/_aggregate.md`
- `.context/plans/cycle-67-2026-07-01-plan.md`
- `.context/plans/cycle-67-2026-07-01-deferred.md`

Review-relevant surfaces inspected:

- Cycle 67 review and plan ledgers.
- Root deploy/package contract and deploy documentation in `CLAUDE.md`.
- Settings submit/warning/update flow: `apps/web/src/lib/settings-submit-payload.ts`, `apps/web/src/lib/settings-backfill-warning.ts`, `apps/web/src/app/actions/settings.ts`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`.
- CLIP sidecar source contract: `apps/web/scripts/backfill-clip-embeddings.ts` and `apps/web/src/__tests__/cycle-6-source-contracts.test.ts`.
- Current messages for backfill operator copy in `apps/web/messages/en.json` and `apps/web/messages/ko.json`.

## Findings

### AD68-01 - Settings diff paths treat whitespace-only scalar edits as byte-impacting changes

- Severity/confidence: Low / High.
- File/line: `apps/web/src/lib/settings-submit-payload.ts:3-8`, `apps/web/src/lib/settings-backfill-warning.ts:13-22`, `apps/web/src/app/actions/settings.ts:60-66`, `apps/web/src/app/actions/settings.ts:157-167`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:180-185`.
- Evidence: `image_sizes` is canonicalized before diffing and persistence, but scalar settings return raw strings. The server validates `Number('90 ')` as a valid numeric setting and upserts the raw string.
- Failure scenario: an admin edits `image_quality_jpeg` from `90` to `90 `, saves, and the DB stores the whitespace-bearing value. Runtime config still resolves to `90`, but the Settings warning logic compares raw strings and treats the value as a derivative-byte change, causing an unnecessary re-encode warning.
- Fix direction: share a client-safe setting-value canonicalizer across submit payloads and warning comparisons, trimming scalar settings and preserving the existing `image_sizes` canonicalization. Use the same helper server-side before validation/upsert so persisted settings are canonical.

## Ledger / Docs Drift

No new deploy/docs drift confirmed. Cycle 67 plan state and aggregate pointer are current at `e221b01a`. The root deploy policy still names `npm run deploy` from the repo root and keeps the deploy target config-owned by `.env.deploy` / the fallback secret file.

## Deferred / Not Re-raised

No new architecture/docs findings are deferred. Carry-forward deferred items from Cycle 67 remain explicitly tracked and were not re-raised without new severity evidence.
