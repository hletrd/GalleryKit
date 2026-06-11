# Plan 503 — LOW + documentation / i18n / UX-polish (Run-5 Cycle 1)

**Source:** `.context/reviews/_aggregate.md` (run-5 cycle 1, 2026-06-11)
**Scope:** 33 finding IDs batched into 5 coherent work units. Includes 5 MED doc-only findings (severity preserved, noted per item) whose fixes are documentation; all other items are LOW.
**Folds handled elsewhere:** TRC-R5C1-01 → plan-502 item 15; COR-R5C1-04 → plan-501 item 3; COR-R5C1-05 → plan-502 item 16.

Each unit = one or a few fine-grained commits; full gates per commit.

---

## Unit A — Documentation truth pass (CLAUDE.md / AGENTS.md / .env.local.example / source docblocks)

One sweep over the doc surfaces; group commits by file to keep diffs reviewable. 13 findings.

| Finding | Sev | Fix |
|---|---|---|
| VER-R5C1-01 (+VER-02/08, DOC-01/08) | **MED** | CLAUDE.md ETag paragraph + Key Files row + `settings-hash.ts:7-9` docblock: reference the full 9-key `COLOR_IMPACTING_KEYS` list ("see settings-hash.ts" is acceptable in CLAUDE.md); drop the spurious `.slice(0,8)` from the documented formula (truncation is internal to the library). Coordinate wording with ARCH-R5C1-01 below. |
| ARCH-R5C1-01 | **MED** | Same CLAUDE.md paragraph: state plainly that in the shipped nginx topology existing derivatives are served by nginx sendfile (mtime/size ETag) — the serve-upload settings-hash ETag executes only on the locale-prefixed/fallback path, and real-world invalidation rides the mandatory backfill's mtime change. Add a matching comment at `serve-upload.ts:200`. (Structural URL-versioning alternative recorded as future work, not scheduled.) |
| DOC-R5C1-02 | **MED** | Document BOTH backfill concurrency knobs with defaults (`BACKFILL_CONCURRENCY`=2 sidecar; `ADMIN_BACKFILL_CONCURRENCY`=1 in-app) in CLAUDE.md backfill block + `.env.local.example`. (Renaming to one shared var is acceptable if the implementer prefers — then update both code sites + docs together.) |
| DOC-R5C1-03 | **MED** | Deployment Checklist step 3: "Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json`". |
| DOC-R5C1-04 | **MED** | Add commented entries to `.env.local.example`: `UPLOAD_ORIGINAL_ROOT`, `UPLOAD_ROOT`, `ADMIN_BACKFILL_CONCURRENCY`, `IMAGE_CLEANUP_CONCURRENCY`, `NEXT_PUBLIC_GA_ID`, `NEXT_UPLOAD_BODY_MAX_BYTES` (+ defaults/effects). Per CRT-R5C1-03 (plan-501 item 5) `NEXT_PUBLIC_HDR_FEATURE_FLAG` is being deleted — do NOT document it; if plan-501 kept it as reserved, mark it "inert/reserved". |
| CRT-R5C1-06 | LOW | CLAUDE.md backfill sidecar block: replace hardcoded `/home/ubuntu/gallery` with `$DEPLOY_PATH` reference + cross-link `.env.deploy`. |
| VER-R5C1-03 | LOW | CLAUDE.md env section: "SESSION_SECRET: min 32 chars enforced (recommend `openssl rand -hex 32` → 64 hex chars)". |
| DOC-R5C1-05 (+09) | LOW | CLAUDE.md Performance section: reference the `*Cached` exports ("9 cache()-wrapped exports ending in `Cached` — see data.ts:1558-1610") instead of the 3 unwrapped names. |
| DOC-R5C1-06 (+26) | LOW | AGENTS.md: replace "1300+ unit tests" with the current `npm test` summary number (test-engineer measured 1799) or drop the count. |
| DOC-R5C1-07 (+16) | LOW | CLAUDE.md serving-precedence note: document BOTH upload route files (`app/uploads/[...path]` and `app/[locale]/(public)/uploads/[...path]`) and that both delegate to `serveUploadFile` — patch headers/auth in the shared delegate only. |
| DOC-R5C1-11 | LOW | Deployment Checklist: one sentence that Docker performs `npm install` during build. |
| DOC-R5C1-24 | LOW | CLAUDE.md blur contract: "4096-char string cap (~3 KB decoded payload)". |
| DOC-R5C1-27 | LOW | CLAUDE.md Common Commands: note root `npm run build` uses `--workspaces` (builds all) unlike sibling `--workspace=apps/web` scripts. |

**Also fold here (from plan-502 items):** TRUST_PROXY dependency note (item 6), `VIEW_EVENT_RETENTION_DAYS` (item 12), geoip-lite staleness note (item 13).
**Gate impact:** none code-wise; verifier doc-truth pass next cycle is the check.
**Acceptance:** next cycle's verifier finds zero of these specific drifts.

## Unit B — A11y / i18n polish (designer LOW batch)

7 findings; single-file changes; i18n parity + touch-target audit after each.

