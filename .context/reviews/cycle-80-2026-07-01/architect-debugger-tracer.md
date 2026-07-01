# Cycle 80 Architect / Debugger / Tracer

Start HEAD: `8c4999c9294e0196608b4a0bce8078edc3be2366`.

## Inventory

- Read `AGENTS.md`, `CLAUDE.md`, deploy/Docker/Compose docs, site-config usage, DB-mutating sidecar scripts, restore-maintenance durable guards, semantic search, upload/restore trust boundaries, and recent carry-forward plans.
- Known deferred items (`C77-ARCH-01`, `C76-04`, `C76-05`, `C75-08`) were not re-raised without new evidence.

## Findings

### C80-04 - Alt-text backfill can write during restore maintenance

- Severity: Medium
- Confidence: High
- Citations: `apps/web/scripts/backfill-alt-text.ts:30`, `apps/web/scripts/backfill-alt-text.ts:49`, `apps/web/scripts/backfill-alt-text.ts:75`, `apps/web/scripts/backfill-alt-text.ts:107`, `apps/web/src/lib/restore-maintenance-durable.ts:57`, `apps/web/scripts/backfill-clip-embeddings.ts:109`, `apps/web/scripts/backfill-color-pipeline.ts:320`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:18`
- Problem: Color and CLIP DB-mutating sidecars fail closed when the durable restore-maintenance marker is active, but `backfill-alt-text.ts` reads and updates `images.alt_text_suggested` without the script guard.
- Failure scenario: an operator runs alt-text backfill during a restore; it can interleave with import/drop/repopulate work and leave failed or stale writes.
- Suggested fix: import `assertNoDurableRestoreMaintenanceForScript`, define a script name, guard before candidate reads and before batched writes, and extend the sidecar-guard source contract test.

### C80-06 - `site-config.json` runtime/build-time contract is ambiguous

- Severity: Medium
- Confidence: Medium-High
- Citations: `apps/web/docker-compose.yml:24`, `CLAUDE.md:477`, `apps/web/README.md:55`, `CLAUDE.md:663`, `apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/components/nav-client.tsx:14`, `apps/web/src/lib/data.ts:1794`
- Problem: Docs and Compose mount `src/site-config.json` as runtime config, while application code imports it statically as build-time JSON.
- Failure scenario: an operator changes the mounted file and restarts the container expecting links, analytics, or fallback SEO to change, but bundled static values may continue to serve.
- Suggested fix: choose and implement one contract: runtime loader with validation and explicit client-safe propagation, or build-time-only docs/compose cleanup.

## Final Sweep

No fresh product-policy drift around editing/culling/scoring or storage-backend exposure was found.
