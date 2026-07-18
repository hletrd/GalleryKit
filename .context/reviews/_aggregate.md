# Cycle 2 Aggregate Review

Date: 2026-07-18 KST
Start HEAD: `ba4bc60a`

## Agent coverage

Completed provenance reviews: code-reviewer, perf-reviewer, security-reviewer,
critic, verifier, test-engineer, tracer, architect, debugger,
document-specialist, and designer. The designer used the complete applicable
agent-browser skill set and reproduced public UI behavior at desktop, 393 px,
and 320 px widths. No reviewer failed.

The environment exposed two worker slots rather than eleven named reviewer
profiles, so all required perspectives were distributed across both concurrent
workers and each produced its own provenance file. Both workers inventoried the
complete repository before specialist review and completed a final missed-issue
sweep.

## New deduplicated findings

### C2-01 — A DB-less build caches the incomplete sitemap for one hour

- Severity/Confidence: **Medium / High**
- Agreement: code-reviewer, architect, critic, verifier, test-engineer,
  document-specialist
- Regions: `apps/web/src/app/sitemap.ts:4-12,36-82`;
  `apps/web/src/__tests__/sitemap-robots.test.ts:28-107`; generated
  `.next/prerender-manifest.json`
- Failure: the production build intentionally has no MySQL connection, catches
  that failure, and prerenders fallback sitemap rows. Next then records the
  fallback as fresh for 3,600 seconds, so the comment claiming the first runtime
  request replaces it is false and crawlers can miss topic/photo URLs for the
  first hour after every deploy.
- Disposition: schedule this cycle; move authoritative sitemap generation to
  runtime and add a regression that prevents a DB-less fallback from becoming a
  fresh one-hour build artifact.

### C2-02 — The desktop LCP change eagerly downloads five cards on mobile

- Severity/Confidence: **Medium / High**
- Agreement: perf-reviewer, tracer, debugger, designer
- Regions: `apps/web/src/components/home-client.tsx:26-32,94-108,299-309`;
  `apps/web/src/components/masonry-card.tsx:81-145`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:190-195`
- Failure: the unmeasured SSR state marks five cards eager for desktop, but the
  browser starts those requests before hydration can discover the one-column
  mobile viewport. A clean 320 px production session started all five 640 px
  AVIF requests at 62 ms (about 409 KiB total, about 351 KiB below the first
  visible card), even though hydration later rewrote cards 2-5 to lazy.
- Disposition: schedule this cycle; restore a mobile-safe SSR eager policy and
  use a browser-evaluated responsive priority mechanism for additional desktop
  first-row images, with request-timeline coverage rather than final-DOM-only
  assertions.

### C2-03 — Search reports an expanded combobox when no listbox exists

- Severity/Confidence: **Medium / High**
- Agreement: designer; independently reproduced with live DOM/accessibility
  evidence
- Regions: `apps/web/src/components/search.tsx:402-453,493-520`;
  `apps/web/src/__tests__/search-status-source.test.ts:29-40`
- Failure: `aria-expanded={isOpen}` describes the containing modal, not the
  combobox popup. Empty and settled no-result searches expose no listbox or
  `aria-controls`, but the input still announces itself expanded, sending a
  screen-reader user toward list navigation that cannot exist.
- Disposition: schedule this cycle; tie the combobox expansion state exactly to
  listbox presence and cover empty, loading, no-result, and result states.

### C2-04 — Semantic-search docs imply repeated backfills broaden old-photo recall

- Severity/Confidence: **Medium / High**
- Agreement: document-specialist
- Regions: `README.md:50`; `apps/web/README.md:68-76`;
  `apps/web/src/app/api/search/semantic/route.ts:263-279`;
  `apps/web/scripts/backfill-clip-embeddings.ts:165-228`
- Failure: once every row already has the active model version, repeating the
  backfill neither rotates nor broadens the newest-`updated_at` subset selected
  by the request-time scan. An operator can spend repeated inference runs while
  older photos remain outside `SEMANTIC_SCAN_LIMIT`.
- Disposition: schedule this cycle; distinguish repeated runs that finish a
  missing-embedding backlog from request-time recall, which requires increasing
  the bounded scan limit or introducing an index.

## Cross-agent disagreement resolved

Several provenance reviews labeled the repository-owner env-file exception in
`scripts/deploy-remote.sh` and `apps/web/deploy.sh` as a new privilege boundary.
The security review rejected that hypothesis: the inferred repository owner can
already replace or edit the same checkout-owned shell script a privileged caller
is executing, so accepting that owner's private env file does not grant an
additional capability. The aggregate therefore does **not** carry this forward
as a security/correctness finding. Documentation must describe the owner as
implicitly trusted by checkout execution rather than “explicitly configured”;
that wording cleanup is included with C2-04 documentation work. A future helper
installed in a root-owned immutable location would create a different trust
boundary and must require an explicit principal.

## Revalidated carry-forward findings

The following are not newly discovered and retain their original
severity/confidence, reasons, and exit criteria in
`.context/plans/deferred-carry-forward.md`: shared queue/backfill DB-budget
oversubscription; warn-only single-writer enforcement; failed-health deploy
rollback/cleanup; 10,000-row map rendering; repeated semantic vector scans;
SQL-restore/file-store generation mismatch; and the remaining previously
registered architecture/operational risks. No carry-forward item was
downgraded or silently dropped.

## Baseline evidence and final aggregation sweep

Reviewers reported green ESLint, API-auth/action-origin/public-route scanners,
typecheck, production build, 3,408 unit tests, and production dependency audit.
Browser E2E, real CLIP preflight, and proxy-topology probing remained
environment-dependent baseline limitations; PROMPT 3 must run every configured
gate after implementation, including browser E2E because browser behavior is
being changed.

The final aggregation sweep merged duplicate sitemap and mobile-request
findings at the highest severity/confidence, challenged the disputed deploy
finding against the actual trust principal, reconciled documentation claims
with request-time selection code, and confirmed that every provenance finding
is either scheduled above, explicitly resolved as a rejected hypothesis, or
mapped to the existing deferred register.
