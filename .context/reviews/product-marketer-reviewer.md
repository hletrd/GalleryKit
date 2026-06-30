# Cycle 27 Product Marketer Reviewer

Date: 2026-06-30
Role: product-marketer-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `1e8bba0298ea`

## Scope and Method

Adapted the local BurstPick-oriented reviewer prompt to GalleryKit. This review treats GalleryKit as a self-hosted Next.js finished-photo gallery and ignores Swift/BurstPick-specific file requirements.

No app code was edited. This artifact is the only intended change.

## Inventory

Read first:

- `AGENTS.md` project instructions from the task prompt.
- `CLAUDE.md`, especially architecture, semantic search, upload API, color/HDR, privacy/security, and deploy/runbook sections.

Product and marketing inventory covered:

- Public/product docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`.
- Admin/site copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`.
- Claim anchors in source: semantic/similar search routes, public keyword search data path, service worker/PWA, Google Analytics injection, privacy page, upload API/token auth, SEO settings actions/data, gallery config validation/resolution, in-app and sidecar color backfill paths.
- Prior review context: current `product-marketer-reviewer.md` and archive search for backfill, semantic search, settings, docs, SEO, marketing claims, payment/Stripe, and permanently deferred items.

## Executive Summary

Most externally visible GalleryKit positioning is code-backed and careful: finished-photo publishing, private originals, no editing/culling/scoring/payment workflow, opt-in Google Analytics, disabled-by-default semantic search, upload API rather than bundled Lightroom plugin, and bounded PWA/offline claims all match the implementation reviewed.

One confirmed docs/runbook mismatch can create operator trust and support risk: the runbook calls the sidecar and in-app color backfill entry points "equivalent" even though only the sidecar can force re-encode current-version rows after settings-only changes.

## Confirmed Issues

### C27-PMR-01 - Backfill runbook overstates in-app/sidecar equivalence for settings-only derivative changes

- Severity: Medium
- Confidence: High
- Category: Operational docs / product trust
- File and lines:
  - `CLAUDE.md:333` says flipping any color/HDR/admin derivative tunable requires a backfill pass.
  - `CLAUDE.md:337` correctly states the sidecar skips current-version rows unless `--force-reencode` is passed.
  - `CLAUDE.md:339` then says the sidecar script and in-app Settings "Re-encode existing photos" button are "Two equivalent entry points" and that operators can use whichever is convenient.
  - `apps/web/src/lib/admin-backfill-runner.ts:49-51` documents the in-app runner as selecting `pipeline_version < CURRENT` rows.
  - `apps/web/src/lib/admin-backfill-runner.ts:383-388` and `apps/web/src/lib/admin-backfill-runner.ts:400-418` implement that candidate filter with no force path.
  - `apps/web/scripts/backfill-color-pipeline.ts:281-282` parses `--force-reencode`.
  - `apps/web/scripts/backfill-color-pipeline.ts:331-340` shows `--force-reencode` bypasses the pipeline-version filter and selects all processed rows.
  - `apps/web/messages/en.json:775-781` is already more accurate than the runbook: it warns that settings-only changes need the sidecar backfill with `--force-reencode`.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:301-311`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:322-344`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:394-416` surface that copy in the admin flow.

Failure scenario: A photographer-operator changes JPEG quality, chroma subsampling, AVIF effort, force-sRGB derivatives, or the derivative size ladder. They read `CLAUDE.md` and use the in-app "Re-encode existing photos" button because the docs say both entry points are equivalent and "whichever is convenient" is fine. Existing photos are already at the current `IMAGE_PIPELINE_VERSION`, so the in-app runner reports nothing to process or only processes stale-version rows. New uploads use the new settings while older public derivatives keep old bytes, causing inconsistent color/quality delivery and a support thread that looks like GalleryKit ignored the setting.

Suggested fix: Rewrite `CLAUDE.md:339` to distinguish shared safety contracts from candidate selection. For example: "Both paths share the advisory lock and DB-column/write-safety contract, but they are not candidate-equivalent. The in-app button processes rows behind the current pipeline version. Settings-only byte changes require the sidecar with `--force-reencode`, or a new in-app force mode if product wants that workflow." Also update `apps/web/README.md:41` from `npx tsx scripts/backfill-color-pipeline.ts` to explicitly mention `--force-reencode` for settings-only changes, because the current one-line command says "current pipeline/settings" without the flag nuance.

## Likely Issues

### C27-PMR-02 - SEO copy accepts relative OG image paths, but the admin input advertises browser URL semantics

- Severity: Low
- Confidence: Medium
- Category: Admin settings copy / form UX
- File and lines:
  - `apps/web/messages/en.json:477-479` says the OG image field accepts a "Same-origin URL or path."
  - `apps/web/src/app/actions/seo.ts:126-133` confirms the server accepts relative paths or same-origin URLs.
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:171-179` renders the field as `<Input type="url">`.