| Finding | Fix |
|---|---|
| DES-R5C1-17 | `nav-client.tsx:164` — replace the hardcoded ko/English ternary with a `localeDisplayNames` map sourced from i18n config (extensible to a third locale). |
| DES-R5C1-18 | `photo-viewer.tsx:592` — wire `aria-describedby="photo-viewer-shortcuts"` on the container the shortcuts describe, or remove the dead id. |
| DES-R5C1-19 | `home-client.tsx:397` — `aria-hidden="true"` on the decorative empty-state SVG. |
| DES-R5C1-20 | `upload-dropzone.tsx:486-490` — inherited global tags get `aria-label={t('upload.globalTagInherited', { tag })}` (new en/ko key) or fieldset/legend grouping. |
| DES-R5C1-21 | `app/[locale]/error.tsx:21` — mirror `not-found.tsx:29`: `aria-hidden` decorative giant text + real AA-contrast heading. |
| DES-R5C1-22 | `lightbox.tsx:666-674` — `aria-label={t('aria.photoPosition', {current, total})}` on the counter (coordinate with plan-501 item 15, which touches the same node; if 501 already landed it, mark done). |
| DES-R5C1-23 | `info-bottom-sheet.tsx:221-222` — add `paddingBottom: env(safe-area-inset-bottom)` to the outer container (cheap, harmless); physical iOS-15 device verification deferred to a manual pass (needs-manual-validation classification preserved). |

## Unit C — Code hygiene / micro-perf (LOW)

7 findings.

| Finding | Fix |
|---|---|
| CRT-R5C1-05 (+ARCH-06) | `lib/storage/{index,local,types}.ts` — make `switchStorageBackend` THROW `NotImplemented` for any non-`'local'` type and add an UNUSED/NOT-WIRED banner to the module header (safer than deletion mid-cycle; deletion-first option remains open to the implementer after re-grep — repo destructive-action rule applies). Update `storage-local.test.ts` to pin the throw. |
| COR-R5C1-02 | `analytics.ts:126-138, 149-181` — collapse bare IPv4/IPv6 host literals to `'direct'` before `extractTldPlusOne` (regex for `[...]`-wrapped or all-digit-dot hosts). Unit test: `https://[2001:db8::1]:8080/x` → `direct`. |
| COR-R5C1-06 | `db-actions.ts:331-360` — fix the stale line-number comment; hoist lock teardown into one boolean-guarded outer-finally helper so future early-returns can't strand `LOCK_DB_RESTORE`. No behavior change; existing restore tests must stay green. |
| PERF-R5C1-10 | `process-image.ts:485-526` — delete paths pass the configured sizes for the deterministic unlink path; run the full `opendir` orphan scan only when the sizes config changed since the image was processed (or behind an explicit `deepClean` flag used by maintenance). |
| BUG-R5C1-06 | `image-queue.ts` (~:498) — stop resetting `bootstrapCursorId` to null on permanent failure; the `notInArray` exclusion already prevents re-pick. Unit test: cursor preserved after a permanent failure. |
| BUG-R5C1-07 | `process-image.ts` (`verifyAvifNclxInBuffer`) — reuse the bounded ISOBMFF walker from `color-detection.ts` (preferred) or widen the scan to 64 KB. Audit-noise fix only. |
| BUG-R5C1-08 | `image-queue.ts` bootstrap loop — hoist `[...permanentlyFailedIds]` out of the loop; re-evaluate whether the IN-exclusion is needed during bootstrap at all (advisory lock + `processed=false` claim already guard) — if removed, document why. |

## Unit D — Security / robustness polish (LOW)

4 findings.

| Finding | Fix |
|---|---|
| SEC-R5C1-04 | `seo-og-url.ts:9-24` — normalize the relative branch via `new URL(value, base)` and re-assert `origin === base.origin` (security-reviewer's snippet). Unit tests: `/%2f%2fevil.com`, `/%5cevil.com` rejected; normal `/og.jpg` accepted. Defense-in-depth; current guard sound for known vectors. |
| CRT-R5C1-04 | `stripe/webhook/route.ts:96-99` — add the `checkout.session.async_payment_succeeded` case reusing the completed-path entitlement insert (idempotency already keyed per session); plus a one-line CLAUDE.md note that delayed-payment methods are now safe to enable. Behavioral test alongside plan-502 item 22. |
| ARCH-R5C1-05 | `rate-limit.ts:79-119` — promote the OG-image and checkout limiters to the existing DB-backed `rateLimitBuckets` pattern (the two cost-bearing surfaces); leave share/search in-memory and document them as best-effort per the single-writer topology. Unit test: budget survives a simulated process restart (new Map, same DB). |
| COR-R5C1-07 | HEIC tier-2 GPS-strip gap — honesty surfacing only this cycle: when the lossless scrubber returns null on HEIC and re-encode is impossible, (a) record a per-image admin-visible flag/warning (Color Details audit row or processing-warning field) instead of only an error log, and (b) document the limitation in CLAUDE.md Privacy. The fail-closed product decision (reject upload vs serve re-encoded "original") is recorded in deferred.md with an exit criterion. |

## Unit E — Test hygiene (LOW)

2 findings.

| Finding | Fix |
|---|---|
| TEST-R5C1-14 | `touch-target-audit.test.ts:575-593` — promote stale `KNOWN_VIOLATIONS` entries (found < allowed) from `console.warn` to hard failure (`expect(stale).toHaveLength(0)`), forcing allowance decrements when components are fixed. Sweep current allowances in the same commit so the gate lands green. |
| TEST-R5C1-15 | new `csp-nonce.test.ts` — generated nonce length/charset/uniqueness (N=1000 distinct); header extraction round-trip. `apps/web/src/lib/csp-nonce.ts`. |

---

## Suggested commit order

Unit A (docs, zero regression risk) → Unit E (test gates tighten) → Unit B (a11y) → Unit C (hygiene) → Unit D (security polish, needs the most care/review).
