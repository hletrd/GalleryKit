# Aggregate Review — Cycle 2 / Prompt 1 Recovery

Date: 2026-04-24
Repo: `/Users/hletrd/flash-shared/gallery`

## Agent roster and provenance

Agent tool fan-out was attempted for the requested reviewer lanes, but this recovery session was already at the platform child-agent limit. The batch attempt and one retry both failed with `agent thread limit reached (max 6)`. Per Prompt 1 failure handling, the failures are recorded below and compatibility review lanes were completed directly so the cycle could continue without discarding useful partial work.

Executed compatibility review lanes written to per-agent files:
- `code-reviewer` → `.context/reviews/code-reviewer.md`
- `security-reviewer` → `.context/reviews/security-reviewer.md`
- `critic` → `.context/reviews/critic.md`
- `verifier` → `.context/reviews/verifier.md`
- `test-engineer` → `.context/reviews/test-engineer.md`
- `architect` → `.context/reviews/architect.md`
- `debugger` → `.context/reviews/debugger.md`
- `designer` → `.context/reviews/designer.md`
- `perf-reviewer` → `.context/reviews/perf-reviewer.md` (local compatibility lane; no registered Agent tool type)
- `tracer` → `.context/reviews/tracer.md` (local compatibility lane; no registered Agent tool type)
- `document-specialist` → `.context/reviews/document-specialist.md` (local compatibility lane; no registered Agent tool type)
- `product-marketer-reviewer` → `.context/reviews/product-marketer-reviewer.md` (custom reviewer-style local prompt)

Recovery handling: pre-existing partial cycle-2 edits in `document-specialist.md`, `perf-reviewer.md`, `product-marketer-reviewer.md`, and `tracer.md` were preserved under `.context/reviews/recovery-cycle2-partials/` before replacement with complete current compatibility reviews.

## AGENT FAILURES

- `code-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `architect`: batch spawn failed with `agent thread limit reached (max 6)`; retry of `code-reviewer` failed with the same error. Compatibility lanes were completed directly.
- `debugger`, `designer`: not spawned after the child-agent limit failure; compatibility lanes were completed directly.
- `perf-reviewer`, `tracer`, `document-specialist`: no registered Agent tool type was available in this environment; compatibility lanes were completed directly.

## Consolidated finding count

**NEW_FINDINGS: 5** deduped findings.

Cross-agent agreement increased priority for:
- stale share/group cache invalidation after image delete (`code-reviewer`, `security-reviewer`, `critic`, `verifier`, `architect`, `debugger`, `tracer`)
- auth rate-limit DB check/increment ordering (`code-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `debugger`, `tracer`)
- DB SSL policy mismatch across runtime/migration/backup/restore (`security-reviewer`, `critic`, `verifier`, `architect`, `document-specialist`)
- output-size mutation race while images are unprocessed (`code-reviewer`, `critic`, `verifier`, `test-engineer`, `architect`, `debugger`, `perf-reviewer`, `tracer`)
- first-run setup ordering docs (`critic`, `verifier`, `document-specialist`, `product-marketer-reviewer`)

## Deduped findings

### AGG2C2-01 — Deleting images does not invalidate cached direct-share or group-share pages

- **Status:** Confirmed
- **Severity:** HIGH
- **Confidence:** High
- **Sources:** code-reviewer, security-reviewer, critic, verifier, architect, debugger, tracer.
- **Files/regions:** `apps/web/src/app/actions/images.ts:367-427`, `apps/web/src/app/actions/images.ts:461-555`, `apps/web/src/db/schema.ts:87-104`, `apps/web/src/lib/data.ts:552-630`, `apps/web/src/app/actions/sharing.ts:320-381`.
- **Problem:** Image delete paths remove rows and revalidate home/photo/topic/admin surfaces, but they do not fetch direct `images.share_key` or group keys through `shared_group_images`, unlike dedicated share revoke/delete paths.
- **Failure scenario:** A public `/s/<key>` or `/g/<key>` page generated before deletion can continue showing stale deleted-photo content until natural ISR expiry or broad unrelated invalidation.
- **Suggested fix:** Collect direct share keys and group keys before deletion and include `/s/{key}` / `/g/{key}` in targeted revalidation for successful deletes.

