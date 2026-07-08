# Run-10 Cycle 27 Designer Review

Date: 2026-07-08 KST
Reviewed HEAD: `cff8d59f0301df8f64e030adc0fb2d65e825903a`
Role: designer

## Scope

Reviewed the current web UI source for restore-maintenance user experience, admin entry states, Cycle 26 public UI fixes, focus/accessibility semantics, touch-target policy, and responsive/error-state evidence. The repo is a Next.js web gallery, so UI/UX review applies.

## Findings

### DES-C27-01 - `/admin` restore-maintenance UX is inconsistent with protected admin routes

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/app/[locale]/admin/page.tsx:11-24`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:16-23`
- `apps/web/src/app/[locale]/admin/layout.tsx:15-22`

Problem:

Protected admin routes now show the restore-maintenance shell before auth, but the root admin page still probes the admin session and renders the login form during restore maintenance. That presents an action the system cannot complete and differs from the protected admin experience.

Failure scenario:

An operator opens `/admin` during a restore to monitor or recover the site. Instead of seeing the same maintenance state shown on `/admin/dashboard`, they see a login form after a best-effort auth probe. The login action later rejects, making the admin surface feel broken rather than intentionally unavailable.

Fix:

Render `PublicRestoreMaintenance` from `/admin` before the `isAdmin()` redirect probe and add a focused behavior test that maintenance-active `/admin` does not call `isAdmin()`.

### DES-C27-02 - Cycle 26 public UI fixes remain source-contract-only

Severity: Low-Medium
Confidence: High

Code region:

- `apps/web/src/components/lightbox-color-pip.tsx:167-204`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:55-67`, `:99-108`
- `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:57-82`

Problem:

The lightbox color-pip disclosure relationship, shared-group empty copy, and map topic-label fallback are pinned mostly by string/source assertions. They are likely correct, but a render/translation/conditional regression could keep the tested strings present while the DOM behavior regresses.

Failure scenario:

A future refactor keeps `aria-controls` or `topic_label` in source but renders no named region, a stale translation key, or a slug-only fallback list. The source test passes while keyboard/screen-reader users or zero-image share visitors see the regression.

Fix:

Add render-level or Playwright assertions for the color-pip panel relationship, valid empty shared group copy, and map fallback topic label. This is test-strength work, not a confirmed current UI behavior failure.

## Verification

Static UI review only. I did not run a browser because the confirmed Cycle 27 UI defect is covered by source inspection and can be behavior-tested without a live server.
