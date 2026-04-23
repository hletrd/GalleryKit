# Aggregate Review — Cycle 6 (2026-04-23)

**Source reviews:** `code-reviewer.md`, `security-reviewer.md`, `critic.md`, `verifier.md`, `test-engineer.md`, `architect.md`, `debugger.md`, `designer.md`

## Reviewer roster / provenance
- Registered reviewers completed: `code-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `architect`, `debugger`, `designer`
- Requested but not registered in this environment: `perf-reviewer`, `tracer`, `document-specialist`
- Reviewer inventory manifest: `.context/reviews/available-agents-cycle6.txt`

## Summary

Cycle 6 produced **14 unique findings** after deduplicating overlaps across the specialist reviews:
- **0 critical / 0 high**
- **10 medium**
- **4 low**

Highest-signal areas this cycle:
1. **Public gallery correctness** — offset-based infinite scroll is both unstable under inserts and capped at `offset > 10000`.
2. **Auth / admin correctness** — same-origin checks fail open on missing source headers, and multiple admin UIs can drift from the sanitized values actually persisted.
3. **Test coverage realism** — default E2E still skips admin workflows and the nav “visual” checks do not assert regressions.
4. **SEO / export scale ceilings** — sitemap coverage and CSV export still silently truncate at larger gallery sizes.

## Deduplicated findings

| ID | Finding | Severity | Confidence | Sources | Cross-agent signal |
|---|---|---|---|---|---|
| AGG6-01 | Public infinite scroll relies on offset pagination and a hard `>10000` cutoff, so large/live galleries can skip, duplicate, or stop listing photos | MEDIUM | HIGH | code-reviewer, verifier | **Multi-agent agreement** |
| AGG6-02 | Auth same-origin validation succeeds when both `Origin` and `Referer` are missing | MEDIUM | MEDIUM | security-reviewer | Single-source |
| AGG6-03 | Photo metadata editor keeps stale local values after successful server-side sanitization | MEDIUM | HIGH | debugger | Single-source |
| AGG6-04 | Unauthenticated `/admin` still renders the protected admin shell/nav/logout affordances | MEDIUM | HIGH | designer | Single-source |
| AGG6-05 | Public photo prev/next navigation loses topic/tag collection context and falls back to the global gallery sequence | MEDIUM | HIGH | critic | Single-source |
| AGG6-06 | Default Playwright runs silently skip the admin surface | MEDIUM | HIGH | test-engineer | Single-source |
| AGG6-07 | Nav “visual checks” only capture screenshots and never assert visual regressions | LOW | HIGH | test-engineer | Single-source |
| AGG6-08 | Public photo route breaks its own ISR/cache boundary by reading admin auth state during render | MEDIUM | HIGH | architect | Single-source |
| AGG6-09 | E2E seed generation hardcodes derivative sizes instead of honoring configured `image_sizes` | MEDIUM | HIGH | critic | Single-source |
| AGG6-10 | CSV export is capped at 50k rows without deterministic ordering or a true full-export path | MEDIUM | HIGH | verifier | Single-source |
| AGG6-11 | Sitemap truncates to 24k images with no sitemap index / overflow partitioning | MEDIUM | HIGH | verifier | Single-source |
| AGG6-12 | Legacy topic seed script inserts uppercase slugs that current runtime rejects | LOW | HIGH | code-reviewer | Single-source |
| AGG6-13 | Admin/SEO settings clients can drift from server-sanitized values after save | LOW | HIGH | debugger | Single-source |
| AGG6-14 | Existing public Playwright coverage conflicts with designer-reported inert public controls, so those UI no-op claims require revalidation before implementation | LOW | HIGH | designer vs existing `public.spec.ts` / `nav-visual-check.spec.ts` | **Conflicting evidence** |

## Finding details

### AGG6-01 — Public infinite scroll relies on offset pagination and a hard `>10000` cutoff
- **Severity / confidence:** MEDIUM / HIGH
- **Sources:** `code-reviewer.md` finding 2, `verifier.md` finding 1
- **Files:** `apps/web/src/app/actions/public.ts:9-28`, `apps/web/src/lib/data.ts:307-335`, `apps/web/src/components/load-more.tsx:7-45`
- **Why it matters:** new processed uploads can shift the ordered dataset between fetches, so `offset` pagination can duplicate/skip rows; separately, the action hard-stops once `offset > 10000`, making sufficiently large galleries incomplete.
- **Concrete failure:** a user scrolling while new uploads finish processing can miss older photos or see duplicates; a gallery above ~10k rows simply stops loading.
- **Suggested fix direction:** move the public load-more flow to a cursor/keyset contract keyed by the active sort tuple and remove the silent deep-offset cutoff.

### AGG6-02 — Auth same-origin validation succeeds when source headers are missing
- **Severity / confidence:** MEDIUM / MEDIUM
- **Source:** `security-reviewer.md` finding 2
- **Files:** `apps/web/src/lib/request-origin.ts:62-80`, `apps/web/src/app/actions/auth.ts:92-95,274-277`
- **Why it matters:** auth flows intend to require same-origin provenance, but the default helper currently returns success when both `Origin` and `Referer` are absent.
- **Concrete failure:** a browser/proxy path that strips both headers weakens the intended login / password-change provenance check.
- **Suggested fix direction:** default `hasTrustedSameOrigin()` to `allowMissingSource: false`, and require explicit opt-in where compatibility fallback is actually wanted.

### AGG6-03 — Photo metadata editor keeps stale local values after successful sanitization
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `debugger.md` finding DBG6-01
- **Files:** `apps/web/src/components/image-manager.tsx:226-243`, `apps/web/src/app/actions/images.ts:546-599`
- **Why it matters:** the server trims / strips control chars before persisting, but the client writes the raw pre-save strings back into local state.
- **Concrete failure:** an admin saves `"Sunset   "`; the DB stores `"Sunset"`, but the table still shows the stale untrimmed value until refresh.
- **Suggested fix direction:** return normalized values from the action (or refresh) and hydrate the optimistic client state from those persisted values.

### AGG6-04 — Unauthenticated `/admin` renders the protected admin shell
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `designer.md` finding 2
- **Files:** `apps/web/src/app/[locale]/admin/layout.tsx:1-16`, `apps/web/src/components/admin-header.tsx:1-24`, `apps/web/src/components/admin-nav.tsx:1-33`, `apps/web/src/app/[locale]/admin/page.tsx:1-15`
- **Why it matters:** the login route shows dashboard/categories/tags/etc. plus a logout button before auth is established.
- **Concrete failure:** first-time admins can click dead-end protected affordances, get bounced back, and see a visually inconsistent auth experience.
- **Suggested fix direction:** render a stripped login shell for unauthenticated admin routes; only show protected nav/logout chrome once auth is confirmed.

### AGG6-05 — Photo prev/next navigation drops topic/tag collection context
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `critic.md` finding 2
- **Files:** `apps/web/src/components/home-client.tsx:242-243`, `apps/web/src/lib/data.ts:474-545`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:217-229`
- **Why it matters:** opening a photo from a filtered topic/tag page still navigates prev/next against the global processed-image set.
- **Concrete failure:** a user browsing `/travel?tags=night` clicks next on a photo and lands outside that collection.
- **Suggested fix direction:** carry collection context into the photo route and compute prev/next inside that scope.

