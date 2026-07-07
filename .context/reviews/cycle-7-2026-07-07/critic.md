# Cycle 7 Critic Review — System-level / multi-perspective

Reviewer angle: step back from line-level correctness and critique the whole system as an
operator, end-user photographer, maintainer, and attacker would. Focus: silent-failure modes,
misleading abstractions, invariants that depend on human discipline instead of compile/test
enforcement, coupling that will bite future maintainers, and CLAUDE.md-vs-code drift.

Baseline reviewed: committed HEAD `14d31ea4`. Peer-dirty files at review time (`sitemap.ts`,
`cycle12-ops-contracts.test.ts`, `sitemap-robots.test.ts`, `settings-client.tsx`,
`check-proxy-topology.mjs`) were read via `git show HEAD:<path>` only; their live/dirty content is
peer in-flight work and is out of scope here.

## Pre-commitment predictions (before deep-dive)

1. `14d31ea4` ("surface discovery") would expose a new nav/footer destination without fully wiring
   its SEO/sitemap counterpart — half-finished discoverability.
2. `d8fcb3d6`/`57e2c5d3` (origin-check hardening, two passes in a row) would leave an asymmetry
   between how Host and Proto are trusted, or a residual bypass.
3. `9cd8d3e8` (DB timeout hardening) would have a connection-pool edge case where a "fixed" path
   still returns a possibly-poisoned connection to the pool under some sub-case.
4. `3acf638a` ("mutation lock cleanup") touching `logout()` would trade one invariant (never lose a
   session on crash) for a different silent gap (a mutation the user believes succeeded but didn't).
5. `05fa5cd1` (env-var sanitization) would introduce a validate-then-silently-degrade path with no
   corresponding operator-visible signal — a classic "config drift nobody notices" bug.

Outcome: (1), (4), (5) confirmed with concrete evidence below. (2) checked out clean — the two
commits are consistent with each other and with the deployment's TLS-termination topology (no
authoritative "Host-equivalent" signal exists for protocol in this topology, so the Proto/Host
asymmetry is inherent, not a regression). (3) checked out clean — every call site of
`armDbChildProcessWatchdog`'s returned cleanup function is already guarded by a `settled` flag, so
the reordering is safe (see Minor findings for a residual clarity nit). A genuinely new class of
finding also emerged that wasn't predicted: a touch-target regression invisible to the project's
own regex-based enforcement test (see C7-CRIT3).

## Findings

### C7-CRIT1 — `IMAGE_BASE_URL` misconfiguration silently disables the CDN app-wide, with zero diagnostics
`[SEV: MEDIUM | CONF: High | operability / silent-failure]`

- `apps/web/src/lib/constants.ts:19` — `export const IMAGE_BASE_URL = sanitizeImageBaseUrlSafely(process.env.IMAGE_BASE_URL);`
- `apps/web/src/lib/content-security-policy.ts:40-46` — `sanitizeImageBaseUrlSafely` catches
  `parseCspImageBaseUrl`'s validation throws (malformed URL, non-http(s) protocol, http in
  production, or credentials/query/hash present — lines 3-29) and returns `''` with **no log call
  of any kind**.
- `apps/web/src/lib/image-url.ts:26-31` — every single image URL in the app (masonry grid,
  lightbox, search results, map popups, viewer preloads, srcSet generation, OG/JSON-LD absolute
  URLs) resolves through `resolveImageBase()` → this same silently-degrading value, both server-side
  (`IMAGE_BASE_URL` module constant, computed once at process start) and client-side (`document
  .documentElement.dataset.imageBase`, re-parsed on every call via the same silent-catch wrapper).

Compare this to the sibling introduced in the *same commit* (05fa5cd1) for the CSP header path:
`buildCspSafely` (`content-security-policy.ts:59-73`) explicitly does
`console.error('[content-security-policy] failed to build CSP (likely a malformed
IMAGE_BASE_URL); falling back without the image base URL:', error)` once per process on the exact
same class of failure. The higher-traffic, functionally-significant path (actual image URL
generation, used on every page render) got none of that.

