# Cycle 31 Document Specialist Review

Reviewer: document-specialist
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `f1dd39ebb9c2acde2a4dce5974e6cd1fada6f9aa`
Date: 2026-06-30 KST
Scope: README/CLAUDE/.context/source consistency, deploy/docs mismatches, schema/migration docs, and authoritative source claims embedded in docs. No product code was edited.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Then checked:

- Root/app docs: `README.md`, `apps/web/README.md`, `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.
- Source contracts those docs cite: package versions, schema, migrations, migrate runner, deployment scripts, Docker/Compose/nginx, route gates, storage quarantine, semantic search, display capability hook.
- External authoritative claims: MDN/Browser Compat Data for `color-gamut` and `dynamic-range`, plus the linked Mozilla bug reference used by the docs.

## Findings

### C31-DOC-01: Firefox HDR/dynamic-range documentation is stale against current MDN compatibility data

Severity: Medium
Confidence: High
Failure mode: stale operator/reviewer guidance for display-capability behavior

Exact local regions:

- `CLAUDE.md:367-381`
- `apps/web/src/lib/use-display-capability.ts:72-74`
- Related local comments: `apps/web/src/lib/use-display-capability.ts:4-12`, `:64-70`, `:91-109`

Evidence:

`CLAUDE.md` says Firefox does not implement `(dynamic-range: high)` and therefore `isHdr` always returns false on Firefox. Current source does not special-case Firefox; it reads `window.matchMedia('(dynamic-range: high)').matches` for every browser. Official MDN says the `dynamic-range` media feature is supported in Firefox, and MDN Browser Compat Data reports Firefox `version_added: "100"` for `dynamic-range`.

The color-gamut part of the same section is more nuanced: MDN BCD still carries a Firefox note that `color-gamut: p3` and `rec2020` are always false because Firefox does not support wide-gamut color, linked to Mozilla bug 1626624. So the stale part is the HDR/dynamic-range claim, not the entire Firefox section.

Concrete failure scenario:

A future reviewer or implementer trusts `CLAUDE.md` and assumes Firefox can never report HDR display capability. They may suppress tests, UI checks, or bug reports for Firefox HDR even though the app now asks the browser directly and current compatibility data says Firefox supports the feature. The docs become a stronger source of false certainty than the source code.

Concrete fix:

Update the Firefox display matrix and impact text to split the claims:

- Keep the `color-gamut: p3/rec2020` Firefox caveat tied to MDN BCD and Mozilla bug 1626624.
- Replace "dynamic-range not implemented / always false" with current MDN BCD-backed wording: Firefox supports the media feature; actual `high` matches still depend on user agent plus output device capability.
- Adjust `use-display-capability.ts` comments in the same change, since source comments currently say `(color-gamut: p3)` is restricted to Chrome/Safari/Edge while the code feature-detects it generically.

### C31-DOC-02: Embedded source line references in `CLAUDE.md` have drifted

Severity: Low
Confidence: High
Failure mode: reviewer/runbook navigation error

Exact local regions:

- `CLAUDE.md:127` says `IMAGE_PIPELINE_VERSION` is in `gallery-config-shared.ts:21`; source defines it at `apps/web/src/lib/gallery-config-shared.ts:22`.
- `CLAUDE.md:161` says smart collection `query_json` is at `schema.ts:297`; source table starts at `apps/web/src/db/schema.ts:304` and `query_json` is at `:308`.
- `CLAUDE.md:172` cites the ProPhoto transfer path at `lib/color-detection.ts:99-108`; source still includes the relevant logic at `apps/web/src/lib/color-detection.ts:98-108`, so this one remains usable but already shifted.
- `CLAUDE.md:308` says `COLOR_IMPACTING_KEYS` is at `settings-hash.ts:45-57`; the exported list is now `apps/web/src/lib/settings-hash.ts:47-59`.

Concrete failure scenario:

The docs are used as a control surface for agents and contributors. Stale line references make reviewers inspect the wrong region, miss a changed constant, or waste time reconciling a false mismatch. This is low severity because the surrounding filenames and prose are still correct, but it directly undercuts the requested "authoritative source claims" quality of the docs.

Concrete fix:

Avoid exact line numbers in long-lived `CLAUDE.md` prose unless a test pins them. Prefer symbol names and search strings, or update the line references in the same change that moves the symbols. For the current drift, replace these references with symbol-only pointers such as "search for `export const IMAGE_PIPELINE_VERSION`".

## Confirmed Matches / Non-Findings

- `AGENTS.md:31-38` now matches the current public route rate-limit gate: mutating public handlers and expensive public GET handlers must rate-limit or carry a reasoned exemption.
- Root/app README package claims align with `apps/web/package.json:5-7`, `:57-62`, and `:84-85`: Node 24+, Next 16, React 19, TypeScript 6.
- Deploy docs align with scripts: config-driven `.env.deploy`, no hardcoded deploy host in the helper, post-health Docker pruning, no automatic `volume prune -a`, `/api/live` liveness, and bind-mounted mutable stores.
- Semantic search docs match source on disabled-by-default production gating, offline CLIP weights, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, newest-first bounded scan limits, and no bundled Lightroom Classic plugin.
- Paid-download/Stripe removal docs match current source; remaining references are historical migration/removal records.
- Storage docs match current source after the quarantine guard: the product supports local filesystem storage only, and `@/lib/storage` is not wired into live upload/serve paths.

## Final Missed-Issue Sweep

Final sweep terms and surfaces: deploy, `.env.deploy`, Docker prune, health/live, upload body caps, TRUST_PROXY, semantic/CLIP, auto alt-text, Lightroom/plugin wording, Stripe/payment, public route freshness, service worker offline scope, touch-target audit, lint gates, migrations/journal, privacy fields, storage, Firefox, color-gamut, dynamic-range, stale line refs, and `.context/plans`.

Skipped: live deployment verification, rendered Markdown preview, and exhaustive archived review history. This artifact is the document-specialist output for cycle 31.
