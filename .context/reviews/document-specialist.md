# Document-Specialist Review — Run-6 Cycle-8 (HEAD 1a325fa6)

**Scope:** doc-vs-code (and doc-vs-production-reality) consistency, prioritizing the now-LIVE CLIP semantic-search activation. The feature was previously documented as "deployed DARK"; it is now LIVE in production (`semantic_search_mode=production` in the prod DB, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, 445 real `jina-clip-v2-d512-q8` embeddings serving). The concern is STALE documentation that still frames the feature as dark/unfinished.

**Findings: 0 CRITICAL / 0 HIGH / 2 MEDIUM / 1 LOW.**

> Scope note: the *code default* `semantic_search_mode: 'disabled'` in `gallery-config-shared.ts` is CORRECT for fresh installs and is NOT flagged. The findings below concern docs/strings that assert the feature is "deployed dark" as a current state, which production reality now contradicts.

---

## DOC-C8-01 [MEDIUM, confidence High] — CLAUDE.md still describes CLIP as "deployed DARK"

**Doc:** `CLAUDE.md:121` — "`image_embeddings` - CLIP embeddings (US-P51). Real jina-clip-v2 encoder shipped but **deployed DARK** (`semantic_search_mode` defaults to `disabled`; …)".

**Contradicting reality:** the feature is LIVE in production. The encoder is no longer dark — the production DB row is `production`, the env opt-in is set, and the public semantic + similar routes serve real results (verified HTTP 200). A maintainer reading CLAUDE.md would conclude the feature is unshipped/inert and could (a) assume the live route is a no-op, (b) skip the operational care a live ML inference path on the single-instance topology requires, or (c) "re-enable" something already on.

**Fix:** update line 121 to state the encoder is **activated in production** (operator-gated via `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + the DB `semantic_search_mode=production` row), while keeping the accurate note that the *code default* remains `disabled` for fresh installs and that stub mode uses non-meaningful deterministic vectors. Cross-reference the live-feature verification curl in the operational playbook.

---

## DOC-C8-02 [MEDIUM, confidence High] — Admin settings i18n string says CLIP is "deployed dark"

**Doc/strings:** `apps/web/messages/en.json:727` (`settings.semanticSearchDesc`): "… The real CLIP encoder is **deployed dark**; production search is operator-only. …"; the parallel `ko.json` key carries the same framing.

**Contradicting reality:** identical staleness to DOC-C8-01, but user-facing — an admin configuring the gallery is told production search is "deployed dark / operator-only" when it is in fact live on this deployment. The "operator-only" gating clause is still accurate (the env flag is required); only the "deployed dark" present-tense framing is stale.

**Fix:** reword the en + ko strings so they describe the *gating mechanism* ("production semantic search requires the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` server opt-in") rather than asserting the feature is dark. Keep en/ko key parity; the en=ICU-plural vs ko=fixed-form value asymmetry elsewhere is intentional and not in scope for these plain-string keys.

---

## DOC-C8-03 [LOW, confidence High] — `search.invalid` i18n string states the wrong minimum-length (2 vs 3)

**Strings:** `apps/web/messages/en.json:411` "Type at least **2** characters to search." and `ko.json:411` "검색하려면 **두** 글자 이상 입력하세요." ("two/2").

**Contradicting code:** the semantic route rejects queries below **3** code points (`api/search/semantic/route.ts`), and the designer review (Finding 1/2) recommends routing the client-side semantic short-query case through this `invalid` status. As written, the string would tell the user "at least 2" while a 2-char semantic query still fails — an off-by-one user-facing contradiction. (The keyword path's own minimum is 2, so the string is correct *for keyword* but wrong if reused for semantic.)

**Fix:** coordinate with the designer fix (search.tsx client-side guard) — either add a dedicated `search.invalidSemantic` key stating "at least 3 characters" (and route the semantic branch to it), or align the minimums. Update both en + ko. (This finding is the doc/i18n half of designer Finding 2 — tracked jointly so the strings and the client guard land together.)

---

## Verified-consistent (no mismatch)

- **clip-paths.ts / clip-model.ts header comments** match the code in the same files and the download script. The load-bearing empirical claim (transformers v3 keys its FS cache by `<repoId>/<revision>/<file>` for a non-`main` revision) is **TRUE** — confirmed by other reviewers against `node_modules/@huggingface/transformers/src/utils/hub.js` (`revision === 'main' ? requestURL : pathJoin(repoId, revision, filename)`), and the pin is a 40-hex SHA so the non-main branch is taken. `allowRemoteModels=false` and the revision pin are accurately documented.
- **Model identity** is consistent across docs and code: `jinaai/jina-clip-v2`, the pinned revision, `EMBEDDING_DIM=512`, `EMBEDDING_BYTES=2048`, `PRODUCTION_MODEL_VERSION='jina-clip-v2-d512-q8'`.
- **i18n key parity** between en.json and ko.json holds for the semantic/similar keys (`semanticToggle`, `semanticExperimentalHint`, `similarPhotos`, `similarEmpty`, and the `settings.semanticSearch*` block).
- The `backfill-clip-embeddings.ts` sidecar-example comment block (lines 14-19) uses `--env-file …/.env.local`, which is the supported way to pass `CLIP_MODELS_ROOT` (the prod `.env.local` carries the absolute bind-mount value); it does not re-introduce the path-mismatch e0da12ee fixed, provided `.env.local` sets `CLIP_MODELS_ROOT`. (Recommend the playbook explicitly note that `.env.local` must carry `CLIP_MODELS_ROOT` — minor, folded into DOC-C8-01's cross-reference.)

**No re-reports of cycle 1-7 closed doc items.** (The prior cycle-7 document-specialist.md verified 37 load-bearing CLAUDE.md facts as still-accurate at a7758ef0; those remain accurate at 1a325fa6 — the only doc drift is the activation-staleness above, which postdates that pass.)
