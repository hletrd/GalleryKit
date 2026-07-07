# Cycle 7 Architect Review

Reviewer angle: architectural/design risk, coupling & layering, single-writer/process-local-state
assumptions, duplicated sources of truth, advisory-lock scoping, module boundary leaks
(client-safe vs server-only), config-precedence / build-time-vs-runtime inlining traps.
Baseline: committed HEAD `14d31ea4`. Peer-owned `.context/reviews/*.md` (flat files), `plan/`, and
`deferred-carry-forward.md` were not touched or edited.

**Note on the assigned angle file:** the briefing asked me to examine a newly-added
`apps/web/src/lib/image-base-url.ts`. That file does not exist. Commit `05fa5cd1`'s own message
documents an explicit "Rejected" decision: *"keep a separate image-base-url TS helper | Next's
compiled config could not require the nested TS dependency during typegen."* Instead the shared
sanitizer (`sanitizeImageBaseUrl`/`sanitizeImageBaseUrlSafely`/`parseCspImageBaseUrl`) was added to
the already config-safe `apps/web/src/lib/content-security-policy.ts` and re-exported through
`constants.ts`/`image-url.ts`. I reviewed the actual resulting architecture below (constants.ts,
image-url.ts, content-security-policy.ts, next.config.ts) instead of a non-existent file — this
surfaced two concrete, verified findings (C7-ARCH2, C7-ARCH3) that are direct consequences of that
rejected-file decision, plus one adjacent finding on the same "shared canonical URL" theme
(C7-ARCH1) in the freshly-hardened `request-origin.ts` (peer commits `d8fcb3d6`/`57e2c5d3`).

---

## C7-ARCH1 — `request-origin.ts`'s canonical-origin anchor silently omits the `site-config.json` fallback that every other "effective base URL" consumer shares

`[SEV: MED | CONF: High | duplicated-source-of-truth / config-precedence]`

**Location:** `apps/web/src/lib/request-origin.ts:45-48` (`getConfiguredBaseOrigin`)

**Evidence.** The codebase has exactly one true "effective base URL" formula,
`process.env.BASE_URL || siteConfig.url`, and it is hand-copied at **six** independent call sites
that all agree with each other:

- `apps/web/src/lib/constants.ts:26` — `export const BASE_URL = process.env.BASE_URL || siteConfig.url;` (with its own doc comment claiming "Single source of truth prevents inconsistent URL derivation across pages")
- `apps/web/src/lib/data.ts:1845` and `:1869` (`_getSeoSettings` / `buildSeoSettingsFallback`)
- `apps/web/src/lib/seo-og-url.ts:3` (default parameter)
- `apps/web/src/app/sitemap.ts:18` — note this file *already* imports `LOCALES` from
  `@/lib/constants` two lines above (`sitemap.ts:15`) but does not import the exported `BASE_URL`
  constant, re-deriving the identical expression locally instead
- `apps/web/scripts/ensure-site-config.mjs:12` (the production build-time gate)

`request-origin.ts:45-48` is the **seventh, divergent** copy:

```ts
function getConfiguredBaseOrigin() {
    const configured = process.env.BASE_URL?.trim();
    return configured ? toOrigin(configured) : null;
}
```

It reads only `process.env.BASE_URL` — there is no `|| siteConfig.url` fallback. This function
feeds `getExpectedOrigin()` (`request-origin.ts:60-81`), which this cycle's peer commits
(`57e2c5d3`, `d8fcb3d6`) deliberately hardened to *prefer* the configured canonical origin over
Host/X-Forwarded-Host header inference specifically so CSRF/same-origin checks "do not depend on
forwarded host/proto headers" (57e2c5d3 commit message). `ensure-site-config.mjs` build-time-gates
production builds on the **OR-combined** value (env var **or** site-config.json) being a real,
non-placeholder absolute URL — so a deployment that configures only `site-config.json`'s `url`
field (a fully legitimate, explicitly documented path: see `CLAUDE.md`'s Deployment Checklist item
3, "`url` — canonical base URL used when `BASE_URL` is unset") passes the build gate and gets
correct SEO/OG/sitemap/JSON-LD URLs everywhere — but its CSRF same-origin check silently falls
back to the weaker Host-header-inference path in `getExpectedOrigin()`, because
`getConfiguredBaseOrigin()` never looks at `siteConfig.url`.

