# Security Review Report — GalleryKit (CLIP semantic-search focus)

**Reviewer:** security-reviewer agent (read-only; report persisted by orchestrator from inline return)
**Date:** 2026-06-16
**Scope:** New CLIP semantic-search feature (this session) + the auth/rate-limit/privacy infrastructure it touches. Non-CLIP surface re-spot-checked (prior cycles converged to 0).
**Risk Level: LOW** — no exploitable vulnerability on the CLIP surface. One LOW supply-chain hardening note (operator-only provisioning script) and one pre-existing INFORMATIONAL transitive-dependency advisory unrelated to CLIP.

CLIP is deployed dark (`semantic_search_mode` default `'disabled'`). I treated "not live" as by-design and did NOT flag it. Every finding was validated from source, not comments.

## Methodology
Inventoried and fully read (not sampled) every CLIP-touching file: both routes (`api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts`); lib (`clip-embeddings.ts`, `clip-model.ts`, `clip-model-id.ts`, `clip-inference.ts`); scripts (`download-clip-models.ts`, `backfill-clip-embeddings.ts`); integration (`image-queue.ts` embedding hook, `actions/embeddings.ts` admin backfill); supporting primitives (`request-origin.ts`, `rate-limit.ts`, `action-guards.ts`, `gallery-config.ts`/`gallery-config-shared.ts`, `upload-paths.ts`, `data.ts` select-field split); UI (`components/search.tsx`, `similar-photos.tsx`); `Dockerfile`, `package.json`/lockfile. Ran the repo's own gates: `lint:public-route-rate-limit` (PASS), `lint:action-origin` (PASS), `npm audit --omit=dev`. Secrets scan + git history over the CLIP surface: clean.

## OWASP Top 10 against the CLIP surface
- **A01 Access Control — PASS.** Both public routes fail-closed same-origin; admin backfill gates `isAdmin()` + `requireSameOriginAdmin()`; no `api/admin/**` CLIP route exists. IDOR on `similar/[id]` not exploitable (below).
- **A02 Crypto — PASS.** No crypto/secrets introduced; runtime model load offline.
- **A03 Injection — PASS.** Drizzle-parameterized only; zero `child_process`/`exec`/`spawn` in the CLIP path (grep-confirmed); React-escaped output; query never reflected as HTML.
- **A04 Insecure Design — PASS.** Dark launch; stub/production `model_version` isolation; stub honesty disclaimer.
- **A05 Misconfig — PASS.** `runtime='nodejs'`, `force-dynamic`, `no-store` + `nosniff`; weights not baked into image.
- **A06 Vulnerable Components — LOW/INFO.** `@huggingface/transformers@3.8.1` current; one pre-existing transitive postcss advisory via Next (INFO-1).
- **A07 Auth — PASS.** No new auth surface.
- **A08 Integrity — LOW.** SEC-CLIP-01 (manifest verified after model load on fresh-download path).
- **A09 Logging — PASS.** Server-side logs; generic localized client errors; no PII/secret logged.
- **A10 SSRF — PASS.** Runtime makes no outbound requests (offline `allowRemoteModels=false`); only the operator download script fetches, over HTTPS at a pinned revision; no user-controlled URL.

## Findings

### SEC-CLIP-01 — Model SHA-256 manifest verified after ONNX session instantiation (fresh-download path)
**Severity LOW · Confidence High · CWE-494 / CWE-367**
`apps/web/scripts/download-clip-models.ts:97-130`. On the idempotent path (file present) checksum is verified BEFORE load (`:73-85`) — correct. On the fresh-download path, `AutoModel.from_pretrained` (`:97`) downloads AND instantiates the ONNX session, and only THEN (`:111-135`) is the manifest compared. Tampered weights would be parsed/loaded before the mismatch is detected (the script then `exit(1)`, but after the fact). **LOW because:** operator-only one-time provisioning script (not attacker-reachable); HTTPS + hard-pinned immutable `JINA_CLIP_REVISION`; runtime never downloads (`clip-model.ts:61` `allowRemoteModels=false`, reads pre-verified volume); ONNX-graph parse is not RCE under normal config. **Fix:** verify the on-disk artifact checksum BEFORE relying on the session; on mismatch delete the poisoned file and abort; document running only from a trusted network.

