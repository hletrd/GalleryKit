# GalleryKit — Security Review (run-10 cycle-3)

Start HEAD: `e08b6f97`. Predecessor: `.context/reviews/cycle-2-2026-07-07/security-reviewer.md`
(no CRIT/HIGH; findings LOW/INFO). Method: (1) verified the six cycle-2
security-relevant commits for correctness + bypasses/regressions; (2) full-repo pass
over auth/session/origin libs, all API routes (admin + public), all 13 server-action
files, upload/serve/SSRF/injection surfaces, nginx/Docker/entrypoint, and the
smart-collection AST compiler. Read the code; did not modify sources.

## Executive summary

**No CRITICAL or HIGH vulnerabilities found. No confirmed new MEDIUM/LOW vulnerability
found.** All six priority commits are correct with no regressions or bypasses I could
construct. The codebase's documented security invariants (withAdminAuth wrapping,
requireSameOriginAdmin on every mutating action, rate-limit pre-increments on expensive
public surfaces, path-traversal/SSRF pinning, injection parameterization, Unicode/JSON-LD
sanitization) hold in practice. The two items below are INFO-level observations that are
already mitigated by existing controls — recorded for author awareness, not as exploitable
gaps and not requiring a code change. This lane confirms the cycle-2 posture is intact.

## Priority-1: cycle-2 commit verification

| Commit | What it does | Verdict |
|--------|--------------|---------|
| `3b8d05c8` | `default-src 'none'; frame-ancestors 'none'; sandbox` CSP on non-dev `/api/:path*` | CORRECT. Closes the real gap (proxy.ts matcher excludes `/api`; the `/(.*)` CSP was dev-only). `sandbox` + `default-src 'none'` do not break embedded-image consumption of OG cards (they are `<img src>` targets, not framed docs). Header-shape test pins the 3-rule prod / 2-rule dev shape. |
| `a4a2d250` | `buildCspSafely` degrades instead of 500ing on malformed `IMAGE_BASE_URL` | CORRECT. Wrapper never throws; on failure rebuilds CSP with `imageBaseUrl: null` (drops only the CDN img-src source, keeps `'self' data: blob:`), logs once/process. proxy.ts now calls the safe wrapper on every request. Closes the availability-only SEC-05 (cycle-2). |
| `af3b2f7d` | nginx `zone=public 10r/s burst=40` on catch-all `location /` only | CORRECT. `^~ /_next/static/`, `^~ /_next/image`, `~ /uploads/(jpeg|webp|avif)/`, and the `^~ /api/admin*` + admin page regexes all match longer/higher-priority prefixes and stay off the public zone, so a normal cold-cache page load's asset fan-out cannot self-trip the burst. `limit_conn 20` (server-scope) is inherited by every location incl. `/_next/image`. See SEC3-01. |
| `b24572b0` | `logAuditEvent` catches internally + `console.error`s, never rejects | CORRECT. Failed forensic writes now surface at error level instead of being swallowed by callers' `.catch(console.debug)`. Success path stays silent. No behavior change for callers (returned promise still resolves). |
| `9ce5cf96` | ISOBMFF child-box bound by parent container end (color-detection + gain-map walkers) | CORRECT. Both walkers now reject a child whose declared size overruns its container (`> limit`/`> end`) even when it stays inside the whole buffer — matching `gps-exif-strip.ts walkChildren` (verified `pos + size > end` at `gps-exif-strip.ts:411`). Closes a HEIF `is_hdr` accept/reject flip via sibling-byte CICP/infe reads. Crafted-buffer tests pin both. |
| `b4e986c3` | migrate.js applies pending NEW migrations instead of pre-baselining them | CORRECT (correctness/data-integrity, not directly exploitable). Restores drizzle's apply path + the "fails loud" post-condition; pending-vs-drift split baselines only at/below-cursor hashes and loudly names any above-cursor entry it baselines without executing. Not a security bypass; verified it does not weaken the SQL-restore scanner or auth surfaces. |

## Priority-2: full-repo pass — verified-correct (no finding)

