# Aggregate Review — Cycle 6 (review-plan-fix loop, 2026-04-25)

**Purpose:** consolidate findings from all reviewer roles this cycle. Dedupe across roles, preserve highest severity/confidence, note cross-role agreement.

**Cycle orchestrator:** review-plan-fix loop, cycle 6 of 100. DEPLOY_MODE: per-cycle.

**Baseline gates (clean before any cycle-6 fixes):**
- `npm run lint --workspace=apps/web`: exit 0
- `tsc --noEmit -p apps/web/tsconfig.json`: exit 0
- `npm run lint:api-auth --workspace=apps/web`: exit 0
- `npm run lint:action-origin --workspace=apps/web`: exit 0
- `vitest run` (apps/web): 379/379 across 59 files

## Source reviews (11 files, this cycle)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer-cycle6-loop.md` |
| Security Reviewer | `.context/reviews/security-reviewer-cycle6-loop.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer-cycle6-loop.md` |
| Critic | `.context/reviews/critic-cycle6-loop.md` |
| Verifier | `.context/reviews/verifier-cycle6-loop.md` |
| Test Engineer | `.context/reviews/test-engineer-cycle6-loop.md` |
| Tracer | `.context/reviews/tracer-cycle6-loop.md` |
| Architect | `.context/reviews/architect-cycle6-loop.md` |
| Debugger | `.context/reviews/debugger-cycle6-loop.md` |
| Document Specialist | `.context/reviews/document-specialist-cycle6-loop.md` |
| Designer | `.context/reviews/designer-cycle6-loop.md` |

## Environment note on agent fan-out