### AGG6-06 — Default Playwright runs skip admin workflows
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `test-engineer.md` finding 1
- **Files:** `apps/web/e2e/admin.spec.ts:6-7`, `apps/web/package.json:18`
- **Why it matters:** the shipped `npm run test:e2e --workspace=apps/web` path does not cover login, protected admin navigation, dashboard upload, or admin settings unless an extra env flag is set.
- **Concrete failure:** admin regressions ship while E2E still passes green.
- **Suggested fix direction:** make local/CI admin E2E part of the default required path, or fail loudly when it is intentionally skipped.

### AGG6-07 — Nav “visual checks” do not assert regressions
- **Severity / confidence:** LOW / HIGH
- **Source:** `test-engineer.md` finding 2
- **Files:** `apps/web/e2e/nav-visual-check.spec.ts:5-32`
- **Why it matters:** screenshot capture alone cannot fail when the layout regresses.
- **Concrete failure:** spacing/overlap regressions still pass because `page.screenshot()` succeeds.
- **Suggested fix direction:** replace artifact-only captures with screenshot assertions or another enforceable diff workflow.

### AGG6-08 — Public photo route mixes ISR with per-request admin auth
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `architect.md` finding ARCH6-01
- **Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:1-125`, `apps/web/src/app/actions/auth.ts:21-53`
- **Why it matters:** the route declares a week-long `revalidate` window but also calls `isAdmin()` during render, pulling request-specific cookie/auth state into a nominally cacheable public page.
- **Concrete failure:** anonymous public traffic pays request-time auth/render cost instead of a cleanly cacheable public shell.
- **Suggested fix direction:** remove auth personalization from the route render path or make the route explicitly dynamic.

### AGG6-09 — E2E seed generation hardcodes derivative sizes
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `critic.md` finding 3
- **Files:** `apps/web/scripts/seed-e2e.ts:57-90`, `apps/web/src/lib/gallery-config-shared.ts:82-152`, `apps/web/src/app/actions/settings.ts:68-99`
- **Why it matters:** the product treats `image_sizes` as configurable, but the E2E fixture generator always emits only `640/1536/2048/4096` plus base files copied from `2048`.
- **Concrete failure:** changing `image_sizes` creates a mismatch between generated fixtures and requested derivatives.
- **Suggested fix direction:** have the seed script read the active configured sizes (or defaults) and generate exactly those derivatives.

### AGG6-10 — CSV export is capped at 50k rows without a deterministic full-export contract
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `verifier.md` finding 2
- **Files:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-104`
- **Why it matters:** the export query is limited to 50,000 rows and has no explicit ordering, so large galleries can receive unstable partial exports.
- **Concrete failure:** repeated exports of an 80k-image library can include different subsets across runs.
- **Suggested fix direction:** add deterministic ordering immediately and plan a real paged/streamed full export path if full inventory exports are a product requirement.

