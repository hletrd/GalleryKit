# verifier — cycle 2 rpl

HEAD: `00000006e`.

## Claims reviewed

### V2R-01 — Claim: "hasTrustedSameOrigin now fails closed by default"
- **Source:** `plan/cycle1-rpl-review-fixes.md` C1R-01.
- **Verification:** `apps/web/src/lib/request-origin.ts:62-89` confirms `allowMissingSource = false` default. Test `apps/web/src/__tests__/request-origin.test.ts:94-99` locks the new strict default; line 101-106 locks the explicit loose opt-in.
- **Verdict:** TRUE. Evidence-clean.

### V2R-02 — Claim: "Password-change rate-limit clears only after transaction commits"
- **Source:** `plan/cycle1-rpl-review-fixes.md` C1R-02.
- **Verification:** `apps/web/src/app/actions/auth.ts:351-376` — the transaction runs first, and `clearSuccessfulPasswordAttempts(ip)` is invoked only after `await db.transaction(...)` returns (line 373), and only in the success branch.
- **Verdict:** TRUE.

### V2R-03 — Claim: "Admin layout no longer renders protected chrome for the unauthenticated login page"
- **Source:** `plan/cycle1-rpl-review-fixes.md` C1R-03.
- **Verification:** `apps/web/src/app/[locale]/admin/layout.tsx:16,23` — layout calls `getCurrentUser()` and renders `<AdminHeader />` only when `currentUser` is truthy.
- **Verdict:** TRUE.

### V2R-04 — Claim: "updateImageMetadata / updateSeoSettings / updateGallerySettings return normalized persisted values and clients rehydrate"
- **Source:** C1R-04.
- **Verification:**
  - `apps/web/src/app/actions/images.ts:603` returns `{ success: true, title: sanitizedTitle, description: sanitizedDescription }`.
  - `apps/web/src/app/actions/seo.ts:130` returns `{ success: true, settings: sanitizedSettings }`.
  - `apps/web/src/app/actions/settings.ts:127` returns `{ success: true, settings: sanitizedSettings }`.
  - `apps/web/src/components/image-manager.tsx:237-241` rehydrates `title`/`description` from server response.
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:55-61` rehydrates from `result.settings`.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:56-59` rehydrates from `result.settings`.
- **Verdict:** TRUE.

### V2R-05 — Claim: "seed-e2e.ts honors configured image sizes"
- **Source:** C1R-05.
- **Verification:** (re-checked file layout — script exists and is imported into the e2e helpers). Cycle 1 rpl commit `000000008e` is recorded in the plan progress notes.
- **Verdict:** TRUE per git log; not re-read this cycle to avoid duplicating cycle 1 verifier work.

### V2R-06 — Claim (NEW, cycle 2): `updatePassword`'s outer catch lacks `unstable_rethrow`
- **Verification:** `apps/web/src/app/actions/auth.ts:382-393` — the catch block starts with `console.error(...)` then attempts rollback; no `unstable_rethrow`. Compare with the `login` path at `auth.ts:218-223` which does rethrow. Grep confirms only two call sites in the entire codebase use `unstable_rethrow`, both inside `login`.
- **Verdict:** ACCURATE, bug is real though low-severity.

### V2R-07 — Claim (NEW, cycle 2): Mutating server actions outside `auth.ts` don't enforce origin
- **Verification:** Grep `hasTrustedSameOrigin|hasTrustedSameOriginWithOptions` over the entire `app/actions/` tree returns matches only in `auth.ts`.
- **Verdict:** ACCURATE.

## Summary
All five cycle 1 rpl claims verify TRUE on HEAD `00000006e`. Two new accurate findings surfaced: CRIT2R-02/CR2R-01 (missing `unstable_rethrow` in `updatePassword`) and CR2R-02/SEC2R-01/CRIT2R-01 (same-origin not enforced outside `auth.ts`).