**Concrete failure scenario:** an operator sets `IMAGE_BASE_URL=https://user:pass@cdn.example.com`
(copy-paste error with embedded creds), or forgets `https://` and types a bare `http://` value while
`NODE_ENV=production`, or appends a `?` query string. `parseCspImageBaseUrl` throws in all three
cases. `sanitizeImageBaseUrlSafely` swallows the throw. The app boots fine, serves correctly (same
origin instead of the CDN), and NOTHING in logs, health checks, or the admin UI indicates the CDN
knob is being ignored. The operator only discovers this by noticing image requests aren't hitting
their CDN (e.g., unexpected origin bandwidth/cost, or absence in CDN access logs) — there is no
startup assertion (unlike `DB_SSL_CA`, which deliberately `throw`s at module load in
`apps/web/src/db/index.ts:16` for an analogous "non-local, unsafe config" situation — a striking
asymmetry: the same *class* of config-validation problem is fail-loud-and-crash for `DB_SSL_CA` but
fail-silent-and-degrade for `IMAGE_BASE_URL`, introduced in the exact same commit).

Confirmed no other log/validation path exists: `grep -rn "IMAGE_BASE_URL" apps/web/src` shows no
hit in `instrumentation.ts` or any startup validation; `CLAUDE.md`'s own env-var table describes
`IMAGE_BASE_URL` as "must be absolute HTTPS without credentials" implying enforcement, but doesn't
mention (and the code doesn't implement) any operator-visible signal when that's violated.

- Fix: add a once-per-process `console.error`/`console.warn` inside `sanitizeImageBaseUrlSafely` (or
  at the `constants.ts` call site) mirroring `buildCspSafely`'s pattern, so a misconfigured
  `IMAGE_BASE_URL` is at least discoverable in `docker logs`/journald instead of silently no-op'ing.

### C7-CRIT2 — Logout during a restore-maintenance window clears the cookie but silently fails to invalidate the server-side session
`[SEV: MEDIUM | CONF: High | security / silent-failure]`

- `apps/web/src/app/actions/auth.ts:279-295` (landed by `3acf638a`):
```
if (token) {
    const maintenanceError = getRestoreMaintenanceMessage('restore in progress');
    if (!maintenanceError) {
        using mutationSlot = acquireAdminMutationSlot();
        if (mutationSlot.acquired) {
            const session = await verifySessionToken(token);
            if (session) { logAuditEvent(...) }
            await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
        }
    }
}
cookieStore.delete({ name: COOKIE_NAME, path: '/' });
redirect(localizePath(locale, '/admin'));
```
`acquireAdminMutationSlot()` only fails to acquire (`acquired: false`) while
`state.exclusiveActive` is true, which per `admin-mutation-barrier.ts:78,106` is set *exclusively*
by an in-progress DB restore (`drainAdminMutationsForRestore`) — so this degraded branch fires
specifically, and only, during a restore-maintenance window. Under normal operation
`mutationSlot.acquired` is always true, so this is not a general regression; it's scoped.

The cookie deletion and redirect happen **unconditionally**, regardless of whether the
`maintenanceError`/`mutationSlot.acquired` gate skipped the DB delete. There is no `else` branch, no
log line, and no different UX for "logout fully succeeded" vs. "logout only cleared the local
cookie, the session row is still live in `sessions`." Both render as an identical redirect to
`/admin`.

**Concrete failure scenario:** an admin's session cookie has already been exfiltrated (XSS, stolen
laptop, shared browser history) before they realize it and click "Log out" — precisely the moment a
user expects logout to be a hard security boundary. If a restore happens to be in progress at that
moment, the browser's cookie is cleared (so the legitimate user believes they are safely logged out
and has no reason to retry) but the DB `sessions` row is never deleted and no audit event is logged.
The stolen token remains valid for up to the full 24h `maxAge` (`auth.ts:244`) or until the restore
window ends and the row happens to expire via the hourly maintenance sweep — whichever is longer.
Contrast with every other mutating admin action, which explicitly returns `{ error:
t('restoreInProgress') }` so the caller knows the action didn't happen; logout is the one action
that fakes success.

