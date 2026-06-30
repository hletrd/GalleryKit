# Cycle 56 Code and Architecture Review

Current HEAD reviewed: `e82311b9822645b055c4638540f5fd1cc3704463`.

## Inventory Examined

- `CLAUDE.md`
- `.context/reviews/cycle-55-2026-07-01/_aggregate.md`
- `.context/plans/README.md`
- `.context/plans/cycle-55-2026-07-01-plan.md`
- `.context/plans/cycle-55-2026-07-01-deferred.md`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/src/__tests__/deploy-script-contract.test.ts`
- `apps/web/src/lib/settings-submit-payload.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`

## Findings

### C56-01 - Linux deploys fail before Compose because the new env-permission check uses BSD `stat` first

- Severity: High
- Confidence: High
- Files: `apps/web/deploy.sh:28`, `scripts/deploy-remote.sh:65`, `apps/web/src/__tests__/deploy-script-contract.test.ts:90`
- Failure scenario: `apps/web/deploy.sh` runs on the Ubuntu deploy host. On GNU/Linux, `stat -f` selects filesystem status, not file status. The format `%Lp` is not the file permission mode there, so the intended `stat -c '%a'` fallback is not used. The resulting `env_mode` can be non-numeric and abort the deploy before Docker Compose.
- Suggested fix: Prefer GNU syntax first, then BSD fallback, in both deploy scripts. Update the contract test to assert GNU-first ordering.

### C56-02 - Settings action still treats key presence as a contract mutation before proving the value changed

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/actions/settings.ts:71`, `apps/web/src/app/actions/settings.ts:73`, `apps/web/src/app/actions/settings.ts:77`, `apps/web/src/app/actions/settings.ts:97`, `apps/web/src/app/actions/settings.ts:106`, `apps/web/src/app/actions/settings.ts:118`, `apps/web/src/app/actions/settings.ts:127`
- Failure scenario: Cycle 55 fixed the current client helper, but the server action still decides `image_sizes` / `strip_gps_on_upload` changed solely from key presence. A stale client, future full-settings submit, or direct same-origin admin action can submit semantically unchanged values and still hit upload-claim and advisory-lock handling. During active uploads this produces a false `uploadSettingsLocked`.
- Suggested fix: Normalize and compare contract keys against persisted values first, remove unchanged contract keys from `sanitizedSettings`, and only then compute whether the upload-processing contract changed. Add server-action regression coverage.

### C56-03 - Cycle 55 ledger still presents completed work as active and commit/deploy-pending

- Severity: Medium
- Confidence: High
- Files: `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-55-2026-07-01-plan.md:46`, `.context/plans/cycle-55-2026-07-01-plan.md:47`, `.context/reviews/_aggregate.md:3`
- Failure scenario: Current HEAD is the Cycle 55 implementation commit `e82311b9`, but the plan index still labels Cycle 55 active and the plan leaves commit/push/deploy unchecked. Future agents cannot tell from committed state whether Cycle 55 was pushed or deployed.
- Suggested fix: Add terminal commit/push/deploy evidence for Cycle 55 and advance the plan/review pointers for Cycle 56.

## Final Sweep

No additional source-level code or architecture issues were confirmed in this lane. Carry-forward deferred items from Cycle 55 were not re-raised because no new severity-changing evidence was found.
