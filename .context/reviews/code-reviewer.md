# Code Review — Cycle 18

**Angle:** code quality / logic / SOLID / maintainability
**HEAD:** a9702716 (cycle-17 fixes landed)

**Files Reviewed (8):** images.ts, image-queue.ts, topics.ts, nav-client.tsx, lightbox-color-pip.tsx, wide-gamut-hint.tsx, upload-tracker.ts, smart-collections.ts

**Severity tally:** CRITICAL 0, HIGH 0, MEDIUM 0, LOW 4, VERY-LOW 1.

---

## [LOW, conf HIGH] Unguarded `deleteOriginalUploadFile` in per-file catch can escape to the outer try, leaking the quota claim
`apps/web/src/app/actions/images.ts:512`

The per-file catch (507-527) calls `await deleteOriginalUploadFile(savedOriginalFilename)` at :512 without its own try/catch. If it threw (EPERM, I/O), the exception propagates to the outer try (:175) whose `finally` (:581) only releases `uploadContractLock` — never `settleUploadTrackerClaim`. The pre-claimed quota (:226-228) would leak for the upload window.

NOTE: cross-agent (critic/tracer/verifier/debugger) REFUTED this as a *live* bug because `deleteOriginalUploadFile` swallows both unlink errors (`.catch(()=>{})`, upload-paths.ts:75-81) and therefore never throws. So it is a latent risk only (if that helper changes). Fix = wrap in try/catch, or (better) adopt a single settling `finally`.

## [LOW, conf HIGH] Theme toggle and locale switch buttons in nav missing `focus-visible` ring — sibling of cycle-17 a11y fix
`apps/web/src/components/nav-client.tsx:155-172`

Cycle-17 added `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the mobile hamburger (:96). The two sibling buttons in `#primary-nav-controls` — theme toggle (155-165) and locale switch (166-172) — have only hover styles, no focus-visible ring. Keyboard Tab focus has no visible indicator. WCAG 2.4.7. Fix = add the same ring classes. (Also flagged by designer D18-01, HIGH — 2-agent agreement.)

## [LOW, conf LOW] Upload-quota settle-on-throw invariant relies entirely on manual discipline
`apps/web/src/app/actions/images.ts` (outer try ~175-581)

Claim at 226-228; settlements at 6 sites (244, 249, 273, 277, 533, 555). Outer `finally` (:581) never settles. The documented invariant is enforced only by review discipline; a future `await` added without a paired settle silently leaks. Suggested: RAII-style closure / single settling finally. (See critic MAJOR-1, architect A4.)

## [LOW, conf LOW] Smart-collection remap silently skips corrupt `query_json` rows without any log
`apps/web/src/app/actions/topics.ts:309-316`

`catch { continue }` with no log. A corrupt row silently retains the old slug after rename → zero-result collection, non-obvious to diagnose. Fix = add `console.debug`/`console.warn` before `continue`.

## [VERY LOW, conf LOW] `wide-gamut-hint.tsx:203` uses `focus:outline-none` instead of `focus-visible:outline-none`
`apps/web/src/components/wide-gamut-hint.tsx:203`

Inconsistent with the codebase pattern (`focus-visible:outline-none` used in lightbox-color-pip.tsx:219,301). Functional impact ~zero on modern browsers; consistency fix only.

---

## Positive observations
- Cycle-17 settle-on-throw core fix (topic-exists SELECT 267-274) is correct; the two paths (catch+settle+throw, and `if(!topicRow){settle;return}`) are mutually exclusive — no double-settle.
- `settleUploadTrackerClaim` math robust (`Math.max(0, count + (success - claimed))`, null-guarded).
- `semanticSearchMode` three-tier resolution logically sound.
- `remapTopicSlugInQuery` pure + stack-safe (MAX_DEPTH=4).
- lightbox-color-pip focus coverage complete; copy button `min-h-11 min-w-11` meets 44px.
- WideGamutHint localStorage expiry validated (`Number.isFinite`).

**Recommendation:** COMMENT. Two actionable items before next cycle: nav-client focus rings (sibling of cycle-17); optional images.ts:512 guard / single-settle refactor.