- **Session/auth** (`session.ts`, `api-auth.ts`, `admin-tokens.ts`, `request-origin.ts`):
  HMAC-SHA256 session tokens verified with `timingSafeEqual` and length-equalized buffers;
  shape/age checks run AFTER the crypto compare (no timing oracle); token hashed at rest;
  prod refuses the DB-stored secret fallback. PATs: 256-bit CSPRNG, SHA-256 stored,
  `timingSafeEqual` on hex digests, `expires_at` + scope enforced, DB lookup by hash (no
  plaintext in query logs), fails closed if the table is absent. `withAdminAuth` centrally
  enforces same-origin for the cookie path and pre-verify IP rate-limits the token path;
  token path correctly bypasses same-origin (by design) but stays scope-gated. `getClientIp`
  only trusts XFF/X-Real-IP under `TRUST_PROXY=true`, hop-count aware, `normalizeIp`-validated,
  512-char XFF cap, loud warn on proxy-headers-without-TRUST_PROXY.
- **Middleware** (`proxy.ts`): admin-route cookie format gate (len ≥ 100, three non-empty
  colon segments) is presence-only by design; full crypto validation stays in actions. The
  per-request nonce+CSP is freshly generated with `.set()` (overwrites any client-supplied
  `Content-Security-Policy`/`x-nonce` request headers — no nonce/CSP injection). Login
  redirect target is an internal `/admin` or `/{validated-locale}/admin` (no open redirect).
- **API routes**: `db/download` (strict `isValidBackupFilename` + realpath containment +
  symlink-safe fd reuse; `Content-Disposition` filename is pre-validated so no header
  injection). `lr/upload` (token-scope gated; symmetric claim/settle on every early return;
  idempotent settle; GPS strip on disk + DB under `strip_gps_on_upload`; HDR-ingest gate;
  contract lock in `finally`; post-commit failures still return parseable 201). `og/photo/[id]`
  (SSRF pinned to `BASE_URL` origin, fails closed if unparseable — never `req.url`;
  open-redirect fallback validated same-origin; charged-post-validation rate limit).
  `search/semantic` + `search/similar/[id]` (same-origin, maintenance, content-type prefix,
  chunked-reject, Content-Length + post-parse byte caps, abort handling, charged-after-admission
  limiter, PII-safe compile-guarded enrichment select). `health`/`live` bounded.
- **Path traversal / SSRF**: `serve-upload.ts` — `ALLOWED_UPLOAD_DIRS` + `SAFE_SEGMENT`
  allowlist + `.`/`..`/length rejection + `lstat` symlink reject + `realpath` containment +
  dir↔extension map; `og-photo-fetch.ts` fetches a DB-generated UUID derivative name against
  the pinned origin, per-attempt timeout below the whole-chain budget, 1 MB cap.
  `next.config.ts` `remotePatterns` pinned to the single parsed `IMAGE_BASE_URL` host and
  `localPatterns` to `/uploads`+`/resources`, so `/_next/image` is not an open proxy.
- **Injection**: `smart-collections.ts` AST compiler uses a column allowlist (never user
  strings in column position), Drizzle parameter binding / `inArray` / parameterized `sql`
  templates for all values, `isScalarValue` rejects object/array values that would expand
  into SQL fragments, and depth/node/children/IN-value budgets; tag subquery params bound;
  `containsLike` escapes `% _ !` with `ESCAPE '!'`. `db-actions.ts` mysqldump/mysql/migrate
  spawns use array args (no shell), env-based credentials (`MYSQL_PWD`, not argv), and a
  minimal child env (no `SESSION_SECRET` leak); SQL-restore denylist scanner + `--one-database`.
  No `eval`/`new Function`. `dangerouslySetInnerHTML` appears only for JSON-LD, all routed
  through `safeJsonLd` (escapes `< > U+2028 U+2029`).
- **Upload abuse**: `getSafeExtension` strips to `[a-z0-9.]`, allowlists image extensions
  (no SVG/HTML), throws `RawFileError` for camera RAW; on-disk names are UUIDs; GPS scrubbed
  on disk + DB; size/count/byte caps + TOCTOU-safe quota claim + restore-maintenance fencing.
  ISOBMFF walkers bounds-checked (priority commit above).
- **Rate limiting**: all public mutating/expensive surfaces pre-increment before the guarded
  work — `recordPhotoView`/`recordTopicView`/`recordSharedGroupView` all validate → maintenance
  → DB-backed `checkViewRecordRateLimit` → existence → insert (limiter before write);
  `loadMore*`/`searchImagesAction` carry `@action-origin-exempt` + own limiters; OG/share/feed/
  semantic buckets present and invoked. Origin-guard tally across the 13 action files matches
  the documented posture (mutating → `requireSameOriginAdmin`; read-only public →
  `@action-origin-exempt`; `auth.ts`/`public.ts` use their approved variants).
