# Plan 284 — Run-4 Cycle 6 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle6/_aggregate.md`
Every finding from the run-4 cycle-6 reviews is either scheduled in
`plan/plan-283-run4-cycle6-fixes.md` or recorded here. Severity/confidence
preserved from the original review (no downgrades). Deferred work remains
bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji,
no `--no-verify`, Node 24 / TS 6 toolchain) when picked up.

## Deferred items

### OPS-R4C6-01 — production host nginx lacks the repo's `/uploads/` location block (deployment drift)
- **Citation:** `apps/web/nginx/default.conf:146-157` (repo config) vs
  live header probe on https://gallery.atik.kr (`cache-control: public,
  max-age=0` + Next static ETag — requests are proxied to Next instead of
  sendfile-served by nginx). Part of finding **ARCH-R4C6-06 (MED/High)**;
  the original severity/confidence is preserved here, NOT downgraded.
- **What lands in this cycle anyway (plan-283 Task 5):** the
  `next.config.ts headers()` rule fixes the production cache policy
  through the path that actually serves the bytes, so the user-visible
  perf defect is CLOSED this cycle deployment-independently; the nginx
  config in the repo is also corrected (immutable→must-revalidate).
- **What is deferred:** applying/reconciling the uploads location on the
  PRODUCTION HOST's nginx (outside this repo's `npm run deploy` path,
  which only rebuilds the Docker app — host nginx is hand-managed).
  Host-level config surgery is a destructive-action-policy surface and
  is not performed unprompted by the loop.
- **Reason for deferral:** not a code change; requires host nginx edit +
  reload in a maintenance window. After plan-283 Task 5, behavior is
  correct through the proxy path; the nginx sendfile path is a pure CPU
  offload optimization.
- **Exit criterion:** next host-level nginx maintenance (operator
  applies `apps/web/nginx/default.conf`'s uploads location — now with
  the corrected cache policy — and reloads), OR origin CPU pressure from
  image serving shows up in monitoring.
- **Runbook:** ssh ubuntu@atik.kr → diff live nginx site config against
  `apps/web/nginx/default.conf` → port the
  `location ~ ^(?:/[a-z]{2})?/uploads/(jpeg|webp|avif)/...` block
  (root `/home/ubuntu/gallery/apps/web/public`, adjust from the
  container path `/app/apps/web/public`) → `nginx -t` → reload →
  verify `curl -sI .../uploads/jpeg/<file>` shows the unified
  `max-age=3600, must-revalidate` policy.

## Standing deferrals re-audit (from prior cycles — still valid, exit criteria un-triggered; fresh evidence in `.context/reviews/run4-cycle6/document-specialist.md`)

- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Exit criterion: ISR reintroduction on any public route, or profiling
  showing measurable cost. Checked this cycle: all 9 public pages still
  export `revalidate = 0` (grep evidence). Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes.
  Exit criterion: first endpoint consuming `lr:read` / `lr:delete` lands.
  Checked this cycle: scopes appear only in `lib/admin-tokens.ts`
  declarations, an `api-auth.ts` comment, and the granting UI; the only
  consuming route remains `api/admin/lr/upload` (`lr:upload`). Remains
  deferred.
- **DEF-R4C3-01** (plan-278) — LR upload ROUTE error strings hardcoded
  English (machine-client surface). Exit criterion: LR plugin gains
  localization or a browser consumer calls the route. Checked this
  cycle: neither happened. Remains deferred.

## Non-deferrals (for the record)
All 12 cycle-6 findings are scheduled in plan-283 (10 tasks; 2 test-gap
findings fold into their parent tasks). No security, correctness, or
data-loss finding was deferred. OPS-R4C6-01 above defers only the
non-code host-config half of ARCH-R4C6-06 whose code half lands fully
this cycle.