The orchestrator prompt specifies spawning parallel subagents. In this environment the Task/Agent fan-out tool is not exposed as a callable tool (consistent with the cycle-5 RPL aggregate's note). Per the prompt's "skip any not registered, never silently drop one available", I performed each reviewer role's scan directly and wrote one file per role to preserve provenance. No reviewer role was silently dropped.

## Deduplicated findings (cross-role agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Role |
|---|---|---|---|---|---|
| **AGG6L-01** | C6L-SEC-01, C6L-CR-01, C6L-CRIT-01, C6L-ARCH-01, C6L-TE-01, C6L-DOC-01, C6L-TRACE-01, C6L-DES-01 | `seo.ts` `updateSeoSettings` does not reject Unicode bidi/invisible formatting characters in `seo_title`/`seo_description`/`seo_nav_title`/`seo_author`. These four free-form strings reach every public page's `<title>`, `<meta description>`, `<meta og:*>`, `/api/og` SVG, top-nav title, browser-tab text, SERP snippets, and link-preview cards. Closes the last gap in the Unicode-formatting hardening lineage (C7R-RPL-11 → C8R-RPL-01 → C3L-SEC-01 → C4L-SEC-01 → C5L-SEC-01). | LOW | HIGH | **8 roles** |
| **AGG6L-02** | C6L-ARCH-01, C6L-CR-02 | After AGG6L-01 lands there will be 7+ inline `UNICODE_FORMAT_CHARS.test(...)` call sites. Extract a `containsUnicodeFormatting(value)` helper in `validation.ts` so the policy has one source of truth and nullability handling is consistent. Bundle with AGG6L-01. | LOW | HIGH | 2 roles |
| **AGG6L-03** | C6L-CRIT-02, C6L-DBG-01, C6L-DOC-03 | Inline comments in `seo.ts` should explicitly note (a) why `seo_locale` and `seo_og_image_url` are skipped (their existing validators are stricter) and (b) that the rejection layer is a separate policy from the strip-and-persist control-char layer. Pure documentation polish. | LOW | MEDIUM | 3 roles |
| **AGG6L-04** | C6L-TE-02 | Helper `containsUnicodeFormatting` (if introduced) wants its own truthiness-branch coverage. Tiny test addition. | LOW | MEDIUM | 1 role |

## Carry-forward (unchanged — existing deferred backlog)

From prior cycles, all unchanged (none of these are addressed by this cycle):
- AGG5R-07 — `getImages` vs `getImagesLite` overlap
- AGG5R-09 — lint helpers missing distinguishing banner (already partly addressed by `SECURITY-CRITICAL` headers in `check-action-origin.ts` / `check-api-auth.ts`)
- AGG5R-10 — `> 20` revalidation magic number
- AGG5R-11 — auth+origin+maintenance preamble extraction
- AGG5R-12 — `lint:action-maintenance` gate
- AGG5R-13 — pool pre-warm SET race
- AGG5R-14 — `warnedMissingTrustProxy` reset helper
- AGG5R-15 — Unicode format-control stripping in `stripControlChars` (defense-in-depth — distinct from AGG6L-01 because that targets validation-layer rejection, while AGG5R-15 is about silent stripping; tracked separately)
- AGG5R-16 — filter revalidation list to actually-deleted IDs
- AGG5R-17 — collapse `getTopicBySlug` alias lookup
- AGG5R-18 — log readdir non-ENOENT in `cleanOrphanedTmpFiles`
- AGG5R-19 — wrap `restoreDatabase` scan in try/catch
- AGG4R2-04, AGG4R2-06, AGG4R2-08–12 — named errors, helper extraction, batched view-count UPDATE, `<JsonLdScript>`, comment tightening, `data.ts` split, JSON-LD E2E
- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- All other carry-forward items from `_aggregate-cycle5-rpl.md`

## Priority remediation order (this cycle)

### Must-fix (none — no HIGH/MEDIUM)
None.

### Should-fix (LOW, batched into one polish patch)

The cross-role consensus is overwhelming for AGG6L-01: 8 of 11 roles flag it. Bundle the helper extraction (AGG6L-02) and inline-comment polish (AGG6L-03) into the same commit.

1. **AGG6L-01 + AGG6L-02 + AGG6L-03 + AGG6L-04** — single patch:
   - Extract `containsUnicodeFormatting(value: string | null | undefined): boolean` in `apps/web/src/lib/validation.ts` and use the existing `UNICODE_FORMAT_CHARS` constant.
   - Refactor existing inline call sites in `topics.ts` / `images.ts` to use the helper (no behaviour change — keeps the policy in one place).
   - Apply `containsUnicodeFormatting` rejection in `apps/web/src/app/actions/seo.ts` `updateSeoSettings` for the four free-form fields. Add a comment noting that `seo_locale` and `seo_og_image_url` skip the helper because their existing validators are stricter.
   - Add four new i18n keys (`seoTitleInvalid`, `seoDescriptionInvalid`, `seoNavTitleInvalid`, `seoAuthorInvalid`) in `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
   - Update the lineage comment in `validation.ts:30-39` to extend through `C6L-SEC-01`.
   - Update `CLAUDE.md` Database Security bullet to enumerate the SEO fields.
   - Add Vitest cases (≥1 per affected SEO field — 4 minimum) and a small `containsUnicodeFormatting` truthiness-branch test.
   - Run all gates; deploy.

### Defer (none — single small batch covers all this cycle's findings)

## Cross-role agreement highlights

- **AGG6L-01** (SEO Unicode-formatting parity gap): **8 of 11** roles (security, code-reviewer, critic, architect, test-engineer, document-specialist, tracer, designer). HIGH confidence. Highest-priority fix.
- **AGG6L-02** (helper extraction): 2 roles (architect, code-reviewer).
- **AGG6L-03** (comment polish): 3 roles (critic, debugger, document-specialist).

## Agent failures

None. All 11 reviewer files produced.

## Totals

- **0 CRITICAL / HIGH** findings
- **0 MEDIUM** findings
- **4 LOW** findings (all bundled into one patch this cycle)
- ~30 carry-forward items unchanged from prior cycles

## Thematic summary

Cycle 6 closes the last consistency gap in the Unicode-formatting hardening lineage. The cycle-5 RPL aggregate had categorised `seo` and `admin_settings` as "intentionally permissive". That was correct for `admin_settings` (purely numeric/boolean values) but wrong for `seo` (four free-form strings that reach every public page's HTML head and OG metadata). Cycle 6 corrects that misclassification, extracts a single helper to eliminate the multiplying inline call sites, and updates the surrounding documentation/lineage so the policy reads as one cohesive thread end-to-end. No active regressions; gate integrity unchanged; coverage expanded by ≥4 tests.
