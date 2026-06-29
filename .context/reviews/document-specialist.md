# Cycle 18 Document-Specialist Review

Date: 2026-06-30 KST
HEAD reviewed: `4ad6a394453fac80cc29aacc6f93eab3ed8c12ca`
Scope: documentation, README/CLAUDE/AGENTS, deploy/env examples, comments, tests-as-docs, `.context` plans/reviews, and implementation contracts. Review-only except for writing this report.

## Inventory

Read first: `AGENTS.md`, then `CLAUDE.md`.

Inventoried and inspected:

- Canonical docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Deploy/config surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, site-config examples.
- Historical/planning docs: `.context/plans/README.md`, `.context/plans/cycle-18-plan.md`, current `.context/reviews/*.md`, current aggregate, and relevant archived/done plans.
- External-doc-dependent claims: no new framework/API claim required current external verification; findings are repo-internal doc/comment/test-vs-implementation mismatches.
- Implementation and tests-as-docs anchors: package scripts, Next config, upload serving, backup download, settings hash, process-image pipeline version comments, migration/index docs, semantic/CLIP docs, deploy-script contract tests, resolved-stream source test, service-worker/cache tests, privacy/search tests.

Several cycle-17 document findings are now fixed at current HEAD: settings-hash comments are scoped to the route-handler fallback, analytics indexes are listed in `CLAUDE.md`, HDR copy now says SDR delivery rather than tone-mapping, and README/CLAUDE document the deploy helper's home-directory fallback. Those are not refiled below.

## Findings

### DS18-01 - `serve-upload` cache comment still says one day while all derivative headers are one hour

Severity: Low
Confidence: High

Files and regions:
- `apps/web/src/lib/serve-upload.ts:247-254`
- `apps/web/next.config.ts:69-72`
- `apps/web/nginx/default.conf:173-176`
- `CLAUDE.md:204`, `CLAUDE.md:299`

Mismatch:
The hot-path response-header comment says edge caches keep upload derivatives "fast for one day", but the actual route-handler header is `Cache-Control: public, max-age=3600, must-revalidate`. Next static upload headers, nginx, and CLAUDE all document the same one-hour policy.

Concrete failure scenario:
A maintainer debugging stale derivative bytes or editing cache policy trusts the local `serve-upload.ts` comment and assumes a 24-hour fresh window. They can make an incident timeline wrong or "correct" the header back toward the stale comment, contradicting the one-hour freshness contract.

Suggested fix:
Change the comment to "one hour" or remove the prose duration and let the `max-age=3600` literal be the local source of truth. Keep it aligned with Next config, nginx, and CLAUDE.

### DS18-02 - Resolved-path streaming comments/tests overstate TOCTOU closure

Severity: Low
Confidence: Medium

Files and regions:
- `apps/web/src/app/api/admin/db/download/route.ts:43-75`
- `apps/web/src/lib/serve-upload.ts:175-217`, `apps/web/src/lib/serve-upload.ts:239-267`
- `apps/web/src/__tests__/resolved-stream-source.test.ts:8-19`
- `.context/plans/cycle-17-2026-06-30-deferred.md:10-16`

Mismatch:
The backup-download and upload-serving comments say streaming from the resolved realpath closes the symlink-replacement TOCTOU gap. The code validates `lstat()`/`realpath()` and containment, then opens a pathname with `createReadStream(resolvedFilePath)` or `createReadStream(resolvedPath)`. That is safer than opening the original unvalidated path, and the source-contract test pins that improvement, but it is not descriptor-backed validation of the object actually opened.

Concrete failure scenario:
A same-host process with write access to `data/backups` or `public/uploads` replaces a validated file after `realpath()` but before `createReadStream()`. The route can compute `Content-Length`, ETag, and audit size from the pre-open `stats` object while streaming a replacement at the same resolved pathname. This is not an unauthenticated web exploit under the current host/operator boundary, but the comments/tests can mislead future hardening review into believing the race is fully closed.

Suggested fix:
Either implement descriptor-backed open/fstat/stream-from-fd semantics, or weaken the comments and source-contract test wording to say resolved-path streaming reduces the original-path race but does not eliminate all local replacement races.

### DS18-03 - `process-image` pipeline-version history omits current v7

Severity: Low
Confidence: High

Files and regions:
- `apps/web/src/lib/process-image.ts:371-397`
- `apps/web/src/lib/gallery-config-shared.ts:10-22`
- `CLAUDE.md:120`, `CLAUDE.md:171`

