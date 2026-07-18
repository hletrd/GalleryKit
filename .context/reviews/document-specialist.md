# Document specialist — cycle 2 provenance

Target: `ba4bc60acd4bc41b29ec02f509c3455d115ba083`, 2026-07-18 KST. Review only.

## Relevant-file inventory

Read completely: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, root/app package manifests, env examples, site-config examples, deploy scripts, Compose/nginx/Docker files, CI workflows, CLIP plan/spec, migration journal/runbook, all operator-facing message keys, and current review/plan policy references. Claims were traced into app routes/libs/tests across the 939-file inventory.

## Findings

### DOC-2-01 — Semantic-search docs imply repeated backfills restore old-photo recall

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed** documentation error
- Region: `README.md:50`; `apps/web/README.md:68-76`; `apps/web/src/app/api/search/semantic/route.ts:263-279`; `apps/web/scripts/backfill-clip-embeddings.ts:165-192,217-228`

Failure scenario: an operator with more embeddings than `SEMANTIC_SCAN_LIMIT` repeats the backfill expecting older photos to become searchable. The route still selects only the latest `image_embeddings.updated_at`; the backfill excludes rows already at the target model version, so repetition does not rotate or broaden the scanned set.

Suggested fix: say that raising the bounded scan limit (within its cap) or adding a vector index is required for broader recall. Describe repeated backfills only as completing a capped missing-embedding backlog.

### DOC-2-02 — Sitemap recovery comments and diagnostics misdescribe the built behavior

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Region: `apps/web/src/app/sitemap.ts:37-43,78-82,84-162`; generated prerender manifest

Failure scenario: operators are told ISR replaces the fallback on the first runtime hit, but the build artifact is fresh for an hour. The warning also says “homepage-only” although fallback includes enabled-by-default static paths and the root feed.

Suggested fix: correct both claims and document the first-hour consequence if retained; ideally fix route ownership and then describe first-request runtime generation accurately.

### DOC-2-03 — “Explicitly trusted repository owner” is not explicit in implementation or operator docs

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Region: `.context/reviews/_aggregate.md:52-58`; `scripts/deploy-remote.sh:61-75`; `README.md:129-144`; `CLAUDE.md:755-765`

Failure scenario: the current aggregate calls the repository owner explicitly trusted, while code merely reads the checkout UID and operator docs provide no trust/ownership configuration. A sudo/root operator cannot tell that checkout ownership expands who may provide executable deploy configuration.

Suggested fix: either remove the exception or add an explicit trusted-UID setting and document its threat model, safe ownership, and sudo behavior.

## Final sweep

I checked command names, versions, env defaults, paths, route names, upload limits, proxy/body caps, backup scope, build-time config, semantic activation, migration steps, i18n claims, and deploy behavior. No other new material documentation contradiction was confirmed.
