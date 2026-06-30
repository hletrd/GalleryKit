# Cycle 56/100 Aggregate Review

Start HEAD: `e82311b9822645b055c4638540f5fd1cc3704463`.

## Review Lanes

- `code-reviewer.md`
- `security-reviewer.md`
- `perf-reviewer.md`
- `test-engineer.md`
- `designer.md`
- `critic.md`

## Deduplicated Findings

### C56-01 - Linux deploys fail before Compose because the new env-permission check uses BSD `stat` first

- Severity: High
- Confidence: High
- Cross-agent agreement: code-reviewer, critic
- Citations: `apps/web/deploy.sh:28`, `scripts/deploy-remote.sh:65`, `apps/web/src/__tests__/deploy-script-contract.test.ts:90`
- Failure scenario: `apps/web/deploy.sh` runs on the Ubuntu deploy host. On GNU/Linux, `stat -f` selects filesystem status, not file status. The format `%Lp` is not the file permission mode there, so the intended `stat -c '%a'` fallback is not used. The deploy can abort before Docker Compose.
- Fix: Prefer GNU `stat -c '%a'` first, BSD `stat -f '%Lp'` second, in both deploy scripts. Update contract coverage.

### C56-02 - Settings action still treats key presence as a contract mutation before proving the value changed

- Severity: Medium
- Confidence: High
- Cross-agent agreement: code-reviewer
- Citations: `apps/web/src/app/actions/settings.ts:71`, `apps/web/src/app/actions/settings.ts:73`, `apps/web/src/app/actions/settings.ts:77`, `apps/web/src/app/actions/settings.ts:97`, `apps/web/src/app/actions/settings.ts:106`, `apps/web/src/app/actions/settings.ts:118`, `apps/web/src/app/actions/settings.ts:127`
- Failure scenario: A stale client, future full-settings submit, or direct same-origin admin action can submit semantically unchanged `image_sizes` / `strip_gps_on_upload` values and still hit upload-claim and advisory-lock handling. During active uploads this produces a false `uploadSettingsLocked`.
- Fix: Normalize and compare contract keys against persisted values before computing whether the upload-processing contract changed; remove unchanged contract keys before persistence.

### C56-03 - Cycle 55 ledger still presents completed work as active and commit/deploy-pending

- Severity: Medium
- Confidence: High
- Cross-agent agreement: code-reviewer, critic
- Citations: `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-55-2026-07-01-plan.md:46`, `.context/plans/cycle-55-2026-07-01-plan.md:47`, `.context/reviews/_aggregate.md:3`
- Failure scenario: Current HEAD is the Cycle 55 implementation commit `e82311b9`, but the plan index still labels Cycle 55 active and the plan leaves commit/push/deploy unchecked.
- Fix: Close Cycle 55 with terminal commit/push/deploy evidence and advance the plan/review pointers for Cycle 56.

### C56-04 - `image_sizes` lock test is not scoped to the branch it claims to protect

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Citation: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:11`
- Failure scenario: The source-slice test scans almost the rest of `settings.ts`, so it could pass because another branch still queries `images`, even if the `image_sizes` branch lost its existing-image guard.
- Fix: Replace with behavior coverage for changed and semantically unchanged `image_sizes` payloads.

### C56-05 - Deploy permission regression tests do not prove refusal actually exits

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Citation: `apps/web/src/__tests__/deploy-script-contract.test.ts:73`
- Failure scenario: A future edit could keep warning text and remove `exit 1`, allowing deploy to proceed with group/world-readable secrets while tests still pass.
- Fix: Add execution-level tests for unsafe root and runtime env files.

### C56-06 - Admin photo page uses public image data, so admin-only audit rows cannot render

- Severity: Medium
- Confidence: High
- Cross-agent agreement: designer, critic
- Citations: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:146`, `apps/web/src/lib/data.ts:1044`, `apps/web/src/lib/data.ts:375`, `apps/web/src/components/color-details-section.tsx:214`, `apps/web/src/components/photo-viewer.tsx:824`
- Failure scenario: Logged-in admins see an admin-mode photo viewer, but the image row is public-shaped, so documented admin audit rows for color/HDR/privacy/original-file metadata silently disappear.
- Fix: Add an admin-aware viewer fetch that selects admin fields only after `isAdmin()` resolves true; keep public/OG paths on public fields.

### C56-07 - App README refers to nonexistent alt-text fields

- Severity: Low
- Confidence: High
- Cross-agent agreement: designer
- Citations: `apps/web/README.md:88`, `CLAUDE.md:568`, `apps/web/src/app/actions/images.ts:1099`, `apps/web/src/components/bulk-edit-dialog.tsx:244`
- Failure scenario: An operator looks for a dedicated alt-text field that does not exist.
- Fix: Reword the README to match the title/description copy path.

## Deferred Findings

No new Cycle 56 findings are deferred. Existing carry-forward deferred items remain unchanged:

- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps.
- `TV-40-03` - JavaScript operational scripts need semantic checking.
- `PERF-C39-03` - feed and sitemap updated-time indexes.
- `PERF-C39-04` - backfill pipeline-version indexes.
- `AGG-C38-07` - broad imported-helper side-effect classification.
- `AGG-C38-08` - sidecar keyset pagination.

## Agent Failures

- The native session exposed generic/default subagents rather than the named review roles from the workflow prompt. Five independent review lanes were spawned; a sixth critic/product-risk lane hit the session thread limit and was completed locally from source and review artifacts. No review result was dropped.
