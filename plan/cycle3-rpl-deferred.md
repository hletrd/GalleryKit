# Cycle 3 (RPL loop) — Deferred items

Purpose: capture every cycle 3 rpl review finding that is **not** implemented in `plan/cycle3-rpl-review-fixes.md`, plus map scheduled items so no finding is silently dropped.

Repo-policy inputs consulted: `CLAUDE.md`, `AGENTS.md`, existing plan files under `plan/`, `.context/reviews/`. `.cursorrules` and `CONTRIBUTING.md` are absent. Relevant repo rules quoted where needed below.

## Master disposition map

| Finding | Citation | Original severity / confidence | Disposition |
|---|---|---|---|
| AGG3R-01 | `apps/web/src/components/ui/card.tsx:33-40`; `apps/web/src/components/photo-viewer.tsx:384-386` | MEDIUM / HIGH | Scheduled in C3R-RPL-01 |
| AGG3R-02 | `apps/web/src/components/nav-client.tsx:149-155` | MEDIUM / HIGH | Scheduled in C3R-RPL-02 |
| AGG3R-03 | `apps/web/src/components/tag-filter.tsx` | LOW / HIGH | Scheduled in C3R-RPL-03 |
| AGG3R-04 | `apps/web/src/components/home-client.tsx:192,295,301` | LOW / HIGH | Scheduled in C3R-RPL-04 |
| AGG3R-05 | `apps/web/src/app/[locale]/layout.tsx` | LOW / MEDIUM | Scheduled in C3R-RPL-05 |
| AGG3R-06 | `apps/web/src/components/footer.tsx:46` | LOW / MEDIUM | Deferred below (D3-01) |
| AGG3R-07 | `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` (restore form) | LOW / HIGH | Scheduled in C3R-RPL-06 |
| AGG3R-08 | `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` | LOW / MEDIUM | Deferred below (D3-02) |
| AGG3R-09 | `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` (delete confirm) | LOW / MEDIUM | Deferred below (D3-03) |
| AGG3R-10 | `apps/web/src/components/search.tsx` | LOW / MEDIUM | Deferred below (D3-04) |
| AGG3R-11 | `apps/web/src/components/nav-client.tsx:69` | LOW / MEDIUM | Deferred below (D3-05) |
| AGG3R-12 | `CLAUDE.md` (no heading policy section) | LOW / LOW | Deferred below (D3-06) |
| TE3-01 | new Playwright test on photo page heading | LOW / HIGH | Scheduled in C3R-RPL-07 |
| TE3-02 / TE3-03 / TE3-04 | broader a11y test surface | LOW / MEDIUM | Deferred below (D3-07) |

## Deferred items

### D3-01 — Footer "Admin" link contrast (intentional design choice)
- **Citation:** `apps/web/src/components/footer.tsx:46` (`text-xs text-muted-foreground/50`)
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** **Already passes WCAG AA (4.83:1 ≥ 4.5:1)**. The intentional low-contrast is part of the visual design (de-emphasized admin entry on a personal gallery). Repo rule (`AGENTS.md`): "keep diffs small, reviewable, and reversible" — bundling a contrast tweak with the cycle 3 a11y bug fixes would dilute review of those fixes. This is also not a security/correctness/data-loss finding, so deferral is permitted by repo policy.
- **Exit criterion:** re-open if (a) the project decides to target WCAG AAA explicitly, or (b) admin user-flow research shows admins missing the entry point.

### D3-02 — Password change min-length pre-submit hint
- **Citation:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** UX polish only; the constraint is enforced server-side and surfaced via toast on failure. Adding a hint requires a translation key + form copy update. Repo rule: keep diffs small. Not blocking.
- **Exit criterion:** re-open during the next admin-form polish cycle or when password change UX is otherwise touched.

### D3-03 — Delete-topic confirmation clarity
- **Citation:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** Pure copy change; would require updating multiple translation files and rephrasing the confirmation in two languages. Topic deletion does not orphan images in a destructive way (images remain queryable; the slug reference is retained as text). Risk of data loss is zero.
- **Exit criterion:** re-open during admin copy-review cycle or when topic deletion semantics change.