- Fix: when `maintenanceError` is set or `mutationSlot.acquired` is false, still clear the local
  cookie (reasonable — don't trap the browser in a "looks logged in" state during maintenance), but
  emit a `console.warn`/audit-adjacent log noting "session <hash-prefix> not server-invalidated:
  restore in progress" so this is at least observable, and consider surfacing a toast/banner on the
  next admin page load ("your last logout could not fully invalidate your session; it will expire
  naturally in ≤24h") instead of a silently identical redirect.

### C7-CRIT3 — Collapsed search trigger is ~40px wide (not 44px) when production semantic search is enabled, below the project's own touch-target policy, and invisible to the enforcing test
`[SEV: MEDIUM | CONF: High | accessibility, freshly-landed 14d31ea4]`

- `apps/web/src/components/search.tsx:371-389`:
```
const showSearchLabel = semanticSearchMode === 'production';
return (
    <Button ... size={showSearchLabel ? 'default' : 'icon'}
        className={showSearchLabel ? "h-11 gap-2 px-3" : "h-11 w-11"}>
        <SearchIcon className="h-4 w-4" />
        {showSearchLabel && <span className="hidden lg:inline">{t('aria.searchPhotos')}</span>}
    </Button>
);
```
- `apps/web/src/components/ui/button.tsx:23-24` — `size: default` resolves to `"min-h-11 px-4 py-2
  has-[>svg]:px-3"` — **no width utility at all**; width is whatever the content + padding produces.

When `showSearchLabel` is true (production semantic search mode — the case this exact commit was
written to make more discoverable) **and** the viewport is below Tailwind's `lg` breakpoint
(1024px — i.e. virtually every phone and most tablets), the `<span>` carries `hidden lg:inline` and
is `display: none`, contributing zero width and no `gap-2` spacing. The rendered button is then just
the 16px icon (`h-4 w-4`) plus 24px of horizontal padding (`px-3` = 12px × 2, whether from the
custom className or the `has-[>svg]:px-3` variant — both agree at 12px) = **~40px wide**, against a
fixed 44px height. This is below the project's own documented and enforced "Policy: 44×44 px
minimum" (CLAUDE.md "Touch-Target Audit" section; `apps/web/src/__tests__/touch-target-audit.test.ts`).

This ships clean through the enforcing test because that test is a **source-regex scanner**
(`FORBIDDEN` pattern array matching literal Tailwind class tokens like `h-8`, `min-h-[Npx]`,
`w-1..10`), not a rendered-box-model check. There is no `w-`/`min-w-` class present to match against
— the violation is an *absence* of a width guarantee, not a present-but-small one, which is exactly
the blind spot a blacklist-style static scanner cannot see. `grep -n "search.tsx"
apps/web/src/__tests__/touch-target-audit.test.ts` returns no `KNOWN_VIOLATIONS` entry — this is not
a documented, accepted exception; it's an untracked regression.

**Failure scenario:** a photographer on a phone, with production semantic search enabled by the
operator, taps the search icon in the nav. The tappable area is ~40×44px instead of the 44×44px the
rest of the nav (theme toggle, locale toggle, adjacent icon buttons) maintains — a small but real,
inconsistent-with-its-neighbors regression for exactly the touch-first surface this commit's stated
goal was to make *more* prominent. This meets WCAG 2.2 AA's 24px floor but violates the project's own
self-imposed AAA-grade 44px policy and the code comment directly above the button ("44x44
touch-target floor").

- Fix: add an explicit width guarantee for the `showSearchLabel` branch, e.g.
  `className={showSearchLabel ? "h-11 min-w-11 gap-2 px-3" : "h-11 w-11"}`, and add a
  `KNOWN_VIOLATIONS`-style regression test (or extend the touch-target audit to check the
  `size="default"` + hidden-label pattern) so a similar icon+conditionally-hidden-label combination
  elsewhere doesn't reintroduce the same blind spot.

### C7-LOW1 — Sitemap only adds `/timeline`, not `/map`, despite the commit's stated "surface discovery" goal
`[SEV: LOW | CONF: High | SEO / documentation-vs-code mismatch, freshly-landed 14d31ea4]`

- Commit `14d31ea4`'s own footer change (`apps/web/src/components/footer.tsx`, diff) adds BOTH a
  `/timeline` and a `/map` nav link, and the commit message states "Expose public Timeline and Map
  navigation." But `apps/web/src/app/sitemap.ts` at this commit only adds a `staticPublicEntries`
  block for `/timeline` (`LOCALES.map(... '/timeline' ...)`) and bumps `reservedNonImageUrls` from
  `(1 + topics.length)` to `(2 + topics.length)` — one new static page, not two. `/map` is
  discoverable via nav/footer links but absent from `sitemap.xml`, so search engines that rely on
  sitemap-first discovery (rather than crawling the footer) may never index it.
- Note: at the time of this review, `apps/web/src/app/sitemap.ts` is a peer-dirty file in this
  shared worktree and its current uncommitted content already generalizes to a
  `STATIC_PUBLIC_PATHS = ['/timeline', '/map', '/privacy', '/about-gallerykit']` array that fixes
  exactly this gap — flagging for completeness against the committed HEAD baseline this review is
  scoped to, not as an action item likely to still be open by the time this review lands.

## Minor / informational

- **`armDbChildProcessWatchdog` cleanup guard is currently unreachable dead code**
  (`apps/web/src/app/[locale]/admin/db-actions.ts:44-82`, touched by `9cd8d3e8`). The change from
  unconditional `markSettled()` to `if (!fired) markSettled()` in the returned cleanup function only
  matters if some caller invokes the cleanup function after the watchdog has already fired. Traced
  all three call sites (`exportImagesCsv` backup path line ~243, restore path line ~818, post-restore
  migration line ~929): every one guards `clearWatchdog()`/`clearRestoreWatchdog()` behind `if
  (settled) return; settled = true;`, and `onTimeout` itself sets `settled = true` synchronously
  before any close/exit handler can run. So today, `cleanup()` is never called once `fired = true`,
  and the `if (!fired)` guard has no observable effect at any existing call site. Not a bug — but a
  future maintainer reading `cycle-20-source-contracts.test.ts`'s assertion
  (`expect(watchdog).toContain('if (!fired) markSettled()')`) could reasonably assume this guards a
  live scenario; it currently guards against a scenario that doesn't exist in the codebase's actual
  call sites. Worth a one-line comment noting this is defensive/future-proofing, not currently live,
  so nobody "fixes" a caller into breaking the invariant this exists for.
- **`GA_CONNECT_SOURCES` gains `https://www.google.com`** (`content-security-policy.ts:104`,
  `9cd8d3e8`) — checked against `.context/plans/cycle-13-2026-07-07-plan.md:133-135`, which
  explicitly plans and tests this exact host for the observed `www.google.com/g/collect` GA4
  beacon endpoint while excluding ad hosts (doubleclick/googlesyndication tested absent). Verified
  deliberate and covered — not a new finding.
- **Client-side `resolveImageBase()` re-parses/validates the stamped `data-image-base` attribute on
  every `imageUrl()` call** (`image-url.ts:26-31`), not memoized — a masonry grid page can call this
  dozens of times per render. Purely a performance nit (perf-reviewer's lane), noted only because it
  compounds with C7-CRIT1 (repeated parsing of a value that, if malformed, is being silently
  discarded on every single call with no cache of the "already know this is broken" fact).

## Final sweep for commonly-missed issues

Explicitly reviewed all 7 named peer commits end-to-end (full diffs, not just stat): `14d31ea4`,
`9cd8d3e8`, `d8fcb3d6`, `57e2c5d3`, `4d37daa4`, `05fa5cd1`, `3acf638a`. For each touched
non-test file I read the surrounding function/module in full (not just the diff hunk) to check
callers and invariants: `request-origin.ts` (+ both origin-hardening commits together, since they
touch the same function across two commits), `db/index.ts`, `db-actions.ts` (watchdog + both restore
paths), `admin-mutation-barrier.ts`, `auth.ts` logout, `topics.ts` lock-cleanup, `content-security-
policy.ts` (both the CSP builder and the new sanitizer), `constants.ts`, `image-url.ts`,
`drizzle.config.ts`, `nav-client.tsx`, `search.tsx`, `footer.tsx`, `sitemap.ts` (at HEAD),
`info-bottom-sheet.tsx`, `photo-viewer.tsx`, `similar-photos.tsx` (semanticSearchMode gating),
`topic-manager.tsx`, `tag-manager.tsx`, `photo-navigation.tsx`, plus the associated messages/en.json
and ko.json changes and every new/changed test file in these commits. Cross-checked
`.context/plans/deferred-carry-forward.md` and the per-cycle deferred registers (grep for
"logout", "IMAGE_BASE_URL"/"www.google.com", "RELEASE_LOCK") to confirm C7-CRIT1/2/3 are not
re-reports of already-known/deferred items — no hits found for any of them. Confirmed via `git
status`/`git diff HEAD` which files are peer-dirty in this shared worktree
(`sitemap.ts`, `cycle12-ops-contracts.test.ts`, `sitemap-robots.test.ts`, `settings-client.tsx`,
`check-proxy-topology.mjs`, plus two new untracked plan files) and excluded their live content from
scoring — all four scored findings above are against clean, non-peer-touched files at committed
HEAD. Did not re-litigate the `d8fcb3d6`/`57e2c5d3` origin-check logic beyond confirming it's sound
(see pre-commitment notes) since two back-to-back hardening passes on the same function had already
had fresh scrutiny; did not deep-dive `settings-client.tsx` (peer's active WIP, out of scope).
