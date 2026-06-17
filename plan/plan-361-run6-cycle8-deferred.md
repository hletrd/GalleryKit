# Plan 361 — Run 6 / Cycle 8 (orchestrator cycle 8/100) — Deferred Register

**Created:** 2026-06-17
**HEAD at planning:** `1a325fa6`
**Source:** `.context/reviews/_aggregate.md` (cycle-8 fan-out, 11/11 agents) + per-agent reviews.
**Status:** DEFERRED REGISTER. Every cycle-8 finding NOT scheduled in `plan-360-run6-cycle8-fixes.md` is recorded here with file+line, **original** severity/confidence (NOT downgraded to justify deferral), a concrete deferral reason, and the exit criterion that re-opens it. Per the review-plan-fix deferred-fix rules, this register is ONLY for existing review findings — no new refactors/features are introduced here.

**Deferral integrity / repo-policy basis.** Of the 13 cycle-8 findings, 10 are scheduled in plan-360. The 3 recorded below are deferred because each requires a **concurrency-architecture design pass** (worker_threads / sidecar inference pool, or a load-time integrity-verification design) that the original deferral (plan-349 DEF-1/DEF-18/DEF-20) explicitly stated should be "designed (architect-led) as part of the eventual activation work, not bolted on." Bolting a half-designed worker pool onto the live path this cycle would be higher-risk to the now-LIVE feature than the bounded, mitigated status quo. None of the three is an *exploitable* security defect or a data-loss defect at HEAD:

- AGG-C8-01 is an **availability** concern whose worst case is mitigated by (a) the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + DB-row double-gate (operator-opted-in single deployment only), and (b) `onnxruntime-node`'s `session.run` being async-offloaded (perf-reviewer verified `await model(...)` does not block the loop) — so the residual main-thread cost is the JS cosine loop + tensor marshalling, not the full inference. It is NOT a correctness/data-loss defect.
- AGG-C8-08 is **defense-in-depth** (the download-time SHA gate + immutable revision pin + HTTPS + `allowRemoteModels=false` are the primary, intact protections; the runtime mount is a trusted-operator surface). Security-reviewer rated overall cycle-8 risk LOW (0 Crit / 0 High security). Not an exploitable code defect at HEAD.
- AGG-C8-13 is **LOW** hardening polish.

When picked up, all three remain bound by repo commit policy: GPG-signed (`-S`), conventional-commit + gitmoji, no `--no-verify`, no force-push, `git pull --rebase` before push, run all GATES.

> **Important status change vs prior cycles.** AGG-C8-01 / AGG-C8-08 / AGG-C8-13 are the re-surfacing of plan-349 DEF-1 / DEF-18 / DEF-20, which were deferred under "CLIP is deployed DARK; production activation deferred by user choice." That basis is now **invalidated** — production is LIVE by explicit user decision (cycle-8 run context). The old exit criterion ("RE-OPEN the moment production activation is scheduled") has **FIRED**. These are therefore re-opened here as **active, now-reachable** items (AGG-C8-01 escalated back to its original HIGH), deferred only on the narrower "needs an architect-led design pass, not a same-cycle bolt-on" basis above — NOT on the now-void "dark feature" basis.

---

## DEF-C8-1 [HIGH / High] — AGG-C8-01: production CLIP inference + cosine scan on the main event loop

- **File/line:** `apps/web/src/lib/clip-model.ts` (`embedTextReal` / `embedImageReal`); scan consumers `apps/web/src/app/api/search/semantic/route.ts` (~line 241-278), `apps/web/src/app/api/search/similar/[id]/route.ts` (~line 142-168); upload path `apps/web/src/lib/image-queue.ts` (~line 446). Root: the per-request ≤5000-row JS cosine scan + ONNX tensor pre/post run on the Node main thread; no worker / yield.
- **Original severity/confidence:** HIGH / High (critic CRT-C8-01; perf + tracer corroborate the bound). NOT downgraded.
- **Why deferred (not a same-cycle fix):** the correct remedy is a `worker_threads`/sidecar inference + scan pool — a substantial concurrency-architecture change. plan-349 DEF-1 explicitly scoped this as architect-led activation work, "not bolted on." A rushed worker pool on the LIVE path risks the feature more than the mitigated status quo. The blast radius is bounded today by the operator double-gate and the async ONNX backend (the heavy inference does NOT block; only the JS cosine loop does).
- **Interim mitigation already in plan-360:** TASK-2 adds the `(model_version, updated_at)` index and TASK-5 swaps the production scan to the cheaper `dotProduct` — both reduce the per-request main-thread cost now, shrinking the window AGG-C8-01 describes. Consider also lowering the 5000-row scan cap as a cheap interim throttle if operator load warrants (not scheduled this cycle; would need a recall-vs-latency decision).
- **Exit criterion:** schedule an architect-led design for off-main-thread inference + scan (worker_threads pool or a bounded queue) as the next substantive CLIP work item; treat as BLOCKING HIGH for any move toward higher query volume or multi-instance topology. Re-open immediately if production search latency/availability is observed to degrade under concurrent load.

