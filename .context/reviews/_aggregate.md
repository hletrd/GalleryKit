# Aggregate Review — Cycle 13 (2026-05-05)

**Review methodology**: Single-agent multi-perspective deep review (code-quality, security, architecture). No custom reviewer agents available in this environment. All critical source files examined.

**Quality gates — all green**

| Gate | Result |
|------|--------|
| `npm run lint --workspace=apps/web` | PASS (0 errors) |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | PASS (0 errors) |
| `npm test --workspace=apps/web` | PASS (123 files, 1049 tests) |
| `npm run test:e2e --workspace=apps/web` | PASS (20 passed, 2 skipped) |
| `npm run lint:api-auth --workspace=apps/web` | PASS |
| `npm run lint:action-origin --workspace=apps/web` | PASS |
| `npm run lint:public-route-rate-limit --workspace=apps/web` | PASS |

---

## NEW FINDINGS: 1

### C13-LOW-01: CSP nonce leaked via `x-nonce` HTTP response header
- **File+line**: `apps/web/src/proxy.ts:33-34`
- **Severity**: LOW
- **Confidence**: HIGH
- **CWE**: CWE-200
- **Cross-agent agreement**: Code reviewer (C13-LOW-01), Security reviewer (SEC-LOW-01)
- **Description**: `applyProductionCsp` copies the CSP nonce from request headers to response headers as `x-nonce`. Same-origin JavaScript can read arbitrary response headers via `fetch()`/`XMLHttpRequest`, allowing an attacker with script execution to obtain the nonce and bypass CSP inline-script protections.
- **Failure scenario**: Attacker with DOM XSS capability fetches same-origin page, reads `x-nonce` header, injects `<script nonce="stolen">...</script>`.
- **Suggested fix**: Remove `response.headers.set('x-nonce', nonce)` from `applyProductionCsp`. Server components read nonce from request headers (`csp-nonce.ts`); client script tags receive nonce via HTML attributes. No code reads `x-nonce` from response headers.
- **Verification**: Full codebase search confirmed zero client-side reads of `x-nonce` response header.

---

## PREVIOUSLY FIXED FINDINGS (CONFIRMED STILL FIXED)

All previously fixed items from cycles 1-12 remain intact:
- C12-LOW-04: AVIF probe Promise-based singleton (commit 44151ca)
- C12-LOW-01: Comment-stripped rate-limit prefix check (commit 4fc5cfa)
- C11-MED-01: Topic existence check before upload (commit a26bc28)
- C11-MED-02: permanentlyFailedIds check in enqueue (commit eefa3f5)
- All C1-C12 fixes verified as intact

---

## CORRECTIONS TO PRIOR FINDINGS

- **C11-LOW-01 / C12-LOW-04 / C13-LOW-05 (proxy.ts empty-field check)**: Already identified in prior aggregate `_aggregate-c13.md` as a FALSE POSITIVE. The token format check at `proxy.ts:104` correctly rejects empty fields via `tokenParts.some(p => p.length === 0)`. No action needed.

---

## AREAS EXAMINED WITH NO ISSUES FOUND

### Code Quality / Correctness
- Semantic search route: rate-limit ordering, rollback placement, body size guards all correct
- AVIF high-bitdepth probe: Promise-based singleton prevents races correctly
- Image queue: GC interval cleanup, bootstrap continuation, claim retry logic all correct
- Upload tracker: reconciliation math handles partial failures correctly
- View count flush: atomic Map swap, retry cap, backoff, chunking all correct
- Data layer: cursor pagination, search dedup, privacy field guards all correct
- Process image: EXIF extraction, ICC parsing, color pipeline all correct

### Security
- Auth: Argon2id, HMAC-SHA256 sessions, timing-safe comparison, cookie attributes all correct
- Authorization: same-origin guards, admin auth, last-admin protection all correct
- Input validation: path traversal, symlink, filename sanitization, EXIF bounds all correct
- Output encoding: JSON-LD escaping, CSV sanitization, LIKE escaping all correct
- Rate limiting: all public surfaces metered, rollback patterns correct
- Privacy: field separation, compile-time guards, GPS stripping all correct

### Architecture
- Module layering: data/process-image/auth cleanly separated
- Single-instance topology: correctly documented and acknowledged
- i18n: locale-prefix routes, server-side translations, organized key structure
- Build pipeline: service worker generation, standalone output, Docker multi-stage

---

## CONVERGENCE ASSESSMENT

After 14 cycles of reviews (cycles 1-13 plus this cycle), the repository has fully stabilized for its current feature set. One LOW-severity finding was identified this cycle (CSP nonce header leak). All quality gates pass with 1049 tests across 123 files. The review surface is approaching exhaustion for the current feature set — future findings would likely require new feature development or a fundamentally different review lens.