### D3-04 — Search ARIA-live results announcement
- **Citation:** `apps/web/src/components/search.tsx`
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** Polish only; current behavior (modal open with results) is functionally complete. Adding ARIA-live with debounced count requires careful interplay with the existing rate-limit feedback. Repo rule: avoid speculative polish — fix concrete bugs first.
- **Exit criterion:** re-open in next a11y cycle or when search UX is restructured.

### D3-05 — Collapsed nav `overflow-hidden` may clip focus ring
- **Citation:** `apps/web/src/components/nav-client.tsx:69`
- **Original severity / confidence:** LOW / MEDIUM (LOW confidence the bug is reproducible).
- **Reason for deferral:** Audit shows `overflow-hidden` on the nav root when collapsed. Need to confirm whether keyboard users can actually scroll the topic list and whether the focus ring is clipped before fixing. Repo rule: do not introduce speculative fixes. Schedule a confirmation-first investigation.
- **Exit criterion:** re-open after a focused keyboard-only test confirms the clip; fix would be `overflow-clip` only on x or remove `overflow-hidden`.

### D3-06 — CLAUDE.md heading policy section
- **Citation:** `CLAUDE.md` (project-level)
- **Original severity / confidence:** LOW / LOW. Preserved.
- **Reason for deferral:** doc-only enhancement; not addressing a reported bug. Adding a policy section is appropriate but should follow the actual semantic-heading fix (C3R-RPL-01) so the policy can reference the new convention.
- **Exit criterion:** re-open after C3R-RPL-01 lands and a clear repeatable pattern exists to document.

### D3-07 — Broader a11y test-surface expansion (heading hierarchy + touch target lints)
- **Citation:** test surface (Vitest + Playwright)
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** A focused regression test for AGG3R-01 (C3R-RPL-07) is scheduled in this cycle. Generic a11y test infrastructure (heading-skip enforcement, touch-target enumeration) is its own scoped epic — would need exemption-list curation and is best done in a dedicated cycle.
- **Exit criterion:** re-open when this loop has stabilized into a dedicated test-engineering cycle.

## Carry-forward items still active from prior cycles

The following pre-existing deferrals from `plan/cycle1-rpl-deferred.md` and `plan/cycle2-rpl-deferred.md` remain open and are NOT reintroduced here — see the originating deferral file for full detail:

From cycle 1 rpl: D1-01 (CSP `'unsafe-inline'`), D1-02 (broader same-origin audit — closed by C2R-02), D1-03 (admin mobile nav — superseded by D2-01), OC1-01 (historical secrets).

From cycle 2 rpl: D2-01 through D2-11 (admin nav, dead `replaced`, CSV streaming, dup rate-limit maps, sequential search, bootstrap SELECT, session clock-drift, CSP `'unsafe-inline'`, updatePassword regression test, settings hint, mutable view buffering).

From earlier cycles (5-46 + cycle6-review-triage): D6-01 through D6-14, plus aggregate-cycle46 carry-forwards (font subsetting, Docker node_modules, blur placeholder no-op, single-process assumption).

None of these are reopened in this cycle; they remain bound by the same exit criteria documented in their originating triage files.

## Notes on repo policy compliance for deferrals

- No security, correctness, or data-loss finding is deferred. AGG3R-06 is the only finding in the "borderline" category (contrast at WCAG AA threshold) and it **passes AA** — repo policy requires WCAG AA at minimum (implicit via existing project conventions); AAA is not a stated target.
- Deferred work, when eventually picked up, remains bound by repo policy: GPG-signed commits, conventional-commit + gitmoji messages, no `--no-verify`, no force-push to protected branches, and the required language/toolchain versions recorded in `CLAUDE.md`.
- All deferrals here cite `AGENTS.md`'s "keep diffs small, reviewable, and reversible" rule as the basis for not bundling polish into the cycle 3 rpl auth+a11y patch sequence.
