# Test Engineer Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Confirmed gaps

### T5-01 — No regression test proves restore mode blocks conflicting write actions
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/__tests__/restore-maintenance.test.ts:1-25`, representative mutators `apps/web/src/app/actions/settings.ts:35-37`, `apps/web/src/app/actions/tags.ts:42-44`, `apps/web/src/app/actions/topics.ts:33-35`, `apps/web/src/app/actions/sharing.ts:61-63`
- **Failure scenario:** a future refactor can remove or bypass the restore gate without any failing unit test because the suite never exercises a blocked write path.
- **Suggested fix:** add pure helper coverage for the guard plus a focused regression test around the upload/restore boundary or another representative mutator.

### T5-02 — No UI-level test covers restore file-size guidance / oversize rejection
- **Severity:** LOW
- **Confidence:** Medium
- **Citations:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:57-79,158-180`
- **Failure scenario:** the DB admin page can regress back to silent oversize selection because there is no browser or component test asserting the warning/precheck path.
