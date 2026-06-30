# Cycle 32 Document Specialist Review

Reviewer: document-specialist
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `3d174c96`
Date: 2026-06-30 KST
Scope: documentation, runbook, comment, package metadata, migration/deploy, and `.context` consistency against authoritative repo sources. Product code and sibling review files were not edited.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Then inspected:

- Root/app docs: `README.md`, `apps/web/README.md`, `AGENTS.md`, `CLAUDE.md`, `.env.deploy.example`, `apps/web/.env.local.example`.
- Runtime/deploy sources those docs cite: `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Schema/migration sources: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/drizzle/meta/_journal.json`, representative migration comments, `apps/web/scripts/migrate.js`.
- Feature-state sources: semantic search routes/scripts, LR upload route, storage quarantine, auto-alt-text helpers, public image components, paid/removal guards, HDR/WI-09 comments.
- Context artifacts: current top-level cycle-32 sibling reviews, `.context/plans/README.md`, active cycle plan files, and recent plan/review history where it affected current documentation.

## Findings

### C32-DOC-01 - Auto-alt-text runbook describes a fallback chain the core public UI does not implement

Severity: Medium
Confidence: High
Consequence: accessibility/operator documentation drift

Exact regions:

- `CLAUDE.md:561-563`
- `apps/web/src/lib/photo-title.ts:85-125`
- `apps/web/src/__tests__/alt-text-fallback.test.ts:1-6`, `apps/web/src/__tests__/alt-text-fallback.test.ts:13-89`
- `apps/web/src/components/home-client.tsx:293-355`
- `apps/web/src/components/lightbox.tsx:500-503`
- `apps/web/src/app/actions/images.ts:1080-1126`

Mismatch:

`CLAUDE.md` says public display falls back through "explicit alt text, title/description, suggested text, and localized photo labels." The current core helper and tests define a different chain: `title > tag-derived > alt_text_suggested > fallback`. There is no explicit `alt_text` field in the schema surface, and `description` is not part of `getConcisePhotoAltText()`. Home cards and the lightbox use that helper directly for `<img alt>`, so a photo with only `description` gets the generic localized fallback unless it has tags or `alt_text_suggested`. The source comment at `photo-title.ts:90-91` also says "Admin-set alt always takes precedence", but the only admin copy action copies `alt_text_suggested` into `title` or `description`, not a distinct alt field.

Concrete failure scenario:

An operator follows the runbook and puts accessibility-facing text in `image.description`, expecting it to be used as public alt text. On the home grid and lightbox, screen-reader users still hear the generic fallback or generated suggestion instead of that description. This is not a data leak, but it is a trust and accessibility mismatch in the docs' stated behavior.

Fix:

Either update `CLAUDE.md` and the source comment to the implemented contract (`title > tags > alt_text_suggested > localized fallback` for core gallery/lightbox alt text; descriptions are visible metadata and are used by some adjacent labels such as similar/search cards), or deliberately add description/explicit-alt support to `getConcisePhotoAltText()` with tests and schema/UI docs. The smaller safe fix is documentation/comment correction.

### C32-DOC-02 - `.context/plans/README.md` is stale and contains broken plan links

Severity: Low
Confidence: High
Consequence: planning/navigation drift for agents and contributors

Exact regions:

- `.context/plans/README.md:3-16`
- `.context/plans/README.md:61-62`
- `.context/plans/cycle-30-2026-06-30-plan.md:1-6`
- `.context/plans/cycle-31-2026-06-30-plan.md:1-6`

Mismatch:

The plans index lists active work through cycle 29 and older deferred entries, but current committed plan files include cycle 30 and cycle 31 artifacts. Cycle 30 is marked "implementation complete; gates green; commit/deploy pending"; cycle 31 is a current review/implementation plan. The index also links cycle 18/19 plan entries as `../../plan/...` from inside `.context/plans/README.md`; those paths resolve outside `.context` and do not exist in this checkout. The nearby actual legacy plan directory is `.context/plan/`, and it does not contain the cited `plan-377` / `plan-375` files either.

Concrete failure scenario:

An agent uses `.context/plans/README.md` as the authoritative planning index, misses cycle 30/31 state, and either re-triages already completed work or follows a broken link while trying to preserve deferred findings. This is low severity because the individual plan files still exist and current sibling reviews cite direct files, but it makes the committed plan index unreliable.

Fix:

Refresh the active/completed/deferred index for cycles 30 and 31, correct or remove the broken `../../plan/...` references, and consider making the index generated or explicitly "best effort / may lag" if it is not maintained every cycle.

## Confirmed Matches / Non-Findings

- Package/version docs align with `apps/web/package.json`: Node `>=24`, Next `^16.2.9`, React `^19.2.5`, TypeScript `^6`.
- Deploy docs align with scripts: `.env.deploy` fallback behavior, derived SSH command, health check before Docker pruning, bind-mounted mutable data, and no automatic `docker volume prune -a`.
- `/api/live` and `/api/health` docs match Dockerfile and deploy script behavior.
- Semantic search docs match source on disabled default, production env gate, offline CLIP weights, model-version separation, scan/topK caps, and operator-only production activation.
- Storage docs match current quarantine: `@/lib/storage` is local-only and not wired into live upload/serve paths.
- Paid download/Stripe removal docs match current source; remaining references are historical migrations/tests/archive context or explicit removal guards.
- LR upload docs match the current route: it consumes `file`, `topic`, optional `title`, optional `description`; other submitted metadata override fields are not consumed.

## Final Sweep

Final sweep covered: README/CLAUDE/AGENTS, package metadata, env examples, Docker/Compose/nginx/deploy scripts, migration journal and schema comments, privacy/public field docs, CLIP/semantic search runbooks, LR upload wording, unsupported storage, removed payment/reaction surfaces, HDR/WI-09 placeholders, auto-alt-text, `.context/plans`, and current cycle-32 sibling reports.

This was a static documentation lane. I did not run the full lint/typecheck/build/test suite because no product behavior was changed. I wrote only `.context/reviews/document-specialist.md`.