**Why this is a problem.** This is precisely a "two (here, seven) hand-maintained things that must
agree" hazard: nothing types or tests the invariant that "canonical base URL" resolves identically
everywhere. `request-origin.test.ts` only exercises the `process.env.BASE_URL` path
(`request-origin.test.ts:89-90`, `git show 9cd8d3e8/d8fcb3d6`) — there is no test asserting
`getConfiguredBaseOrigin()` falls back to `siteConfig.url` the way its six siblings do. The
divergence is not cosmetic: it silently narrows the scope of this cycle's own security hardening
directive ("Keep `BASE_URL` configured on production deploys") to operators who set the env var
specifically, even though the documented, build-gated, equally-legitimate configuration surface is
"either env var or site-config.json." An operator who followed the Deployment Checklist to the
letter (site-config.json only) believes they get the canonical-anchor hardening and does not.

**Failure scenario.** Fresh install: operator sets `src/site-config.json.url =
"https://gallery.example.com"`, leaves `BASE_URL` unset (both documented as acceptable).
`ensure-site-config.mjs` passes at build time. In production, `getConfiguredBaseOrigin()` returns
`null`, so `getExpectedOrigin()` falls through to Host/X-Forwarded-Host inference — exactly the
weaker path this cycle's commits were written to avoid. If nginx's `server_name` is not tightly
pinned (an operator-owned config outside this repo) and/or `TRUST_PROXY` handling has any gap, the
CSRF/same-origin gate for every admin mutating action now depends on header-derived origin
resolution instead of the canonical anchor the peer commits intended to make authoritative.

**Suggested fix.** Change `getConfiguredBaseOrigin()` to mirror the other six call sites:
```ts
import siteConfig from '@/site-config.json';
function getConfiguredBaseOrigin() {
    const configured = process.env.BASE_URL?.trim() || siteConfig.url;
    return configured ? toOrigin(configured) : null;
}
```
Better: extract the `process.env.BASE_URL || siteConfig.url` formula into one exported helper
(e.g. `getEffectiveBaseUrl()` in `constants.ts` or a new tiny module) and have all seven sites
import it, so a future change to the fallback logic (e.g., trimming, validation) cannot silently
diverge again. Add a test asserting `request-origin.ts` resolves the same origin as
`constants.ts`'s `BASE_URL` when only `site-config.json` is configured.

**Confidence:** High — confirmed by direct code inspection of all seven call sites; the test gap
was confirmed by grepping `request-origin.test.ts` for `siteConfig`/`site-config` (no hits).
Likely, not yet observed in production (no incident evidence either way).

---

## C7-ARCH2 — `next.config.ts`'s `images.remotePatterns` for `IMAGE_BASE_URL` is frozen at Docker build time; changing the CDN origin without a rebuild silently breaks `next/image` sitewide while CSP/URL-generation report "fine"

`[SEV: MED | CONF: High | build-time-vs-runtime inlining trap]`

**Location:** `apps/web/next.config.ts:8-10,28,117-121`; `apps/web/Dockerfile:92-97`;
`apps/web/docker-compose.yml:7-9`

**Evidence.**
- `next.config.ts:28`: `const imageBaseUrl = parseImageBaseUrl(process.env.IMAGE_BASE_URL?.trim());`
  runs at **module top level**, i.e. once, when `next.config.ts` is loaded by `next build` (or
  `next dev`). `buildRemotePattern(imageBaseUrl)` (`next.config.ts:12-26`) feeds
  `images.remotePatterns` (`next.config.ts:120`).
- For `output: 'standalone'` (`next.config.ts:37`), Next.js does **not** re-evaluate
  `next.config.ts` at container runtime. It serializes the resolved `images` config into
  `.next/required-server-files.json` at build time, and the standalone `server.js` reads
  `images.remotePatterns` from that frozen JSON. I verified this directly against this repo's own
  build artifact:
  ```
  $ python3 -c "print(json.load(open('.next/required-server-files.json'))['config']['images']['remotePatterns'])"
  []
  ```
  (empty because that local build had no `IMAGE_BASE_URL` set at build time) — confirming
  `remotePatterns` is a build-time snapshot, not a runtime read.