## DEF-C8-2 [MEDIUM / High] — AGG-C8-08: runtime loader trusts on-disk ONNX with no pre-parse checksum

- **File/line:** `apps/web/src/lib/clip-model.ts` — the `from_pretrained` load reads the ONNX weight from the `CLIP_MODELS_ROOT` bind-mount and instantiates the session with no SHA verification before parse. (Re-open of plan-349 DEF-18.)
- **Original severity/confidence:** MEDIUM / High (critic CRT-C8-04). NOT downgraded.
- **Why deferred:** defense-in-depth, not an open exploit. The checksum gate lives in the *download* script (post-download, delete-on-mismatch); the runtime mount is a trusted-operator surface, protected by the immutable revision pin + HTTPS at download + `allowRemoteModels=false` (no runtime fetch). Adding a first-load SHA check is a small, safe enhancement but needs a deliberate decision on load-latency cost (hashing a ~580 MB ONNX on cold start) vs. documenting the mount as a trust boundary — a design call, not a mechanical fix. The manifest + `sha256File` helper already exist, so the eventual fix is cheap.
- **Exit criterion:** when the off-main-thread work (DEF-C8-1) is designed, fold in a first-load manifest-SHA verification before `from_pretrained` (cost amortized into the one-time singleton load), OR add an explicit "the CLIP weights mount is a trust boundary" note to the security architecture docs. Re-open as blocking if the weights mount ever becomes writable by a non-operator process.

## DEF-C8-3 [LOW / Medium] — AGG-C8-13: reload-storm / CSP gap on the live search surface

- **File/line:** the live semantic/similar surface (`apps/web/src/app/api/search/semantic/route.ts`, `similar/[id]/route.ts`, and the `search.tsx` / `similar-photos.tsx` client) — no CSP tightening or model-reload backoff accompanied activation. (Re-open of plan-349 DEF-5/DEF-20.)
- **Original severity/confidence:** LOW / Medium (critic CRT-C8-05). NOT downgraded.
- **Why deferred:** LOW residual risk. The model-reload-storm path only triggers when the weights volume is absent in production (a misconfiguration), and the `loadPromise` nulls-on-failure-then-retries behavior is benign (no poisoned cache); the React 19 stale-response `requestIdRef` guard already prevents state clobbering on rapid input. CSP hardening is general polish not specific to this activation.
- **Exit criterion:** bundle the model-load backoff with the DEF-C8-1 production-activation design work; address CSP as part of a dedicated security-headers pass if/when one is scheduled. Re-open if a reload storm is observed in production logs.

---

## Deferral integrity statement
- **No CRITICAL is deferred** (cycle-8 found 0 CRITICAL).
- The one **HIGH on a live path** (DEF-C8-1) is deferred ONLY on the "needs architect-led design, not a same-cycle bolt-on" basis (matching the original DEF-1 framing), with interim main-thread-cost reductions (index + dotProduct) scheduled in plan-360 THIS cycle, and with a concrete re-open trigger. It is an availability concern with a mitigated worst case, not a correctness/data-loss/exploitable-security defect.
- The second HIGH/UX (AGG-C8-04) and the other HIGH (AGG-C8-02) are **scheduled in plan-360**, not deferred.
- DEF-C8-2 (MEDIUM) is defense-in-depth on a trusted-operator surface, not an exploitable defect — deferral is rule-permitted.
- All three carry preserved original severity and a fired/active re-open status. None is silently dropped.