Mismatch:
`process-image.ts` carries a local pipeline-version history ending at v6, then re-exports `IMAGE_PIPELINE_VERSION`. The authoritative constant is v7 in `gallery-config-shared.ts`, and CLAUDE correctly documents the current version as 7.

Concrete failure scenario:
A maintainer auditing encoder byte-output changes from `process-image.ts` misses the v7 rationale and reopens or duplicates already-shipped fixes around target-gamut JPEG chroma, sRGB blur pipeline, ICC preservation, or GPS stripping. The local comment looks like a complete history because it sits beside the re-export used by older imports.

Suggested fix:
Remove the duplicate history from `process-image.ts` and point to `gallery-config-shared.ts`, or add the v7 history line there as well.

### DS18-04 - `.context` aggregate still identifies cycle 17 while cycle-18 artifacts depend on it as cycle 18

Severity: Medium
Confidence: High

Files and regions:
- `.context/reviews/_aggregate.md:1-5`
- `.context/plans/cycle-18-plan.md:1-7`
- `.context/reviews/critic.md:1-5`
- `.context/reviews/security-reviewer.md:1-5`
- `.context/reviews/perf-reviewer.md:1-5`

Mismatch:
The current aggregate file says "Cycle 17 Aggregate Review" and cites HEAD `5e054f80...`, while the cycle-18 plan says its source is `.context/reviews/_aggregate.md` as "cycle-18, 11/11 agents". Current per-agent review files identify themselves as cycle 18 and review later HEADs.

Concrete failure scenario:
A future planner or verifier uses `.context/reviews/_aggregate.md` as the canonical cycle-18 source because `cycle-18-plan.md` names it that way, but receives cycle-17 findings and stale HEAD metadata. Work can be duplicated, current cycle-18 findings can be silently missed, and provenance checks become unreliable.

Suggested fix:
Archive the cycle-17 aggregate under an explicit archive path and write a real cycle-18 aggregate, or update `cycle-18-plan.md` to cite the actual per-agent files instead of a stale aggregate. Keep one unambiguous "current aggregate" convention.

### DS18-05 - Cycle-18 plan/index completion state is internally inconsistent

Severity: Low
Confidence: High

Files and regions:
- `.context/plans/cycle-18-plan.md:1-9`, `.context/plans/cycle-18-plan.md:19`, `.context/plans/cycle-18-plan.md:24`, `.context/plans/cycle-18-plan.md:29`, `.context/plans/cycle-18-plan.md:39`, `.context/plans/cycle-18-plan.md:46`
- `.context/plans/README.md:3-18`

Mismatch:
`cycle-18-plan.md` declares cycle 18 complete with pushed commits and green gates, but every scheduled task still has `Status: [ ]`. The plan index lists active cycle-17/16/15/etc. entries but does not list the cycle-18 plan at all, despite `cycle-18-plan.md` existing at the top level.

Concrete failure scenario:
An agent trying to resume review-plan-fix work sees the top banner and treats cycle 18 as complete, or sees the unchecked task statuses and treats the same work as pending. Another agent using `.context/plans/README.md` will not see cycle 18 in active or completed lists and may plan from stale cycle-17 state.

Suggested fix:
Set each completed cycle-18 task status to `[x]` or a clear `DONE/NO-OP` disposition, and update `.context/plans/README.md` to include cycle 18 under the correct completed/deferred section.

## Missed-Issues Sweep

Final sweep rechecked canonical docs, README files, package scripts, environment examples, deploy helpers, Docker/nginx config, site config examples, migration/schema/index docs, source comments for cache/ETag/TOCTOU/color/HDR/semantic-search behavior, i18n messages, current `.context` plans/reviews, and tests that encode documentation contracts.

Not refiled because they matched current repo behavior or were intentionally historical:

- Next/React/TypeScript/Node version claims align with `apps/web/package.json`.
- Semantic-search activation docs align with production gating, `CLIP_MODELS_ROOT`, model version, and bounded scan behavior.
- Deploy docs align with bind mounts, auto-prune behavior, host-network compose, liveness/readiness split, and upload body caps.
- `CLAUDE.md` now scopes settings-hash invalidation to the serve-upload path and warns that static derivatives need re-encode for settings-only byte changes.
- Storage backend quarantine is explicit in CLAUDE and pinned by `storage-quarantine.test.ts`.
- HDR user-facing copy now says SDR delivery, matching the code's documented guarantee.

Known limits: this pass did not run the full test suite, inspect live production/remote host state, inspect untracked `.env` files, or independently revalidate browser/platform color-support claims. No external API/framework fact was material to the confirmed findings.

Total findings: 5
- Critical: 0
- High: 0
- Medium: 1
- Low: 4
