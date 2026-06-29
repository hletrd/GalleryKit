# Document-Specialist Review - Review-Plan-Fix Cycle 4

**Date:** 2026-06-29  
**HEAD reviewed:** `10b500bb30399f7c66812a5ad899f070f88d5501`  
**Role:** documentation/code consistency reviewer.  
**Boundary:** Reviewed current `HEAD` only. Existing uncommitted edits in other review artifacts were ignored. This artifact is the only intended write.

## Inventory Coverage

Built a documentation-relevant inventory before findings and checked the authoritative/contract-bearing surfaces:

- Governing docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/config surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, root/app `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/ensure-site-config.mjs`.
- Migration/schema/runbook surfaces: `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, migration journal/reconcile tests.
- Generated artifacts and contract comments: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, service-worker tests, privacy field tests, nginx config tests, CLIP semantic-search route/script comments.
- Planning/history docs: recent `.context/reviews/*`, `.context/plans/README.md`, current cycle plans, and `docs/superpowers/{plans,specs}`.

## Findings

### DOC-C4-01 - Deploy/disk-hygiene docs still preserve the old broad `./public` bind-mount contract

**Status:** Confirmed issue  
**Severity:** Low  
**Confidence:** High  
**Validation:** Confirmed by source inspection and test contract.

**Mismatched regions:**

- `AGENTS.md:19` says in-use data is protected by bind mounts `./data` / `./public` + host MySQL.
- `CLAUDE.md:460` says GalleryKit persistence bind mounts are `./data`, `./public`, and `./src/site-config.json`.
- `CLAUDE.md:475` repeats the incident lesson as `./data` + `./public` + host MySQL.
- `apps/web/deploy.sh:39-42` comments list `./public -> /app/apps/web/public`.
- `apps/web/deploy.sh:60` prints `Data is persisted under apps/web/data and apps/web/public`.
- Current code: `apps/web/docker-compose.yml:23-26` mounts only `./public/uploads:/app/apps/web/public/uploads`.
- Current test contract: `apps/web/src/__tests__/nginx-config.test.ts:47-49` requires the narrow `./public/uploads` mount and rejects `./public:/app/apps/web/public`.
- Public README is already correct: `README.md:181` says bind-mounted data is `./data`, `./public/uploads`.

**Why this is a problem:** The code/test contract was intentionally narrowed so immutable public assets, especially generated `sw.js`, come from the Docker image while only mutable upload derivatives persist on the host. The remaining ops docs/comments are the preservation contract future agents are told to keep during deploy/prune changes, but they point back to the broad mount shape the current test rejects.

**Concrete failure scenario:** A future deploy change follows `AGENTS.md` or `deploy.sh` comments and restores `./public:/app/apps/web/public` to "preserve derivatives." Production can again serve host-side generated assets over freshly built image assets, reopening the service-worker/deploy-artifact drift class that the Compose change and test were meant to close.

**Concrete fix:** Update `AGENTS.md`, `CLAUDE.md` disk-hygiene/incident prose, and `apps/web/deploy.sh` comments/output to say persistence is `./data`, `./public/uploads`, and `./src/site-config.json`; immutable public assets come from the built image. Keep the existing mount-shape assertion.

### DOC-C4-02 - Shipped CLIP superpowers docs still encode pre-implementation state

**Status:** Confirmed issue  
**Severity:** Low  
**Confidence:** High  
**Validation:** Confirmed by comparing docs against current code.

**Mismatched regions:**

- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4` says CLIP is shipped and activated with `jina-clip-v2-d512-q8` and threshold `0.22`.
- The same spec still describes the old pre-shipped state at `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:9`: encoder is a stub, `semantic_search_mode` can only be `disabled` or `stub`, and the UI carries an experimental disclaimer.
- The same spec says at `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:63` that production mode is "currently rejected."
- Current code accepts and gates production mode: `apps/web/src/lib/gallery-config-shared.ts:157-163`, `apps/web/src/lib/gallery-config.ts:127-142`.
- Current route code serves production with the real encoder and threshold `0.22`: `apps/web/src/app/api/search/semantic/route.ts:209-249`, `apps/web/src/lib/clip-embeddings.ts:173-191`.
- The linked implementation plan is also marked complete at `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:15`, but its task body remains unchecked and executable as if unrun, e.g. install/run/commit steps at `:51-96`, old "Expected: FAIL" claims at `:128-131`, `:280-283`, `:496-499`, `:707-712`, and placeholder threshold `0.25` at `:203-213` despite current `0.22`.

**Why this is a problem:** These files are not just archived notes: active docs point readers to them for CLIP implementation/activation context. A reader gets a contradictory truth table: top banners say shipped, but body text and checklists say the encoder is still stub-only, production is rejected, and tasks should be executed from scratch.

**Concrete failure scenario:** A future agent or operator follows the superpowers plan as live guidance, re-runs completed implementation tasks, reinstalls dependencies, or changes `PRODUCTION_COSINE_THRESHOLD` back toward the plan's placeholder `0.25`. Alternatively, they conclude production mode is unsupported despite README/CLAUDE and current code saying it is live behind `SEMANTIC_SEARCH_ALLOW_PRODUCTION`.

**Concrete fix:** Convert both superpowers docs to post-implementation records. In the spec, rewrite the problem/architecture/config sections in past tense or add an explicit "Historical pre-implementation context" boundary, and remove "currently rejected" from production-mode text. In the plan, either mark completed tasks `[x]` and annotate stale expected-failure snippets as historical, or move the detailed unexecuted checklist into an archive appendix with a top-level warning that it must not be used as current implementation instructions.

## Verified Non-Findings

- Cycle 3 document-specialist findings are fixed at this HEAD: README upload-serving guidance now says nginx proxies uploads to Next, README body-size guidance includes `/api/admin/lr/upload`, and `CLAUDE.md` / schema comments say `uploaded_by` is admin-only while public Atom uses feed-level author.
- Deploy helper docs/code are consistent enough: `scripts/deploy-remote.sh` supports root `.env.deploy` first and `~/.gallerykit-secrets/gallery-deploy.env` as fallback; `.env.deploy.example` documents the fallback, while AGENTS/README document the root-file path.
- Migration/runbook alignment checked: 25 SQL files match 25 journal entries; non-monotonic historical `when` values are documented and guarded by per-entry hash baselining/post-conditions; reconcile drops removed paid-download and reaction schema.
- Env/default checks found no new actionable drift for `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `NEXT_UPLOAD_BODY_MAX_BYTES`, `VIEW_RETENTION_DAYS`, `SEMANTIC_SCAN_LIMIT`, `SEMANTIC_TOP_K_MAX`, `CLIP_MODELS_ROOT`, or `HEALTH_CHECK_DB`.
- Privacy guards are aligned: `PrivacySensitiveKeys`, `SENSITIVE_KEYS`, `publicSelectFields`, timeline/map/search-enrichment guards, and the `uploaded_by` feed fallback comments are consistent.
- Removed/dormant feature references for Stripe/paid downloads, reactions, and S3/MinIO are either in historical `.context` archives, migration history, or explicit "removed / not integrated" docs.

## Final Missed-Issues Sweep

Swept stale authoritative references, generated-artifact contracts, deploy docs/comments, migration docs, env docs, CLIP superpowers docs, README/CLAUDE mismatches, privacy comments, and current `.context` review/plan history for duplicate filtering. The remaining current-HEAD documentation/code mismatches I found are the two confirmed low-severity findings above.

Coverage limits: I did not run runtime tests, deploy, or manually validate production. This was a read-only documentation/code comparison except for writing this report.

**Disposition:** 2 confirmed findings, 0 likely findings, 0 manual-validation-only findings. No application-code edits.