- `Dockerfile:92-97` receives `IMAGE_BASE_URL` as a build `ARG`/`ENV` in the `builder` stage (used
  by `next build`), separately from `docker-compose.yml`'s `env_file: .env.local` (used for the
  **running container's** environment). These two only end up consistent because
  `docker-compose.yml:7-9`'s `build.args.IMAGE_BASE_URL: ${IMAGE_BASE_URL:-}` is interpolated from
  whatever `--env-file`/shell env is active when `docker compose build` runs, and both
  `deploy.sh` and the documented manual-smoke command invoke
  `docker compose --env-file apps/web/.env.local ... up -d --build` — i.e., today's *only*
  documented deploy paths happen to thread the same `.env.local` value into both the build ARG and
  the runtime env. Nothing enforces this pairing structurally; it's convention.
- Meanwhile `constants.ts:19`'s `IMAGE_BASE_URL` (used by `image-url.ts`'s `imageUrl()` /
  `<html data-image-base>` in `app/[locale]/layout.tsx:117`) and `content-security-policy.ts`'s
  `buildCspSafely` (used per-request by `proxy.ts`) **do** read `process.env.IMAGE_BASE_URL` fresh
  at runtime/process start — so if the *runtime* env value changes without a rebuild (e.g. an
  operator edits `.env.local` and runs `docker compose up -d` without `--build`, or just restarts
  the container), the CSP header and the generated `<img>`/`srcSet` URLs pick up the **new** CDN
  host immediately, while `images.remotePatterns` (used by every `next/image`/`<Image>` consumer:
  `masonry-card.tsx`'s `OptimisticImage` fallback path, `on-this-day-widget.tsx:66`,
  `search.tsx:88`, `similar-photos.tsx:234` — all confirmed NOT passing `unoptimized`, unlike
  `photo-viewer.tsx:488` which does) still enforces the **old** CDN host.