Failure scenario: An admin follows the copy and enters `/og-image.jpg`. The server-side rule accepts it, but the browser control and assistive technology can present the value as URL-invalid because `type="url"` expects an absolute URL. The current save button path is custom React state rather than native form submission, so this is unlikely to block saving, but it can make a valid setting look broken.

Suggested fix: Change the field to `type="text"` with `inputMode="url"` while keeping the same server validation and hint, or make the copy absolute-URL-only if relative paths are no longer intended.

## Risks Needing Manual Validation

### C27-PMR-RISK-01 - Live demo semantic-search status is intentionally not proven by the repo

- Severity: Low
- Confidence: Medium
- Category: Demo expectation / feature claim
- File and lines:
  - `README.md:21-24` links a live demo.
  - `README.md:42` markets semantic search as English/Korean plus similar photos, while clearly saying it is disabled by default and requires operator setup.
  - `CLAUDE.md:159` says the repo proves gates and runbook, not the current live production row count, and tells operators to verify the deployed host before treating semantic search as active.
  - `apps/web/src/app/api/search/semantic/route.ts:196-200` returns 503 when semantic search is disabled/not configured.
  - `apps/web/src/app/api/search/semantic/route.ts:285-289` returns 503 when production mode has no production embeddings.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:121-125` requires production semantic search mode for "similar photos."

Manual validation scenario: A README reader clicks the live demo expecting to try semantic search or "similar photos." If the deployed demo currently lacks production embeddings or the UI hides/blocks the semantic toggle, the README is technically honest but the demo expectation can still become a trust issue.

Suggested validation/fix: Check the deployed demo before release notes or public sharing that emphasizes semantic search. If demo semantic search is off, add a short demo-status note near the demo link or semantic-search feature bullet.

## Validated Claims With No New Finding

- Finished-photo positioning is consistent: `README.md:29-32` says GalleryKit is for edited-work publishing and not editing/culling/scoring/proofing/payment; reviewed product copy and routes did not introduce a contradictory marketed workflow.
- Upload API wording is aligned: `README.md:205-216` says server-side PAT upload API, not a bundled Lightroom Classic plugin; `apps/web/src/app/api/admin/lr/upload/route.ts:1-18` says the same, and the response shape matches `apps/web/src/app/api/admin/lr/upload/route.ts:544-546`.
- Keyword search scope matches the claim: `README.md:41` says title/description/camera/tag search; `apps/web/src/lib/data.ts:1516-1563` searches title, description, camera, lens, topic, and topic label before tag/alias branches.
- Semantic-search caution is backed by source gates: `README.md:42` says disabled by default, operator-enabled, bounded scan, not vector index; `apps/web/src/app/api/search/semantic/route.ts:186-205` checks mode before serving and binds behavior to stub/production model versions.
- PWA wording is appropriately bounded: `README.md:43` says visited image caching and offline HTML fallback, not full offline sync; `apps/web/public/sw.template.js:4-20`, `apps/web/public/sw.template.js:294-333`, and `apps/web/public/sw.template.js:380-396` implement that bounded behavior and bypass admin/revocable routes.
- Google Analytics opt-in claim matches code: `README.md:29` says GA is optional and disabled unless configured; `apps/web/src/app/[locale]/layout.tsx:147-159` injects GA only for a configured valid GA ID.
- SEO DB override claim matches implementation: `apps/web/src/lib/data.ts:1714-1753` reads SEO keys from `admin_settings` and falls back to `site-config.json`.
- Payment/Stripe and paid-download topics were intentionally not re-raised. Current docs position GalleryKit away from payment workflows, and prior paid-download/Stripe history is a permanently deferred/non-current policy area rather than a new product-marketing mismatch.

## Final Sweep Confirmation

Reviewed categories: README/docs positioning, admin settings copy, SEO/settings claims, semantic-search claims and gates, upload API claims, privacy/analytics claims, PWA/offline claims, color/HDR/backfill runbook promises, deploy/runbook language, and prior product-marketing review history.

No app code was edited. No commit was made. Confirmed issue count: 1 Medium. Likely issue count: 1 Low. Manual-validation risks: 1 Low.
