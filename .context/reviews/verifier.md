# Verifier review — prompt 1

## Verdict
PARTIAL

## Inventory
- Policy/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.agent/rules/commit-and-push.md`.
- Runtime/config surfaces: `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/next.config.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/app/[locale]/layout.tsx`.
- Touched UI/audit surfaces: `apps/web/src/components/lightbox.tsx`, `apps/web/src/__tests__/touch-target-audit.test.ts`.
- Hygiene/build-context surfaces: `.gitignore`, root `.dockerignore`, `apps/web/.dockerignore`.
- Read-only evidence checks: `git status --short`, `file apps/web/._data apps/web/public/._uploads`, `git check-ignore -v apps/web/._data apps/web/public/._uploads`, direct reads of the files above.

## Findings

### V1 — AppleDouble metadata files are still present and only partially ignored
- **Severity:** Low
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/._data` (file), `apps/web/public/._uploads` (file), `.gitignore:4`, `.dockerignore:1-16`, `apps/web/.dockerignore:1-11`
- **Problem:** the new git ignore rule hides AppleDouble metadata from `git status`, but the files still exist in the worktree and are still included by both Docker build contexts because neither `.dockerignore` excludes `._*`.
- **Failure scenario:** a future image build or repository export carries the metadata blobs into a container context, and future reviewers keep seeing noisy filesystem artifacts instead of real source changes.
- **Suggested fix:** delete the two AppleDouble files and add `._*` to the Docker ignore files as well, or ensure all build contexts explicitly exclude Finder metadata.

### V2 — Google Analytics is split across two configuration sources that can diverge
- **Severity:** Low
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/app/[locale]/layout.tsx:118-128`, `apps/web/src/lib/content-security-policy.ts:58-69`, `apps/web/src/site-config.example.json:10`, `apps/web/README.md:36-39`, `README.md:128-145`
- **Problem:** the layout injects GA scripts from `siteConfig.google_analytics_id`, but production CSP only allows Google domains when `NEXT_PUBLIC_GA_ID` is set. The render decision and the security allow-list are driven by different knobs.
- **Failure scenario:** an operator sets `google_analytics_id` in `site-config.json` and deploys without the matching env var; the scripts render, CSP blocks them, and analytics silently fails with no explicit app-level error.
- **Suggested fix:** derive CSP from the same resolved analytics setting used by the layout, or make analytics env-only and remove the file-backed key so there is one source of truth.

## Non-findings / verified controls
- `apps/web/src/components/lightbox.tsx:307-329` now uses `h-11 w-11` for the close/fullscreen controls, matching the updated audit note in `apps/web/src/__tests__/touch-target-audit.test.ts:81-88`.
- The current lightbox change is compliant with the repo’s 44 px touch-target rule; I did not find a correctness regression in that fixed path.

## Summary counts
- Findings: 2 (2 confirmed)
- Residual risks: AppleDouble cleanup still depends on manual deletion; analytics still depends on aligned JSON + env configuration.
