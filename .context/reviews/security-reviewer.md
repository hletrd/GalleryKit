# Cycle 6 Security Reviewer Notes

## Inventory
- Restore/backup actions: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`
- Deploy and runtime helpers: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `.env.deploy.example`
- Auth/write barriers from prior cycles: `apps/web/src/app/actions/*.ts`, `apps/web/src/lib/restore-maintenance.ts`

## Findings

### C6-01 — Restore stdin stream failures can escape the structured restore error boundary
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:362-416`
- **Why it matters:** this is primarily an availability/integrity issue. Restore is an administrative recovery path and should fail in a controlled, auditable way.
- **Failure scenario:** a malformed dump or broken DB connection makes `mysql` exit early; the parent action sees an unhandled stdin-stream error instead of the intended typed restore failure, which can interrupt the maintenance workflow and make operator recovery harder.
- **Suggested fix:** explicitly absorb expected broken-pipe child-stdin errors and let the `close` event own the final restore status.

## Deferred / carry-forward
- Historical secret rotation / repo-history cleanup remains an operational task and is still carried by the existing deferred review docs.