**Why this is a problem.** `CLAUDE.md`'s own environment-variable table documents `IMAGE_BASE_URL`
identically to every other "runtime-only, no rebuild needed" operational var (`QUEUE_CONCURRENCY`,
`TRUST_PROXY`, etc.), with no callout that it also has a build-time-frozen half — unlike
`site-config.json`, which gets an explicit `ARCH-03` note ("BUILD-TIME-INLINED... editing the
mounted file has NO runtime effect until the next image rebuild"). An operator who changes
`IMAGE_BASE_URL` (add/remove/rotate a CDN) and reasonably expects a lightweight `docker compose up
-d` (no `--build`) to suffice — consistent with how every other listed env var behaves — will get
CSP headers and generated URLs that correctly point at the new CDN host, but every `next/image`
request for that host will 400 ("Invalid src prop ... hostname ... is not configured under
images"). This is a confusing failure mode precisely because the *other* signal an operator would
check (CSP, which does update immediately) looks fine.

**Failure scenario.** Operator adds a CDN (`IMAGE_BASE_URL=https://cdn.example.com`) via
`.env.local` and, believing it's a plain runtime var like the dozen others in the table, restarts
the container instead of rebuilding. CSP `img-src` and generated `<img>`/`srcSet` URLs now point at
`cdn.example.com`. Every masonry-grid fallback thumbnail, search-result thumbnail, on-this-day
thumbnail, and similar-photos thumbnail — all routed through `next/image` — starts 400ing because
`remotePatterns` is still `[]` (or points at the previous CDN) from the last build. Nothing in the
app logs this as an `IMAGE_BASE_URL` problem; it surfaces as generic broken thumbnails.

**Suggested fix.** Minimum: add a `CLAUDE.md` / env-var-table callout parallel to `site-config.json`'s
`ARCH-03`, explicitly stating that `IMAGE_BASE_URL` changes require `docker compose ... --build`
(a full `npm run deploy`), not just a container restart, because of `next/image`'s
`remotePatterns`. Stronger: add a boot-time consistency check (e.g. in `instrumentation.ts` or a
lightweight runtime probe) that compares the running container's `process.env.IMAGE_BASE_URL`
against the origin(s) baked into `.next/required-server-files.json` (readable at runtime) and
`console.warn`s once if they disagree, giving the same fail-safe-with-a-log treatment
`buildCspSafely` already gives malformed values. Strongest: consider `unoptimized` for all
CDN-eligible `<Image>` consumers (matching `photo-viewer.tsx:488`'s existing choice) if CDN support
is meant to be a first-class, frequently-reconfigured deployment axis, removing the
`remotePatterns` build-time coupling entirely — but that trades away `next/image`'s optimization
for those surfaces.

**Confidence:** High for the mechanism (directly verified against `required-server-files.json` in
this repo, plus the Dockerfile/compose ARG threading); the "operator restarts without rebuilding"
scenario is a plausible-but-unobserved failure mode (needs-manual-validation for real-world
frequency — no incident evidence either way, and it does not fire under the *documented* deploy
path since that path always rebuilds).

---

## C7-ARCH3 — `content-security-policy.ts` is now a three-context shared module (Next config-loader / server runtime / client bundle) with no guard marking or enforcing that constraint

`[SEV: LOW-MED | CONF: Med-High | module boundary leak]`

**Location:** `apps/web/src/lib/content-security-policy.ts` (whole file); consumers:
`next.config.ts:4`, `constants.ts:6,19`, `image-url.ts:1,3,26-31`

**Evidence.** `05fa5cd1`'s own commit message records the design constraint that led to this
module's current shape: *"Next config loads the CSP module at typegen/build time, so the shared
sanitizer must be reachable from that config-safe module."* That constraint is real and was
honored — but it created a module with **three** simultaneous consumers, each with a different
bundling context:
1. `next.config.ts:4` imports `buildContentSecurityPolicy`/`parseCspImageBaseUrl` at Next
   config-load time (build/typegen — no Node built-ins beyond what Next's config loader itself
   permits).
2. `constants.ts:6` imports `sanitizeImageBaseUrlSafely` for a **server-only** module-scope
   constant.
3. `image-url.ts:3` imports the same `sanitizeImageBaseUrlSafely` and calls it from inside
   `resolveImageBase()`'s `typeof document !== 'undefined'` branch (`image-url.ts:26-31`) — i.e.,
   **in the browser**. I confirmed `image-url.ts` is transitively bundled into client code: it is
   imported by `search.tsx`, `masonry-card.tsx`, `photo-viewer.tsx`, and `similar-photos.tsx`, all
   of which declare `'use client'` at line 1.

Nothing in `content-security-policy.ts` documents or enforces that it must stay import-safe for
all three contexts simultaneously (no top-of-file comment, no lint boundary rule — I checked for
an `import/no-nodejs-modules`-style ESLint rule and found none configured — and no test that
imports the module in a simulated browser/jsdom environment to catch a future violation;
`content-security-policy.test.ts` only asserts CSP header content and two doc-string greps).

**Why this is a problem.** Today the module happens to be isomorphic-safe (only `URL`, `Set`,
regex, `process.env.NODE_ENV`/`process.env.IMAGE_BASE_URL` reads — all of which Next polyfills or
statically replaces acceptably in each context). But this is an emergent property of what the file
currently contains, not a designed-in invariant. A future contributor extending CSP logic (a very
plausible next step — e.g. reading a trusted-types config file, adding a `crypto`-based nonce
helper, or importing a DB-backed settings lookup for a dynamic CSP directive) has no signal that
doing so inside this file would (a) potentially break `next.config.ts`'s build/typegen load path,
and/or (b) bloat or break the client bundle for every `'use client'` masonry/search/photo-viewer
component that transitively imports it via `image-url.ts`. The failure would likely show up as an
opaque webpack "Module not found" or a client-bundle-size regression, far from the CSP-looking
change that caused it.

**Suggested fix.** Add an explicit boundary comment at the top of `content-security-policy.ts`
(e.g., "This module is imported by `next.config.ts` at build/typegen time AND bundled into client
code via `image-url.ts` — keep it dependency-free of Node built-ins and server-only APIs"). Add a
narrow regression test that `require`/`import`s the compiled module in a Node context with
`window`/`document` undefined (already implicitly covered) **and** grep-asserts the source contains
no `node:`-prefixed or other server-only imports, so a future addition trips a fixture instead of a
production build/bundle surprise. If CSP logic grows enough to need server-only capabilities,
split a `content-security-policy-shared.ts` (pure, isomorphic) from a
`content-security-policy-server.ts` (Node-only) rather than growing the current single file.

**Confidence:** Medium-High. The current safety is verified (no unsafe imports today); the risk is
about *future* drift, which by nature has no current failure to point to — flagging it as a
structural gap, not an active bug.

---

## C7-ARCH4 (minor) — `next.config.ts`'s `parseImageBaseUrl` is a second hand-maintained copy of `parseCspImageBaseUrl`'s default-parameter semantics

`[SEV: LOW | CONF: High | duplicated logic]`

**Location:** `next.config.ts:8-10` vs. `content-security-policy.ts:3`

```ts
// next.config.ts
export function parseImageBaseUrl(rawValue: string | undefined, environment: string = process.env.NODE_ENV || 'development'): URL | null {
  return parseCspImageBaseUrl(rawValue, environment);
}
```
```ts
// content-security-policy.ts
export function parseCspImageBaseUrl(rawValue: string | undefined, environment: string = process.env.NODE_ENV || 'development'): URL | null {
```

This wrapper exists only so `next-config.test.ts:5` can `import { parseImageBaseUrl } from
'../../next.config'` directly. It is a pure pass-through today, so risk is low, but the default
`environment = process.env.NODE_ENV || 'development'` expression is written twice. If
`parseCspImageBaseUrl`'s default-resolution logic ever changes (e.g., to also consider a
`VERCEL_ENV`-style signal), this wrapper's independently-specified default would not automatically
follow unless the author remembers to touch both signatures — TypeScript will not catch a
default-value semantic drift, only a type-shape change.

**Suggested fix.** Drop the default from the wrapper and forward the caller's `environment`
verbatim (or omit it) so there is exactly one place that decides the default:
```ts
export function parseImageBaseUrl(rawValue: string | undefined, environment?: string): URL | null {
  return parseCspImageBaseUrl(rawValue, environment);
}
```
Or delete the wrapper entirely and re-export `parseCspImageBaseUrl` under an alias for the test
import.

**Confidence:** High (mechanical duplication, low blast radius).

---

## Final sweep for commonly-missed issues

Confirmed reviewed and found nothing new beyond the above in:
- `apps/web/src/db/index.ts` (init-timeout `connection.destroy()` fix, `9cd8d3e8`) — sound, matches
  the same "unknown session state → destroy, don't release" pattern already used for the topic
  route-segment advisory lock.
- `apps/web/src/app/actions/topics.ts` (`withTopicRouteMutationLock`, `3acf638a`) — `RELEASE_LOCK`
  failure now destroys the pooled connection instead of releasing it with unknown lock state; a
  deliberate, well-reasoned, narrow correctness-over-availability trade-off (explicit
  "Rejected: release the connection after a failed unlock" in the commit message). Pool
  self-heals by creating a replacement connection on demand; not a resource-exhaustion risk under
  normal (non-flapping) MySQL connectivity.
- `apps/web/src/app/actions/auth.ts` (`logout`, `3acf638a`) — correctly sequences
  `hasTrustedSameOrigin` → restore-maintenance marker check → `acquireAdminMutationSlot()` →
  session verify/delete, matching the documented barrier contract in
  `admin-mutation-barrier.ts`; cookie deletion is unconditional so logout always succeeds
  client-side even if the DB-side session row is skipped during a restore drain window (deliberate,
  not a bug).
- `apps/web/src/lib/request-origin.ts`'s Host-vs-X-Forwarded-Host reordering (`d8fcb3d6`) — this is
  squarely a security-lane concern (spoofability of the fallback path itself); I did not
  re-litigate it beyond noting its interaction with C7-ARCH1 above, since `.context/reviews/security-reviewer.md`
  is peer-owned territory for this cycle.
- `package.json` `overrides` additions for `next`/`@esbuild-kit/core-utils` (`57e2c5d3`, to make
  `npm audit` green) — INFO-level only: overrides are a legitimate mechanism but are a
  convention-enforced invariant themselves (nothing prevents a stale override from masking a
  real, still-reachable vulnerability if the pinned version drifts from what actually fixes the
  advisory). Not elevated to a full finding here since the commit's own `Tested:` line shows
  `npm audit --audit-level=moderate` was run and passed; flagging only as a thing worth
  periodic re-verification, not a new architectural defect.
- Checked for, and did not find, any other newly-introduced advisory lock, process-local Map/Set,
  or single-writer assumption in this cycle's diff beyond what `CLAUDE.md` already documents.
- Did not find a second/duplicated "supported locales" or "image sizes" list newly introduced this
  cycle (the classic duplicated-list pattern) — `LOCALES` in `constants.ts` remains the sole
  source consumed by `sitemap.ts`, middleware, and layout.
- Cross-checked C7-ARCH1/2 against the existing deferred registers (`C2-37res`, `C4-25`, `C1-13`,
  `C3-08op`) — all are about different sub-problems (runtime `IMAGE_BASE_URL` boot validation,
  SW cross-origin caching, `TRUST_PROXY` boot-time detection, nginx zone operator-apply) and do not
  cover the `siteConfig.url`-fallback divergence or the build-time `remotePatterns` freeze reported
  here as new.
