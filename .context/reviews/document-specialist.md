# Document-Specialist Review — Run-9 Cycle-1 (HEAD bb463062)

**Date:** 2026-06-17
**Scope:** Full doc-accuracy sweep of CLAUDE.md, AGENTS.md, `.context/**`, i18n messages, and heavily-commented source files. Cross-check of all load-bearing doc claims against HEAD code. Cycle-8 fix verification included.

**Findings: 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW.**

---

## Cycle-8 fix verification

All three cycle-8 doc findings are confirmed fixed at HEAD:

- **DOC-C8-01** (CLAUDE.md "deployed DARK" framing): Fixed. `CLAUDE.md:121` now reads "The real jina-clip-v2 encoder is **ACTIVATED in production**" with accurate gating mechanism description. No stale "dark" framing in CLAUDE.md.
- **DOC-C8-02** (en.json/ko.json `settings.semanticSearchDesc` "deployed dark"): Fixed. Both strings now describe the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` opt-in gating mechanism without asserting the feature is dark. i18n key parity confirmed OK (Python key-parity check: zero asymmetric keys at any depth).
- **DOC-C8-03** (`search.invalid` off-by-one minimum): Fixed. `search.invalidSemantic` key added to both `en.json:412` ("Type at least 3 characters for semantic search.") and `ko.json:412` ("시맨틱 검색은 세 글자 이상 입력하세요.") with correct 3-codepoint minimum stated.

---

## DOC-C9-01 [LOW, confidence Medium] — Inline code comments say "deployed DARK" after production activation

**Files:**
- `apps/web/src/lib/gallery-config.ts:134` — `// AGG-C10-02 (run-6 cycle-1): the CLIP feature is deployed DARK by explicit user choice.`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:665` — `// … The real ONNX encoder exists but the feature is deployed DARK; …`

**Assessment:** Both are inline code comments explaining a *code invariant* (why the resolver heals `'production'→'disabled'` without the env flag, and why the admin UI omits the `'production'` SelectItem). They describe the UI-side architectural intent ("hidden from admin UI by design"), not the state of the production deployment. Neither comment is user-facing. A maintainer reading either comment alongside the code it annotates would not conclude production search is inert — the surrounding logic and env-flag gating make the invariant clear. However, the phrase "deployed DARK" now contradicts the production reality for an operator reading these comments while debugging. The correct phrasing would be "operator-gated" or "UI-hidden".

**Why LOW (not MEDIUM):** The comments annotate code that works correctly regardless of the comment wording. The misleading risk is confined to a developer reading these specific inline comments in isolation; CLAUDE.md (the primary reference) was already corrected in cycle 8 and describes the live state accurately.

**Fix:** In `gallery-config.ts:134`, replace "the CLIP feature is deployed DARK by explicit user choice" with "the CLIP feature is operator-gated (activated in production; hidden from the admin UI by design)". In `settings-client.tsx:665`, replace "the feature is deployed DARK" with "the feature is operator-gated (not activatable via the admin UI)". No behaviour change; comment-only.

**Confidence:** Medium — the phrase is genuinely stale relative to production reality, but the code invariant it describes remains architecturally correct (production mode IS intentionally hidden from the UI). A reasonable reviewer could treat this as non-actionable.

---

## Verified-consistent (no mismatch found)

The following claims in CLAUDE.md were verified against code at HEAD:

- **`IMAGE_PIPELINE_VERSION = 7`** — confirmed at `gallery-config-shared.ts:21`; `process-image.ts` re-exports it at line 315. The Key Files table description (`gallery-config-shared.ts:21`) is accurate.
- **`COLOR_IMPACTING_KEYS` count = 9** — confirmed. `settings-hash.ts` defines 9 keys (5 color + 3 quality + `image_sizes`) starting at line 41. CLAUDE.md's `settings-hash.ts:37-49` line reference is approximately correct (actual declaration starts at line 41; the 3-line header comment before it starts at line 37 — close enough to be useful).
- **Advisory-lock names** — all 6 names in the CLAUDE.md advisory-lock scope note are confirmed in `src/lib/advisory-locks.ts`: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`.
- **React `cache()` count = 10** — confirmed. `data.ts` has exactly 10 `cache()` calls: `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached` (9 `Cached` exports) + `getSeoSettings` (1). CLAUDE.md Performance Optimizations section accurately states 10.
- **`sanitizeForOg` consumer count** — CLAUDE.md claims "all three consumers — both OG image routes … and the JSON-LD photo page (`p/[id]/page.tsx`)". Verified: `api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, and `app/[locale]/(public)/p/[id]/page.tsx` all import `sanitizeForOg`. The CLAUDE.md path abbreviation `p/[id]/page.tsx` omits the `[locale]/(public)/` prefix but is unambiguous in context.
- **NCLX matrix map** — CLAUDE.md documents `0=identity, 1=BT.709, 8=BT.2020-NCL (alias of 9), 9=BT.2020-NCL, 10=BT.2020-CL`. Confirmed against `color-detection.ts:204-210` (`NCLX_MATRIX_MAP`). Accurate.
- **Touch-target `SCAN_ROOTS`** — CLAUDE.md states `components/ + app/[locale]/admin/ + app/[locale]/(public)/`. Confirmed in `touch-target-audit.test.ts:79-83`: `componentsDir`, `adminDir`, `publicDir` — all three.
- **Backfill concurrency cap formula** — CLAUDE.md: `max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → cap = 2 at pool 10. Confirmed in `admin-backfill-runner.ts:105-122`.
- **`sw.template.js` + `sw.js`** — both files exist at `public/sw.template.js` and `public/sw.js`.
- **i18n key parity** — full recursive key-set comparison of `en.json` vs `ko.json` shows zero asymmetric keys. The intentional en=ICU-plural / ko=single-form value asymmetry (documented at CLAUDE.md Testing section) is confirmed present and correct.
- **Semantic search framing in CLAUDE.md** — no remaining "deployed dark" / "deployed DARK" text. The `SEMANTIC_SEARCH_ALLOW_PRODUCTION` gating, the `disabled` code default, and the live production activation are all accurately described.
- **Admin settings i18n** — `en.json` and `ko.json` `settings.semanticSearchDesc` both describe the operator-gating mechanism without asserting the feature is dark. `settings.semanticSearchProductionWarning` in both files accurately warns about the resolver-heal behaviour.
- **Lint gates count** — CLAUDE.md states "Four lint scripts". `apps/web/package.json` has exactly 4 lint scripts: `lint`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`. Accurate.
- **`process-image.ts` line ref `1019-1097`** — the range 1019-1097 spans the wide-gamut downscale gate and early-return logic; the fresh-per-format `sharp()` instantiation that the doc note targets is at ~1118-1132. The line range in CLAUDE.md is approximately correct as a navigational pointer to the `processImageFormats` function body; it is not misleading enough to constitute a finding.
- **`gallery-config-shared.ts:21`** — confirmed: `export const IMAGE_PIPELINE_VERSION = 7;` is at line 21.
