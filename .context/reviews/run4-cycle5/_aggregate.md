# Aggregate review — Run-4 Cycle 5

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md` (code-reviewer + debugger + tracer)
- `security-reviewer-critic-verifier.md` (security + critic + verifier)
- `perf-reviewer-architect.md` (perf-reviewer + architect)
- `test-engineer.md` (test-engineer + gates verifier)
- `document-specialist.md` (document-specialist)
- `designer.md` (designer)

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c4 — see `run4-cycle1/_aggregate.md`).
Each angle was executed as a distinct full-inventory pass in-context; no
angle sampled. Inventory this cycle: regression review of all 10 R4C4
self-authored fix commits (its review committed mid-stream, so those
commits had no independent reviewer), full reads of the admin DB surface
(backup/restore/CSV + download route), the anonymous action surface
(public.ts full), the smart-collection stack end-to-end (action → data
helper → page → load-more client), syndication/SEO emitters (feed.xml ×2,
sitemap, OG photo route), settings/seo/topics/tags/sharing/images action
regions, cursor pagination machinery, repo-wide pattern sweeps
(`Math.floor(Number(`, `affectedRows === 0`, `offsetOrCursor`), docs
(CLAUDE.md / AGENTS.md gate sections), i18n key parity on touched
surfaces, and a LIVE MySQL semantics verification against the running
`gk-e2e-mysql` container (temp-table session; killed one false finding
class before it became four wrong "fixes").

## Context
Run-4 cycle 4 closed the serving-debounce + refund-convergence cluster.
This cycle prioritized (1) independent regression review of those 10
commits, (2) the smart-collection surface — the least-tested public
stack (zero unit or e2e references) — where the highest-value finding
landed, (3) failure-path validation against live MySQL, (4) dead-surface
hygiene on the `'use server'` boundary.

## Cross-angle agreement
- **COR-R4C5-01** was independently developed by the code/tracer angle
  (coercion trace), the perf angle (unbounded duplicate DOM growth +
  wasted window-scan per fire), and the designer angle (repeating
  gallery + false `aria-live` announcements + count mismatch); the test
  angle supplied the enabling-gap diagnosis (TEST-R4C5-06). Four angles,
  one root cluster: **highest-signal finding this cycle.**
- **SEC-R4C5-02** raised by security; architect concurred with the
  boundary rule ("a 'use server' export list IS attack surface") and
  endorsed deletion over gating.
- **I18N-R4C5-03** raised by designer; security concurred and added the
  internals-exposure facet on the embeddings message.
- The **affectedRows false-class** was raised by code-reviewer as 4-5
  candidate bugs and KILLED by the verifier's live MySQL probe — recorded
  prominently so future cycles do not re-litigate; spawned the
  DOC-R4C5-08 comment correction.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C5-01 | MED/High | Smart-collection load-more: client cursor object is coerced `Number(obj)→NaN→0` so EVERY load-more re-fetches page 1 (duplicate grid, endless sentinel loop, false aria-live progress, wasted window-scan per fire); separately the action's `safeLimit + 1` double-applies the helper's internal +1 lookahead, permanently hiding the last photo of collections sized ≡ 1 (mod 30). Fix: cursor support in `getImagesForSmartCollection` (reuse `normalizeImageListCursor` + `buildCursorCondition`, identical ORDER BY), mirror `loadMoreImages`'s normalize/invalid branches in the action, pass `safeLimit` | code/debugger/tracer, perf, designer, architect (fix shape) |
| SEC-R4C5-02 | LOW-MED/High | `actions/collections.ts:119-124` dead `getSmartCollections` server action: unauthenticated, un-rate-limited, returns ALL columns of ALL rows including `is_public = false` collections (query_json ASTs); exempt comment factually wrong ("public listings"). Zero callers today (not in any client bundle) — delete the export | security, critic, architect |
| I18N-R4C5-03 | LOW/High | `collections.ts:33,78` return raw English `e.message` (parser validation strings) and `embeddings.ts:112-113` returns raw `err.message` (can carry DB internals) across localized action boundaries — same class R4C4-05 closed on tokens; fix = localized generic key + server-log detail, EN+KO added together | designer, security (concur) |
| COR-R4C5-04 | LOW/Medium | `api/download/[imageId]/route.ts:200-218` — `fileHandle.stat()` sits between `open()` and the catch; a stat throw (EIO/EBADF) returns 404/500 WITHOUT closing the just-opened handle, violating the R4C4-06 "cannot leak" contract on the paid-download path | code, debugger |
| LOW-R4C5-05 | LOW/High(behavior)·Low(impact) | `lib/analytics.ts:107` strips exactly one trailing dot; `github.com..` (WHATWG-URL-preserved, attacker-suppliable Referer) still records bare `"com."` — strip ALL trailing dots | code |
| TEST-R4C5-06 | MED-gap/High | Zero unit/e2e coverage of `loadMoreSmartCollectionImages` / `getImagesForSmartCollection` (enabled COR-R4C5-01) — behavioral + boundary + source-contract cases added with the fix | test-engineer |
| TEST-R4C5-07 | LOW-gap/High | Download-route FileHandle leak contract missing the stat-throw case — add with COR-R4C5-04 | test-engineer |
| DOC-R4C5-08 | LOW/High | Webhook comment (and cycle-4 aggregate record) claims "no CLIENT_FOUND_ROWS flag"; live probe proves mysql2 defaults INCLUDE FOUND_ROWS (no-op UPDATE → affectedRows=1). **UPGRADED during implementation — see COR-R4C5-09 addendum below**: the webhook's insert is ON DUPLICATE KEY UPDATE (not INSERT IGNORE), and under FOUND_ROWS the no-op dup reports affectedRows=1 too — the conclusion was NOT safe | document-specialist, verifier |
| COR-R4C5-09 | MED/High | **(Addendum — found while implementing Task 6's comment fix and live-probing the exact ODKU statement shape.)** `api/stripe/webhook/route.ts:357` `insertedFresh = affectedRows === 1` is INEFFECTIVE under mysql2 default FOUND_ROWS: the dup-key no-op loser (`set: { sessionId }` to its current value) ALSO reports affectedRows=1 (live-verified: fresh = (1, insertId>0); loser = (1, insertId=0); changed dup = (2, existing id)). The R4C3-02 race window therefore still logged `Entitlement created` + the LOG_PLAINTEXT_DOWNLOAD_TOKENS dead-token line. Fix: gate on `affectedRows === 1 && insertId > 0` (insertId live-verified as the disambiguator); contract test updated to pin the conjunction | verifier (live probe), debugger |

All 9 findings (8 from the review pass + the COR-R4C5-09 implementation-time
addendum) are scheduled in this cycle's fix plan (plan-281); the two
test gaps fold into their parent fixes. No new deferrals; the three
standing deferrals (DEF-R4C1-01, DEF-R4C2-01, DEF-R4C3-01) were re-audited
and their exit criteria remain un-triggered (evidence in
document-specialist file; ledger in plan-282).

## Verified-clean highlights (evidence in per-angle files)
- All 10 cycle-4 self-authored commits independently regression-reviewed:
  sound. SWR debounce traced through all four cache states; refund
  convergence maps only `charge_already_refunded`; LR settle idempotency
  holds; download claim ordering keeps tokens intact pre-claim; scalar
  enforcement cannot break stored queries (no boolean column in the
  allowlist).
- **False class killed by live verification:** the 14 `affectedRows === 0`
  guards are all correct — mysql2 default FOUND_ROWS means matched-rows
  semantics (no-op admin saves do NOT trip "not found" errors). Four
  candidate findings withdrawn before planning; recorded to prevent
  re-litigation.
- Backup/restore surface: filename regex blocks header injection;
  advisory-lock discipline + early-return releases verified; spawn env
  hygiene (MYSQL_PWD, no HOME) intact.
- Anonymous surface: every public action/route metered (search,
  load-more ×2, view-record ×3, OG ×2) with symmetric rollback.
- XML/OG emitters escape every interpolation; sitemap budget math and ISR
  posture correct.
- CLAUDE.md/AGENTS.md gate documentation current (four lint scripts +
  typecheck).

## Gate baseline (clean tree)
- vitest 1616/1616 PASS (165 files) · typecheck PASS · eslint 0/0
- lint:api-auth PASS · lint:action-origin PASS · lint:public-route-rate-limit PASS
- build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset/tone-authoring features.
Nothing dropped: 8 findings → 6 fix items (2 test gaps folded) + 0 new
deferrals.

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context
(documented constraint, same as run2/run3/run4-c1..c4); all angles
executed in-context with full inventory and per-angle provenance files
above.
