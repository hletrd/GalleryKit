# Cycle 10 Document Specialist Review

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e3`  
Lane: document-specialist

## Documentation scope

Read the repository rules in full and inventoried current operator/product docs, the authoritative plan index, current plan/deferred lineage, latest aggregate and provenance, README files, environment examples, schema/migration runbook, deployment instructions, and last-three-commit messages/diffs. Historical plan files were routed through `.context/plans/README.md` rather than treated as current truth.

## DOC-C10-01 — Active Cycle 9 status is stale after signed push and observable deployment

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed**
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:5,83-85,119-130`; `.context/plans/README.md:34-40`.

The plan is still indexed as active, says “signed release pending,” and leaves signed push/deploy incomplete. All three current commits are GPG-good, local and remote master are equal, and the live HTML contains the six-width source ladder introduced by `819f5432`. This establishes deployment of the behavior, though not an exact production SHA.

Concrete failure: recovery work repeats already-completed publication/deployment or produces a false release-status report. Fix by marking signed publication complete, recording the observable live ladder as deployment evidence, archiving the plan, and advancing the index. Do not invent an exact server SHA.

## DOC-C10-02 — Cycle 9 calls `_4096` a high-resolution derivative without qualifying actual pixels

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; same root as CRT-C10-01**
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:60-66,103-109,150-153`; `apps/web/src/lib/process-image.ts:1214-1234`; E2E seed `apps/web/scripts/seed-e2e.ts:79-87`.

The plan says the 1200 px fixture selected an “existing 4096w derivative” rather than upscaling. The file exists under that suffix, but its decoded width is 1200 because the encoder avoids enlargement. The wording therefore asserts the opposite of the observed delivery behavior.

Concrete failure: future reviewers trust the plan and preserve a false-suffix test as proof of adequate pixels. Fix the code/test, then rewrite the evidence in terms of real decoded width. If source pixels cap quality, state that limitation explicitly.

## Documentation checks with no finding

`CLAUDE.md` remains accurate about the encoder's no-edit photographer boundary, cache invalidation, source-size configurability, and deploy topology. No current README claim was found to say that every configured suffix necessarily contains that many pixels; the new incorrect claim is localized to the Cycle 9 plan/evidence. Final sweep found no new schema, env, nginx, CLIP, privacy, or migration runbook drift.