- **Secrets / container**: `git ls-files` shows no tracked `.env*`/keys/secrets (only the
  `tracked-secrets` test + `.example`); `.gitignore` covers `.env`, `.env.local`, `.env.deploy`.
  Non-root `node` via gosu, `chmod 700` on private originals, liveness-only healthcheck,
  reproducible lockfile install, `NEXT_MANUAL_SIG_HANDLE` clean shutdown, `nginx` overwrites
  XFF with `$remote_addr` (documented topology contract), `/uploads/original/` returns 404 at
  the edge AND `original` is rejected by `serveUploadFile`.

## Findings

### SEC3-01 — `/_next/image` is excluded from the public edge rate-limit zone (INFO, High confidence, informational — no change required)
- Location: `apps/web/nginx/default.conf:234-243` (`location ^~ /_next/image`), vs the
  `zone=public` limiter applied only at `location /` (`:245-266`).
- Observation: `af3b2f7d` deliberately keeps Next's on-demand image optimizer off the public
  page limiter so a normal masonry paint's parallel derivative requests do not self-trip the
  per-IP burst. That endpoint runs a Sharp re-encode per uncached `(url,w,q)` tuple, so in
  isolation it is a heavier CPU surface than a static file.
- Why it is NOT a finding: the amplification is bounded on three independent axes —
  (1) `limit_conn connlimit 20` is declared at server scope (`:59`) and inherited by
  `/_next/image` (the location does not redefine it), capping concurrent per-IP requests;
  (2) Next only honors `w` values in the configured device/image size set and constrained
  `q`, so the reachable `(w,q)` product per image is small and the optimizer caches results
  to `.next/cache/images`; (3) `localPatterns`/`remotePatterns` pin the fetchable source to
  local `/uploads`+`/resources` and the single configured CDN host (no SSRF). Pre-existing
  posture (the whole surface was unthrottled before this commit); the commit strictly improved
  it for pages. Suggested action: none — recorded so a future limiter-tightening pass knows
  this exclusion is intentional and already backstopped by `limit_conn`.

### SEC3-02 — nginx admin-mutation location allowlist is a hand-maintained regex that omits some admin page paths (INFO, Medium confidence, informational — no change required)
- Location: `apps/web/nginx/default.conf:130` (`location ~ ^(/[a-z]{2})?/admin/(categories|tags|users|password|seo|settings|tokens)`).
- Observation: admin mutations on pages not in that explicit list (e.g. a server-action POST
  to `/[locale]/admin/images`) do not match the `admin` zone / larger body cap and instead
  fall through to the catch-all `location /` (`public` zone, 2 MiB body). The regex is a
  manually-curated allowlist that can drift from the real set of admin page routes.
- Why it is NOT a finding: the edge zone is defense-in-depth only. Every admin mutation is
  independently gated at the app layer by `withAdminAuth` / `requireSameOriginAdmin()` +
  `isAdmin()` (verified this cycle), and the catch-all still applies the `public` per-IP
  limiter + 2 MiB cap, which is sufficient for the small-body admin mutations that land there
  (large-body admin flows — dashboard upload 216 MiB, db restore 250 MiB, lr/upload 216 MiB —
  have their own dedicated locations). So drift affects edge-throttle tightness, never
  authorization or a body-size bypass of an app limit. Suggested action: none required; if a
  future admin mutation needs a >2 MiB body and is added outside `/admin/dashboard`, add its
  path to a dedicated location (same pattern as `lr/upload`).

## Commonly-missed sweep (all clear)
- Timing: session + PAT compares are constant-time and run before shape/age checks; no
  secret-dependent early return.
- TOCTOU: upload quota claim before first await; serve/download reuse the stat()'d fd for the
  body; view-record rate-limit precedes insert.
- Open redirect: OG fallback + middleware login redirect are same-origin/internal-path only.
- Host-header trust: XFH is only consulted under `TRUST_PROXY`; the residual topology
  dependency is the already-registered SEC-04 (cycle-2) / C1-11 operator item, not new.
- Cache poisoning: admin API responses forced `no-store` by `withAdminAuth`; OG SSRF pinned
  to canonical origin (a forged Host cannot redirect the internal derivative fetch).

## Conclusion
Priority-1 commits: all correct, no bypass/regression. Priority-2 full pass: no new
exploitable vulnerability. Two INFO observations recorded above are non-actionable and
already backstopped. Security posture matches the cycle-2 baseline.