### INFO-1 — Transitive postcss advisory via Next build toolchain (pre-existing, not CLIP)
**Severity INFO · Confidence High · GHSA-qx2v-qp2m-jg93.** `npm audit --omit=dev` → `next > postcss <8.5.10` (2 moderate), build-time CSS stringify path, unrelated to CLIP and not request-reachable. `audit fix --force` wrongly proposes `next@9.3.3` — do NOT run it; track the upstream Next bump.

## Checked and CONFIRMED SAFE (no finding)
- **Public-route same-origin + rate-limit.** Both routes call `hasTrustedSameOrigin` first (fail-closed, `request-origin.ts:88-107`); share `preIncrementSemanticAttempt` 30/min/IP bounded map with Pattern-2 rollback. `similar` is GET (not covered by the RL lint gate) but rate-limits anyway. Shared `'unknown'`-IP bucket when `TRUST_PROXY` unset is documented, deliberate, and an availability (not leak) degradation.
- **No PII / admin-only leak.** Enrichment SELECT returns only public columns (`id, title, description, filename_jpeg, width, height, topic, topic_label, camera_model`); none of `_PrivacySensitiveKeys`. Matches the keyword-search public field set.
- **No private/unprocessed exposure (core risk).** Visibility model is `processed=true` + topic membership; no per-image private flag in schema. Both routes filter `processed=true`. ALL THREE embedding write paths only write for `processed=true`. So an unprocessed image has no embedding row → `similar` 404 is indistinguishable from a nonexistent id → no enumeration oracle.
- **IDOR on `similar/[id]`.** `id` parsed as positive int; target looked up by `(id, PRODUCTION_MODEL_VERSION)`; results restricted to `processed=true`; self excluded. Attacker only learns relations among already-public `/p/{id}` photos. No boundary crossed.
- **DoS bounds.** Scan hard-capped `SEMANTIC_SCAN_LIMIT=5000` × 512-dim cosine; `topK` bounded; body double-capped 8 KiB; chunked TE rejected; Content-Type strictly prefix-validated; query ≥3 codepoints. Production-mode ONNX text-encode gated behind 30/min AND production (dark).
- **`clampSemanticTopK`.** Rejects non-`number` → default, then clamps `[1,50]` with `floor`+`isFinite`. NaN/Inf/neg/oversized neutralized.
- **Path traversal in backfill.** `resolveOriginalUploadPath` joins DB `filename_original` under fixed roots; on-disk names are server `crypto.randomUUID()`. No vector.
- **Embedding (de)serialization.** Strict `EMBEDDING_BYTES=2048` enforcement; wrong-length rows skipped (not thrown into response); per-row base64 try/catch. No proto-pollution/unsafe-deser/`eval`/`Function`. (NOTE: the strict length-skip is exactly what makes the separately-reported CR-CLIP-01 Buffer/base64 read bug *silent* — every row is skipped, not errored. Security-neutral, correctness-fatal-when-enabled; see aggregate AGG-C10-01.)
- **XSS/query reflection.** Results render via React text + Next `<Image src>`; query used only as fetch body / controlled input value. No reflected/stored XSS.
- **Secrets/supply chain.** No keys/tokens in any CLIP file; no `HF_TOKEN`/`HF_ENDPOINT`; public model id + revision; offline runtime.

## Findings summary (for aggregator)
- **[LOW][High] SEC-CLIP-01** — `download-clip-models.ts:97-130`: SHA-256 manifest verified after ONNX session load on fresh-download path (CWE-494/367). Operator-only, HTTPS+pinned, offline runtime → minimal exposure; verify-before-load is the fix.
- **[INFO][High] INFO-1** — Pre-existing transitive `postcss <8.5.10` via Next build toolchain. Not CLIP, not runtime-reachable. Do NOT `audit fix --force`. Track upstream.
- **No CRITICAL / HIGH / MEDIUM security findings on the CLIP surface.** Dark-launch posture intact and undisturbed.