### AGG2C2-02 — Login/password DB rate limits still check before increment across processes

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Sources:** code-reviewer, security-reviewer, critic, verifier, test-engineer, debugger, tracer.
- **Files/regions:** `apps/web/src/app/actions/auth.ts:108-141`, `apps/web/src/app/actions/auth.ts:320-337`, `apps/web/src/lib/rate-limit.ts:172-215`, safer reference pattern in `apps/web/src/app/actions/public.ts:63-94`.
- **Problem:** Auth checks DB buckets before incrementing them. Concurrent workers can all observe the same below-limit count before any increment lands.
- **Failure scenario:** With count 4/max 5, two bad attempts on different workers both pass the pre-check and both perform expensive Argon2 verification, exceeding the distributed budget.
- **Suggested fix:** Pre-increment DB counters, check with `includesCurrentRequest`, and roll back counters when over-limit requests are rejected before auth evaluation.

### AGG2C2-03 — Backup/restore CLI SSL policy ignores the documented `DB_SSL=false` opt-out

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Sources:** security-reviewer, critic, verifier, architect, document-specialist.
- **Files/regions:** `apps/web/src/app/[locale]/admin/db-actions.ts:127-140`, `apps/web/src/app/[locale]/admin/db-actions.ts:396-408`, `apps/web/src/db/index.ts:6-25`, `apps/web/scripts/mysql-connection-options.js:11-23`, `apps/web/.env.local.example:7`.
- **Problem:** App pool and migration scripts honor `DB_SSL=false`, but backup/restore force `--ssl-mode=REQUIRED` for every non-local host.
- **Failure scenario:** Private non-TLS MySQL deployments work for app queries/migrations but fail admin backup/restore despite following the documented opt-out.
- **Suggested fix:** Centralize CLI SSL arg derivation from the same localhost + `DB_SSL=false` policy and test dump/restore usage.

### AGG2C2-04 — `image_sizes` can change while unprocessed jobs are in flight

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** Medium-High
- **Sources:** code-reviewer, critic, verifier, test-engineer, architect, debugger, perf-reviewer, tracer.
- **Files/regions:** `apps/web/src/app/actions/settings.ts:72-103`, `apps/web/src/app/actions/images.ts:224-305`, `apps/web/src/lib/image-queue.ts:240-263`, `apps/web/src/lib/process-image.ts:390-444`, public image URL consumers in `apps/web/src/lib/image-url.ts:24-48` and public routes.
- **Problem:** Output-size changes are blocked only once a processed image exists. New galleries can have unprocessed queued jobs that render old size derivatives while the current config begins requesting new size filenames.
- **Failure scenario:** Admin uploads photos, changes output sizes during processing, and then public thumbnails/OG previews request derivatives that were never generated.
- **Suggested fix:** Lock output sizes once any image row exists unless a full queue quiesce/regeneration workflow is implemented; update copy/tests to say uploaded photos lock sizes.

### AGG2C2-05 — Quick-start docs run DB init before required environment setup

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Sources:** critic, verifier, document-specialist, product-marketer-reviewer.
- **Files/regions:** `README.md:87-115`, `apps/web/README.md:7-14`, `apps/web/scripts/init-db.ts:14-30`, `apps/web/scripts/mysql-connection-options.js:3-22`, `apps/web/.env.local.example:1-29`.
- **Problem:** Root and app quick starts tell users to run `npm run init` before creating/editing `.env.local`, but init/migration requires DB/admin/session env.
- **Failure scenario:** A fresh user follows docs literally and hits missing DB env errors before the docs explain setup.
- **Suggested fix:** Move MySQL/env/site-config setup before init in both READMEs and add a login/upload smoke check after dev startup.

## Final aggregation sweep

- Compared all per-agent compatibility files and deduped overlapping findings by failure mode.
- Preserved the highest severity/confidence for each duplicate.
- Confirmed no new UI-only blocker was raised by the designer lane; existing prior-cycle UI deferrals remain in plan files and are not re-opened by this cycle.
- Confirmed every finding above is either security/correctness/docs-onboarding and must be scheduled in Prompt 2; no cycle-2 aggregate finding is silently dropped.