### AGG6-11 — Sitemap truncates at 24k images with no overflow path
- **Severity / confidence:** MEDIUM / HIGH
- **Source:** `verifier.md` finding 3
- **Files:** `apps/web/src/app/sitemap.ts:1-55`, `apps/web/src/lib/data.ts:834-844`
- **Why it matters:** once the library exceeds the single-file cap, older images disappear from crawler discovery because there is no sitemap index or chunking.
- **Concrete failure:** a 30k-image gallery exposes only the newest 24k image pages in `sitemap.xml`.
- **Suggested fix direction:** emit chunked sitemap files plus an index route instead of truncating inside one sitemap.

### AGG6-12 — Legacy topic seed script inserts uppercase slugs
- **Severity / confidence:** LOW / HIGH
- **Source:** `code-reviewer.md` finding 3
- **Files:** `apps/web/src/db/seed.ts:4-10`, `apps/web/src/lib/validation.ts:12-15`
- **Why it matters:** current runtime validation only accepts lowercase slugs, but the legacy seed path still inserts uppercase topic slugs.
- **Concrete failure:** seeded topics can become unreachable or uneditable without manual cleanup.
- **Suggested fix direction:** normalize the seed data to lowercase or add a bounded migration for legacy uppercase rows.

### AGG6-13 — Admin/SEO settings clients can drift from sanitized persisted values
- **Severity / confidence:** LOW / HIGH
- **Source:** `debugger.md` finding DBG6-02
- **Files:** `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-56`, `apps/web/src/app/actions/seo.ts:65-127`
- **Why it matters:** the server trims and strips control chars, but the client retains the raw pre-save values as its new baseline.
- **Concrete failure:** trailing whitespace appears “saved” in the admin UI even though public metadata uses the sanitized value.
- **Suggested fix direction:** return normalized values from the server action and rehydrate client state from them after a successful save.

### AGG6-14 — Designer-reported inert public controls conflict with existing passing Playwright coverage
- **Severity / confidence:** LOW / HIGH
- **Source:** `designer.md` finding 1 versus current checked-in E2E coverage
- **Conflicting evidence:**
  - `apps/web/e2e/public.spec.ts:19-35` already asserts the search dialog opens, autofocuses, traps focus, and closes correctly.
  - `apps/web/e2e/public.spec.ts:49-63` already asserts the photo lightbox opens/closes.
  - `apps/web/e2e/nav-visual-check.spec.ts:15-23` clicks the mobile nav expand button and expects the search button to become visible.
- **Disposition:** treat the “public controls are inert” claim as **needs revalidation on current HEAD**, not an immediate implementation task.

## Carry-forward architectural / operational risks

These were raised in specialist reviews but are better treated as larger-scope architectural follow-up than narrow same-cycle fixes:
- `architect.md` ARCH6-02 — split mutable shared-group view buffering out of `lib/data.ts`
- `architect.md` ARCH6-R01 — single-process deployment assumptions remain implicit
- `security-reviewer.md` finding 1 — historical example secrets remain compromised in git history (operational rotation / documentation issue, not a current-HEAD secret leak)
- `security-reviewer.md` finding 3 — CSP still allows `'unsafe-inline'`
- `critic.md` finding 4 — shared-group view counts are intentionally lossy and approximate

## AGENT FAILURES

None final. One `architect` attempt initially returned its review inline instead of writing the artifact due a spurious read-only misunderstanding; retry succeeded and produced `.context/reviews/architect.md`.

## TOTALS
- **14 total unique findings**
- **2 multi-agent / cross-source high-signal items** (`AGG6-01`, `AGG6-14`)
- **12 single-source specialist findings / risks**
