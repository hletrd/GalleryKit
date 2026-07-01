# Cycle 80/100 Deferred Findings

Start HEAD: `8c4999c9294e0196608b4a0bce8078edc3be2366`.
Review aggregate: `.context/reviews/cycle-80-2026-07-01/_aggregate.md`.

## Newly Deferred

### C80-06 - `site-config.json` runtime/build-time contract is ambiguous

- Original severity/confidence: Medium / Medium-High.
- Citation: `apps/web/docker-compose.yml:24`, `CLAUDE.md:477`, `apps/web/README.md:55`, `CLAUDE.md:663`, `apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/components/nav-client.tsx:14`, `apps/web/src/lib/data.ts:1794`.
- Deferral reason: this requires choosing an operator contract across code, Docker Compose, deploy docs, server/client config propagation, and possibly build/runtime validation. A partial patch this cycle could either break runtime mounts or preserve the ambiguity.
- Exit criterion: choose one contract in a dedicated plan: either implement a validated runtime loader and pass client-safe values explicitly, or document/remove the runtime mount and state that `site-config.json` edits require rebuild/deploy. Update `CLAUDE.md`, `apps/web/README.md`, `apps/web/docker-compose.yml`, code imports, and tests together.

## Carry-Forward Deferred

- `C77-ARCH-01`: restore maintenance does not fence in-flight non-upload admin mutations. Exit criterion remains a shared foreground admin mutation barrier used by every application-table writer that can run during restore, with restore closing/draining that barrier before durable maintenance/import and concurrency regression coverage.
- `C76-04`: bottom-sheet dropdown portal coverage is source-shaped only. Exit criterion remains a DOM/runtime test proving dropdown content stays inside the dialog subtree or a shared portal helper with equivalent runtime coverage.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift. Exit criterion remains behavior coverage that fails if pending photos are filtered out by a processed predicate.
- `C75-08`: bulk-edit validation alert association remains deferred with its original accessibility exit criterion.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
