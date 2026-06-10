# Aggregate review — Run-4 Cycle 6

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md` (code-reviewer + debugger + tracer)
- `security-reviewer-critic-verifier.md` (security + critic + verifier)
- `perf-reviewer-architect.md` (perf-reviewer + architect)
- `test-engineer.md` (test-engineer + gates baseline)
- `document-specialist.md` (document-specialist)
- `designer.md` (designer)

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c5). Each angle was executed as a
distinct full-inventory pass in-context; no angle sampled. Inventory
this cycle: independent regression review of all 6 cycle-5 fix commits,
the LEAST-run-4-covered surfaces by a per-file coverage map built over
run4-c1..c5 review texts (components, timeline stack, analytics data,
audit, atom feed, SW stack, admin clients, robots/manifest/
instrumentation, checkout/semantic anonymous routes, proxy middleware,
next.config/nginx serving layers), repo-wide pattern sweeps
(`isComposing` census, Enter-handler census, `revalidate` exports,
deferral exit criteria), EN/KO message parity flatten-diff, and LIVE
PRODUCTION verification against https://gallery.atik.kr (HTML and
derivative cache-control/ETag headers) which converted two architecture
hypotheses into verified facts.

## Context
Run-4 cycles 1-5 saturated the actions/API/admin-DB surfaces. This
cycle deliberately rotated to the interaction layer (components,
keyboard/IME, a11y) and the DELIVERY layer (service worker, cache
policies, nginx/Next static serving) — and found the cycle's two
highest-signal clusters exactly there.

## Cross-angle agreement
- **COR-R4C6-01 (IME)** — raised independently by the code angle
  (handler census) and the designer angle (ko-locale interaction
  audit); test angle confirmed zero composition coverage. Three angles,
  one root cause: no composition guard exists anywhere in the repo.
- **COR-R4C6-05 (dead SW HTML cache)** — perf/architect established the
  no-store interaction, security established the forbidden-header dead
  guard, verifier proved both against production headers. Three angles.
- **ARCH-R4C6-06 (three-way cache-policy contradiction)** — architect +
  perf + document-specialist (doc claims false) + verifier (live
  headers). Four angles.
- **COR-R4C6-02 (timeline truncation)** — code + designer (honesty
  framing); document-specialist adds the non-sargable-comment
  correction.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C6-01 | MED-HIGH/High | No IME composition guards on any Enter/Arrow handler (tag-input, search, image-manager batch-tag, topic-manager rename, tokens-client create; plus search ArrowUp/Down hijacking candidate navigation and Escape killing the dialog mid-composition). Korean text entry — the product's second first-class locale — commits half-composed values / fires actions on the IME-commit keystroke. Fix: shared `isImeComposingEvent` guard consulted first in every affected handler; unit + source-contract tests | code, designer, test |
| COR-R4C6-02 | MED/High | `/timeline?year=` and `/year/[year]` silently truncate at `TIMELINE_PAGE_LIMIT = 100` (DESC order ⇒ EARLY months vanish entirely from month sections + JSON-LD) with no signal. Fix: raise cap to 500, limit+1 truncation probe, localized visible notice on both pages (EN+KO together), comment correction on the non-sargable YEAR() claim | code, designer, document-specialist |
| UX-R4C6-03 | MED/Medium-High | Lightbox auto-hide dead: hide-timer bails when `dialogRef.contains(document.activeElement)`, which is always true (mount-focus on close button + FocusTrap). Fix: bail only for `:focus-visible` (keyboard) focus; blur mouse-focused controls before hiding so `aria-hidden` never lands on a focused element (WCAG 4.1.2) | designer, debugger |
| A11Y-R4C6-04 | MED/High | Lightbox `<img aria-label="N / M">` overrides the photo alt text in accessible-name computation; position is already announced by the dedicated `role="status"` live region. Fix: remove the aria-label | designer |
| COR-R4C6-05 | MED/High (prod-verified) | SW HTML offline-fallback cache provably dead: every public page ships `no-store` (revalidate=0 dynamic) so `isSensitiveResponse` blocks every `put`; PWA offline = always 503. Compounding: `hasAdminSession()` reads the forbidden `Cookie` header — permanently false. Fix: `proxy.ts` sets `x-gk-admin-render: 1` when an admin_session cookie is present; SW caches 200 GET HTML as an explicit offline-only exemption unless 401/403/admin-route/admin-render; docs + template source-contract tests | perf, architect, security, verifier |
| ARCH-R4C6-06 | MED/High (prod-verified) | Image derivatives have THREE contradictory cache policies: serve-upload (3600+must-revalidate+v7 ETag — never runs for existing files; public/ wins over route handlers), repo nginx (`immutable 1y` — stale-bytes hazard vs in-place backfill re-encode), production actual (Next static `public, max-age=0` + size-mtime ETag — a revalidation RTT per image per view). Fix: unify on `public, max-age=3600, must-revalidate` via next.config `headers()` for `/uploads/{jpeg,webp,avif}/**` (fixes production immediately, deployment-independent), align nginx/default.conf, correct CLAUDE.md serving/ETag sections; host-nginx drift recorded in the deferred ledger as an ops runbook item | architect, perf, document-specialist, verifier, critic |
| COR-R4C6-07 | LOW/High | search.tsx semantic branch lacks the stale-response requestId guard after `resp.json()` (keyword branch has it) — slow response A can clobber fresher B | code |
| COR-R4C6-08 | LOW/High | checkout route: image fetch + price read outside the try — DB error consumes the per-IP budget with no rollback (violates its own Pattern-2 contract) and returns a framework 500 without NO_STORE | code, security |
| STD-R4C6-09 | LOW/Medium-High | atom-feed emits `<name type="text">` — RFC 4287 atomPersonConstruct admits no `type` attribute on atom:name (R18-L2 overshoot); schema-invalid, validator-flagged. Fix: bare `<name>`; correct the fixture pinning the wrong shape in the same commit | document-specialist, security(concur) |
| COR-R4C6-10 | LOW/Medium | `purgeOldAuditLog`: negative `AUDIT_LOG_RETENTION_DAYS` → future cutoff → deletes the ENTIRE audit log; `\|\|` rescues 0/NaN but not negatives | code |
| TEST-R4C6-11 | LOW-MED gap/High | `lib/sw-cache.ts` is tested-but-not-shipped and diverged from `sw.template.js` (quota-eviction `if (deleted)` accounting only in the template). Fix: backport to the lib, document template-as-shipped, template source-contract suite (carries the COR-R4C6-05 contracts too) | test, perf |
| COR-R4C6-12 | LOW/Medium | lightbox Space branch: `preventDefault` before `isEditableTarget` — the guard cannot do its job (latent; no editable targets in the lightbox today). Reorder | code |

## Regression review of cycle-5 commits
All 6 fix commits independently re-reviewed: **sound** (per-commit
traces in the code angle file). The FOUND_ROWS insertId conjunction was
re-derived logically against all three ODKU outcome shapes.

## Verified-clean highlights (evidence in per-angle files)
- Semantic-search enrichment stays within `publicSelectFields`; topics
  have no visibility flag to violate.
- EN/KO message parity: 0 / 0 missing keys (programmatic diff).
- Touch-target audit ledger counts match reality; no new violations.
- Standing deferrals DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 re-audited
  with fresh grep evidence — all exit criteria un-triggered.
- analytics-data, audit insert path, exif-datetime UTC discipline,
  proxy.ts guard logic, robots/manifest, instrumentation shutdown,
  auth-rate-limit rollback discipline, sales-client money path — clean.

## Gate baseline (clean tree)
- vitest 1628/1628 PASS (166 files) · typecheck PASS · eslint 0/0
- lint:api-auth PASS · lint:action-origin PASS · lint:public-route-rate-limit PASS
- build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset features. The
content-hashed-filename alternative for ARCH-R4C6-06 was explicitly
REJECTED as out-of-scope migration; the chosen fix is policy
unification only. Nothing dropped: 12 findings → 10 fix tasks (2 test
gaps fold into parents) + 1 ops-runbook deferral (host-nginx drift,
non-code).

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context
(documented constraint, same as run2/run3/run4-c1..c5); all angles
executed in-context with full inventory and per-angle provenance files
above.
