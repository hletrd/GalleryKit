# Verifier Review — Cycle 1 Group B

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`
Role: verifier

## Inventory and verification approach

I read `AGENTS.md` and `CLAUDE.md`, enumerated all 635 files under
`apps/web/src`, and inspected the supporting scripts, migrations, deployment
files, package graph, translation changes, and current test/review history. I
verified comments and tests against executable control flow, with special focus
on the latest i18n/nav and GeoIP changes plus auth, lifecycle, public projection,
and deployment invariants.

## Findings

### VER-C1-01 — Account-rate-limit fallback claim is false on the first DB increment error

- Severity: **High**
- Confidence: **High**
- Status: Reproduced by control-flow proof
- Regions: `apps/web/src/app/actions/auth.ts:125-175`,
  `apps/web/src/lib/auth-rate-limit.ts:13-19,36-44,86-99`
- Inadequate test: `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:118-130`

Claim under verification: the account-scoped map “remains the fast-path fallback
when the DB rate-limit table is unavailable” (`auth-rate-limit.ts:13-18`).

Control-flow proof: `accountLimitData` is read at `auth.ts:129-130`, but it is
not incremented/stored until lines 146-149. Line 144 awaits the IP durable
increment first. A rejection at line 144 jumps to line 150, so neither lines
146-149 nor any other account-map update runs. Both DB checks then reject and
the fallback branch compares the unchanged account count at line 172. The
documented account fallback is therefore absent for that attempt.

Suggested fix and verification: synchronously increment/set both maps before
any durable await; inject a first-call rejection in a behavioral login test and
assert the account map advances. Repeat across different mocked IPs until the
account budget rejects the shared username.

### VER-C1-02 — Similar Photos violates its own mounted-component guard in Strict Mode

- Severity: **Medium**
- Confidence: **High**
- Status: Reproduced by React effect lifecycle proof
- Regions: `apps/web/src/components/similar-photos.tsx:68-79,104-134`
- Counterexample pattern: `apps/web/src/components/load-more.tsx:154-159`
- Inadequate test: `apps/web/src/__tests__/similar-photos-abort-source.test.ts:19-27`

Claim under verification: `mountedRef.current` prevents late fetch state updates
after unmount while allowing live requests to finish.

In a development Strict Effects mount, the component's effect is set up, its
cleanup runs and sets the ref false, then the effect is set up again. The second
setup does not set the ref true. A live request therefore fails the first term
of `isCurrentOpenRequest()` and the `finally` condition, so neither results nor
loading completion can commit. `LoadMore` shows the correct symmetric setup at
`load-more.tsx:154-159`.

Suggested fix and verification: reset the ref in setup and render the component
inside `<StrictMode>` in a behavioral test; expand, resolve a successful mocked
fetch, and assert results appear and loading clears. Then unmount during a
pending fetch and assert no late commit.

### VER-C1-03 — Navigation-setting copy does not describe verified consumers

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed documentation/UI contract mismatch
- Regions: `apps/web/messages/en.json:790-792`,
  `apps/web/messages/ko.json:790-792`,
  `apps/web/src/components/nav-client.tsx:47-48`,
  `apps/web/src/components/footer.tsx:47-56`,
  `apps/web/src/app/sitemap.ts:28-33`
- Behavioral proof: `apps/web/src/__tests__/sitemap-robots.test.ts:77-92`

The UI says “nav-bar links,” while code and a direct behavioral test prove the
same values remove footer and sitemap entries. Direct routes remain enabled.
This is not just terse wording: the copy obscures an SEO/discovery side effect
and can imply access control that does not exist.

Suggested fix and verification: decide whether sitemap removal is intended,
then align both locale strings and tests with that decision. Verify all four
states (each toggle independently true/false) across nav, footer, sitemap, and
direct route reachability.

### VER-C1-04 — Initial masonry priority does not satisfy the documented 2xl guarantee

- Severity: **Low-Medium**
- Confidence: **High**
- Status: Confirmed pre-effect state mismatch
- Regions: `apps/web/src/components/home-client.tsx:26-76,124-126`

The comments say the fifth 2xl first-row slot gets eager/high priority, but
`count` is initially 2 and can become 5 only in a client effect. The guarantee
is true after mount, not for the initial loading decision where it matters.

Suggested fix and verification: record a cold-cache 2xl trace and assert when
requests for cards 3-5 begin relative to hydration. Adopt an initial priority
policy based on the measurement and lock the pre-effect semantics in a test.

## Claims verified as true

- The latest GeoIP fix is complete across dependency declaration,
  `serverExternalPackages`, Docker production dependency copy, runtime require,
  and instrumentation prewarm. The `XX` fallback remains graceful.
- The latest English/Korean prose edits preserve message-key parity and retain
  the material restore, HDR/SDR, GPS, analytics/IP, PAT-expiry, semantic-search,
  and force-reencode warnings.
- Public data projections still omit privacy-sensitive fields except for the
  explicit map-visible GPS projection.
- Similar Photos callers key the component by image ID in both desktop sidebar
  and bottom sheet, so cross-photo stale results are not a current defect.
- Admin routes/actions retain origin/auth gates, and public expensive routes
  retain pre-increment rate-limit calls.
- Upload and restore paths retain their maintenance, advisory-lock, cleanup,
  and post-commit response distinctions.

## Final missed-issue sweep

I checked for counterexamples to the above findings, including React caller
keys, DB retry behavior, source-test coverage, sitemap intent, recent commit
diffs, and deployment ownership checks. I also swept stale comments, impossible
branches, missing runtime pins, schema/journal mismatch indicators, and privacy
field drift. No further high-confidence mismatch was found. Existing deferred
items remain accurately represented by the current aggregate and plan ledger.
