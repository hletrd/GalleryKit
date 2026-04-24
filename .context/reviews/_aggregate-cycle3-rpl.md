# Aggregate Review — Cycle 3 (RPL loop, 2026-04-23)

**Purpose:** consolidate findings from all spawned reviewers this cycle. Dedupe across agents, preserve highest severity/confidence, note cross-agent agreement.

## Source reviews

| Reviewer | File |
|---|---|
| Designer UI/UX Deep | `designer-ui-ux-deep.md` |
| Designer A11Y Audit | `designer-a11y-audit.md` |
| Designer Responsive | `designer-responsive.md` |
| Designer Admin Flow | `designer-admin-flow.md` |
| Designer Public Flow | `designer-public-flow.md` |
| Designer Perceived Perf | `designer-perceived-perf.md` |
| Code Reviewer | `code-reviewer-cycle3-rpl.md` |
| Security Reviewer | `security-reviewer-cycle3-rpl.md` |
| Perf Reviewer | `perf-reviewer-cycle3-rpl.md` |
| Critic | `critic-cycle3-rpl.md` |
| Architect | `architect-cycle3-rpl.md` |
| Verifier | `verifier-cycle3-rpl.md` |
| Test Engineer | `test-engineer-cycle3-rpl.md` |
| Debugger | `debugger-cycle3-rpl.md` |
| Tracer | `tracer-cycle3-rpl.md` |
| Document Specialist | `document-specialist-cycle3-rpl.md` |

## Deduplicated findings

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG3R-01** | C3R-UX-01, A11Y-01, PUB-01, CQ3-01, CRIT3-01, ARCH3-02, TE3-01 | Photo detail page renders zero `<h1>`; `CardTitle` is `<div>` in shadcn v3; sidebar is `hidden lg:block` on mobile so mobile viewport emits no heading | MEDIUM | HIGH | 7 agents |
| **AGG3R-02** | C3R-UX-02, A11Y-02, CQ3-02, CRIT3-02, TE3-02 | Locale-switch button (nav-client.tsx:149-155) has no `aria-label`; visible text "KO"/"EN" is not a sufficient accessible name | MEDIUM | HIGH | 5 agents |
| **AGG3R-03** | C3R-UX-03, A11Y-03, RESP-02, CQ3-04, CRIT3-03, TE3-03 | Tag-filter pills 22×(33..94)px at 375px viewport — 2px under WCAG 2.5.8 AA 24×24 minimum | LOW | HIGH | 6 agents |
| **AGG3R-04** | C3R-UX-04, A11Y-04, PUB-02, CQ3-03, CRIT3-04, TE3-04 | Heading hierarchy on home skips H1 → H3 (no H2 between page title and photo cards) | LOW | HIGH | 6 agents |
| **AGG3R-05** | C3R-UX-05, CQ3-07 | `<html dir>` attribute is empty (browser default ltr but explicit better for future RTL) | LOW | MEDIUM | 2 agents |
| **AGG3R-06** | C3R-UX-06, CRIT3-05 | Footer "Admin" link contrast 4.83:1 (AA pass, AAA fail) — intentional de-emphasis, borderline | LOW | MEDIUM | 2 agents |
| **AGG3R-07** | ADMIN-04, CQ3-06, CRIT3-06 | DB restore uses `window.confirm()` instead of styled `AlertDialog` — inconsistent | LOW | HIGH | 3 agents |
| **AGG3R-08** | ADMIN-01 | Password change form does not surface "min 12 chars" constraint pre-submit | LOW | MEDIUM | 1 agent |
| **AGG3R-09** | ADMIN-03 | Delete-topic confirmation text does not mention that orphan images remain | LOW | MEDIUM | 1 agent |
| **AGG3R-10** | PUB-10 | Search modal lacks ARIA-live results-count announcement | LOW | MEDIUM | 1 agent |
| **AGG3R-11** | RESP-07 | Collapsed nav `overflow-hidden` may clip focus ring on scrolled-off topic link | LOW | MEDIUM | 1 agent |
| **AGG3R-12** | DOC3-01 | CLAUDE.md doesn't declare heading-hierarchy expectations | LOW | LOW | 1 agent |

## Priority remediation order (this cycle)

### Must-fix (MEDIUM)
1. **AGG3R-01** (photo page heading) — add `sr-only <h1>` + promote sidebar `CardTitle` to `<h2>` in `photo-viewer.tsx`.
2. **AGG3R-02** (locale switch aria-label) — add `aria-label` + translations.

### Should-fix (LOW) — batched in one polish patch
3. **AGG3R-03** (tag pill height) — change `py-0.5` → `py-1` or add `min-h-[24px]`.
4. **AGG3R-04** (heading skip on home) — add `sr-only <h2>`.
5. **AGG3R-05** (html dir) — set `dir="ltr"`.
6. **AGG3R-07** (restore confirmation) — wrap in `AlertDialog`.

### Defer (LOW, scoped)
- AGG3R-06, AGG3R-08, AGG3R-09, AGG3R-10, AGG3R-11, AGG3R-12.

## Carry-forward (unchanged status)

From cycles 5-46 and cycle 1-2 rpl:
- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- D2-01 / D1-03 — Admin mobile nav scroll affordance
- D2-02 — `uploadImages` dead `replaced: []` return field
- D2-03 / D6-05 — CSV export streaming
- D2-04 — Duplicate in-memory rate-limit maps
- D2-05 — `searchImages` sequential round-trips
- D2-06 — `bootstrapImageProcessingQueue` unpaginated SELECT
- D2-07 — Session clock-drift lower bound
- D2-09 — updatePassword concurrent regression test
- D2-10 — settings-client hint coupling
- D2-11 — data.ts mutable view buffering
- D6-01 — cursor/keyset infinite scroll
- D6-02 — scoped topic/tag photo navigation
- D6-03 — visual regression workflow
- D6-04 — public photo ISR/auth-boundary redesign
- D6-06 — sitemap partitioning
- D6-10 — durable shared-group view counts
- D6-11 — tag-filtered metadata canonical names
- D6-12 — split mutable view buffering
- D6-13 — single-process runtime assumption
- D6-14 — broader test-surface expansions
- OC1-01 / D6-08 — historical example secrets in git history
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- PERF-UX-01 — blur placeholder no-op (new this cycle, LOW)
- PERF-UX-02 — full variable font (carry-forward)

## Agent failures

None — every spawned reviewer returned a file.

## Totals

- **0 CRITICAL / HIGH** findings
- **2 MEDIUM** findings (AGG3R-01, AGG3R-02)
- **10 LOW** findings (AGG3R-03 through AGG3R-12)
- **20+ carry-forwards** unchanged
