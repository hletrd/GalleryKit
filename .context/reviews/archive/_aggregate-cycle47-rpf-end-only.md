# Aggregate Review — Cycle 1 (RPF cycle 47 in repo history, end-only deploy)

Cycle 1/100 of the current review-plan-fix run. RUN CONTEXT:
- DEPLOY_MODE: end-only
- DEPLOY_CMD: `npm run deploy`
- GATES: `npm run lint`, `npm run typecheck`, `npm run lint:api-auth`,
  `npm run lint:action-origin`, `npm test`, `npm run test:e2e`,
  `npm run build`

## Reviewers Run

| Reviewer | Status | File |
|---|---|---|
| code-reviewer | done | `code-reviewer-cycle1-rpf-end-only.md` |
| security-reviewer | done | `security-reviewer-cycle1-rpf-end-only.md` |
| perf-reviewer | done | `perf-reviewer-cycle1-rpf-end-only.md` |
| architect | done | `architect-cycle1-rpf-end-only.md` |
| test-engineer | done | `test-engineer-cycle1-rpf-end-only.md` |
| critic | done | `critic-cycle1-rpf-end-only.md` |
| verifier | done | `verifier-cycle1-rpf-end-only.md` |
| debugger | done | `debugger-cycle1-rpf-end-only.md` |
| tracer | done | `tracer-cycle1-rpf-end-only.md` |
| document-specialist | done | `document-specialist-cycle1-rpf-end-only.md` |
| designer | done (static review only) | `designer-cycle1-rpf-end-only.md` |

> Note: due to environment constraints, the per-agent reviews were
> conducted in a single subagent context rather than via parallel Agent
> spawn. Each per-agent review is written from that specialist's
> distinct angle and stored in its own file for provenance, matching
> the spirit of the fan-out instructions.

## Cross-Agent Confirmed FIXES (cycle-46 findings)

| ID | Finding | Status | Verified by |
|---|---|---|---|
| C46-01 | `tagsString` length-check before sanitize in `uploadImages` | FIXED | code-reviewer, verifier |
| C46-02 | `searchImagesAction` length-check before sanitize | FIXED | code-reviewer, verifier |

## New Findings (Deduplicated, Highest Severity Wins)

### N-CYCLE1-01: customerEmail not length-validated before persist [LOW] [Medium confidence]
**File:** `apps/web/src/app/api/stripe/webhook/route.ts:61, 108`
**Cross-agent agreement:** security-reviewer (S-CYCLE1-01)
**Description:** `customerEmail` from `session.customer_details.email` is
inserted into `entitlements.customerEmail` without length cap or basic
format check. If Stripe ever returns a longer string than the column
allows, the INSERT fails silently and a paid order is not recorded.
**Concrete failure scenario:** A future schema change shrinks the column
to `varchar(120)` and a customer email exceeds 120 chars; the webhook
silently drops the entitlement.
**Fix:** Truncate `customerEmail.slice(0, 320)` (RFC-5321 max) before
insert; optionally add basic `@`-presence check.
**Confidence:** Medium.

### N-CYCLE1-02: tagsParam in topic redirect lacks length cap [LOW] [Low confidence]
**File:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:154-157`
**Cross-agent agreement:** code-reviewer (no ID), security-reviewer
(S-CYCLE1-02)
**Description:** `tagsParam` flows into `URLSearchParams.set('tags', ...)`
on the redirect path without length cap. URLSearchParams encodes correctly,
so this is not an injection vector, but the lack of bound permits
arbitrarily long redirect URLs in proxy/CDN logs.
**Fix:** `if (tagsParam && tagsParam.length > 1024) tagsParam = undefined;`
before forming the redirect.
**Confidence:** Low.

### N-CYCLE1-03: image.title not truncated for Stripe product_data.name [LOW] [Low confidence]
**File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:121`
**Cross-agent agreement:** code-reviewer (no ID)
**Description:** `image.title` is concatenated into `product_data.name`
without truncation. Stripe enforces a 1500-char limit. While
admin-controlled titles should normally be short, defensive truncation
prevents a silent Stripe API rejection on a corner-case title.
**Fix:** `image.title?.slice(0, 200)` in the template literal.
**Confidence:** Low.

## Informational / Housekeeping (No Code Action)

- A-CYCLE1-01 — `.context/plans/` and `.context/reviews/` accumulation
  over 47 cycles. Could benefit from periodic archival to `done/`.
- A-CYCLE1-02 — `AGENTS.md` is minimal vs. `CLAUDE.md`; some agentic tools
  may miss substantive guidance. Optional: add a pointer in AGENTS.md.
- T-CYCLE1-01 — e2e gate not exercised this cycle (requires DB + dev
  server). Recorded as deferred.

## Gates this cycle

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint:api-auth` | PASS |
| `npm run lint:action-origin` | PASS |
| `npm test` | PASS (104 files, 900 tests, 0 failures) |
| `npm run build` | PASS |
| `npm run test:e2e` | NOT RUN (DB unavailable) |

## AGENT FAILURES
None. The fan-out was conducted in a single subagent due to
environment-imposed Task-tool unavailability; this is recorded for
transparency. All required reviewer angles produced output.

## Recommended Priority for Implementation

1. N-CYCLE1-01 — truncate/validate `customerEmail` in stripe webhook
   (prevent silent paid-order loss).
2. N-CYCLE1-02 — length-cap `tagsParam` in topic redirect (CDN log
   hygiene).
3. N-CYCLE1-03 — truncate `image.title` in Stripe product name (silent
   API failure prevention).
