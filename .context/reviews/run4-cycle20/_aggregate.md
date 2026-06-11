# Aggregate review — Run-4 Cycle 20

Per-angle provenance files in this directory:
- `security-reviewer-critic-verifier.md`
- `code-reviewer-debugger-tracer.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c19). Each angle was executed as a
distinct full-inventory in-context pass; no angle sampled. Inventory:
line-level regression review of the six cycle-19 fix commits
(`2881e32f`, `962931f1`, `66871cb5`, `a61cfb45`, `046d7cb3`, `5ae58a7a`);
rotation by mention-count map into the **admin-controlled URL / redirect /
same-origin validation cluster** (seo-og-url, seo action, og/photo route,
3 public og:image consumers, request-origin, locale-path, og-photo-fetch);
plus a clean-pass sweep of the client-safe leaf utilities
(backup-filename, download-filename, exif-datetime, tag-slugs/records,
base56, bounded-map, clipboard, safe-json-ld, analytics-data).

## Context

C19 closed the topics tuple-unwrap production regression and the backfill
keyset/gate cluster. C20's rotation into the URL-validation cluster
surfaced a clean backslash bypass of the `seo_og_image_url` same-origin
validator — a defense-in-depth control whose entire stated purpose is to
block off-site OG URLs, with a one-character bypass that turns the
`/api/og/photo/*` fallback into an open redirect.

## Cross-angle agreement

- **SEC-R4C20-01** — security/critic/verifier (primary: validator branch
  reproduced, two consumers traced, counter-hypothesis ruled out), code/
  debugger/tracer (single-chokepoint fix placement), test-engineer
  (suite blind-spot TEST-R4C20-02), document-specialist (comment
  over-promises behavior), designer (link-preview brand-integrity
  context). **5/6 angles** — perf concurs it needs no perf/layering
  change.
- **TEST-R4C20-02** — test-engineer (primary), security (the missing case
  is exactly the bypass). **2/6.**

## Merged finding list

| ID | Sev/Conf | Title | Source angles | Disposition |
|----|----------|-------|---------------|-------------|
| SEC-R4C20-01 | **MED-LOW/High (CONFIRMED)** | `validateSeoOgImageUrl` (seo-og-url.ts:9-11) accepts any single-leading-slash value as "relative", so `/\evil.com` passes the same-origin gate; browsers/crawlers normalize `\`→`/` so it resolves to `https://evil.com/`. Live impact: (1) every public page's `<meta og:image>` advertises an off-site image; (2) `og/photo/[id]/route.tsx:255` copies the value into a 302 `Location` → open redirect. Fix: reject backslash in the relative branch (the only char that survives upstream control-strip AND re-normalizes to `/`). | 5/6 | SCHEDULE |
| TEST-R4C20-02 | MED/High | `seo-actions.test.ts:5-19` covers `//evil` but not the backslash variant — the suite green-lights the broken validator (same blind-spot-mirrors-code pattern as COR-R4C19-01). Add `/\evil.com`, `/\/evil.com`, `/\\evil.com` reject cases + a legit-path pass case, proven failing pre-fix. | test, security | SCHEDULE (same file pairing as SEC-R4C20-01) |
| DES-R4C20-01 | adjudication | Off-site OG image is a link-preview brand-integrity harm — severity context for SEC-R4C20-01; root-cause fix resolves it. No separate UI fix. | designer | RECORD |

## Regression review of cycle-19 commits — SOUND

All six fix commits verified line-level against the live tree: the two
tuple-unwrap sites use the identical house idiom; keyset cursor advance is
guarded by the empty-batch break; migrate-titles refusal is additive;
star-re-export gate fails closed; topic e2e is self-cleaning. No
follow-on findings.

## Clean-pass surfaces this cycle

Full lists in the per-angle files. Highlights: `hasTrustedSameOrigin`
family (fail-closed default, proxy-aware right-most selection only under
TRUST_PROXY, symmetric default-port stripping), `og-photo-fetch` internal
fetch (own-origin + DB-sourced filename + 10 s/1 MB caps, no arbitrary-host
SSRF), `locale-path` redirect builders (internal literal paths only),
`base56` rejection sampling (no modulo bias), `bounded-map` prune (no
iterator-invalidation), `analytics-data` alias ORDER BY (valid MySQL + bot
exclusion), `download-filename` slug sanitizer (NFKD + format-char strip +
60-cap), `exif-datetime` strict UTC round-trip.

## Standing deferrals re-audit (exit criteria)

Diff since the c19 review commit (`625898fd..HEAD` — c19 fix surfaces +
plan/SW stamps + the c19 deploy record) touches no deferral surface; no
exit criterion fires:
- OBS-R4C19-A (seed-admin `$$argon2` normalization), DEF-R4C19-B
  (extractRows seam) — un-triggered (no functional seed-admin edit; no NEW
  raw `db.execute` consumer introduced this cycle); carried (plan-310).
- DEF-R4C18-A/B; DEF-R4C17-A/B; DEF-R4C16-A/B; DEF-R4C15-A/B;
  RISK-R4C14-03 + TEST-R4C14-02; DEF-R4C11-A; DEF-R4C10-A/B;
  DEF-R4C1-01/02-01/03-01 (LR PAT); OPS-R4C6-01 (host nginx);
  DEF-R4C8-A/B/C/D; histogram mode-cycle aria-label (incl. NOTE-R4C18-D1);
  OBS-R4C12-B/C/D/E; DOC-R4C13-01/02 — all un-triggered; carried.

## Gate baseline (clean tree)

Cycle-19 close: all 8 gates green; deploy verified live (SW final stamp
`67d83c42`/`ee57b14b`). All 8 gates re-run during PROMPT 3 after this
cycle's fix lands.

## HARD-SCOPE check

No finding proposes edit / culling / scoring / preset features.
SEC-R4C20-01 hardens an existing same-origin validator; TEST-R4C20-02 is
a regression-lock for it. Both restore an existing security control to its
documented behavior.

## AGENT FAILURES

None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool is
unavailable in this environment, per the documented run-wide constraint).
