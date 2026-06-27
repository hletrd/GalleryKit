# Architect Review — Cycle 17 (HEAD 7b5c1943)

Scope: architectural & design-risk review — coupling, layering, leaky abstractions,
process-local state vs single-writer assumption, invariant enforcement (compile-time
guards), config layering, cross-cutting-pattern consistency. Only NEW / still-open
risks reported. Sixteen prior cycles closed nearly all findings.

---

## Inventory of architectural boundaries / cross-cutting concerns

### B1. `topics.slug` reference registry (the rename fan-out)
`topics.slug` is the PRIMARY KEY (`schema.ts:5`). Four stores couple to it:

| Store | Coupling | onDelete | onUpdate | Enforcement |
|-------|----------|----------|----------|-------------|
| `topic_aliases.topic_slug` | FK (`schema.ts:16`) | cascade | **none** | DB FK + manual re-point |
| `images.topic` | FK (`schema.ts:33`) | **restrict** | **none** | DB FK + manual re-point |
| `topic_views.topic` | FK (`schema.ts:236`) | cascade | **none** | DB FK + manual re-point |
| `smart_collections.query_json` | **NON-FK** — slug embedded in serialized AST | n/a | n/a | manual AST remap only |

No `ON UPDATE CASCADE` exists anywhere in `drizzle/` (verified). The rename is a
**recreate** (delete-old + insert-new), so each child must be manually re-pointed
inside the `updateTopic` transaction (`topics.ts:249-323`).

### B2. Public image-select privacy split (five sites, three guarded)
- Guarded by `Extract<keyof, _PrivacySensitiveKeys>` compile assertion:
  `publicSelectFields` (`data.ts:464`), `publicMapSelectFields` (`data.ts:476`),
  `searchFields` (`data.ts:1500-1503`).
- **Unguarded** (regex-fixture only): inline enrichment selects in
  `api/search/semantic/route.ts:293-309` and `api/search/similar/[id]/route.ts:195-210`.

### B3. Process-local state (single-writer invariant)
`viewCountBuffer` + flush state (`data.ts:17-70`), rate-limit prune timestamps/buckets
(`rate-limit.ts:79-110`), upload quota tracker (`images.ts:159,205`), backfill-runner
status, image-queue bootstrap flag (`image-queue.ts:77`), settings-hash + serving-hash
caches, session-secret cache, CLIP model load promise. All documented in CLAUDE.md
"Runtime topology". No new state added in cycle-16.

### B4. gallery-config layering
`gallery-config-shared.ts` (validation, client-safe — imported by components + data.ts)
→ `gallery-config.ts` (resolution + operator-gated `production`→`disabled` heal,
`:64-135`) → `image-queue.ts` consumption. Semantic routes resolve mode via
`getGalleryConfig()`, not raw DB.

### B5. `@/lib/storage` quarantine
AST-based fail-loud test (`storage-quarantine.test.ts`). Zero non-test importers.

### B6. Migration robustness
`migrate.js` hash post-condition (`:740`) + `reconcileLegacySchema` (`:267-640`).
Journal `_journal.json` carries a permanently non-monotonic block (idx 7–17 `when`
≈ May-2025, BELOW idx 0–6 ≈ Dec-2025/2026); 0024 appended at `1782100000000` > prior max.

---

## Findings

### A1 — STRUCTURAL, HIGH — `topics.slug` fan-out has no single source of truth; recreate pattern forces manual per-child re-pointing with ASYMMETRIC failure modes (silent data loss on cascade children)

**Design risk.** Four stores reference `topics.slug`; three via FK (none with
`ON UPDATE CASCADE`), one via JSON-embedded value. Because the rename is a recreate
(`topics.ts:321-322` deletes the old PK row), every FK child MUST be manually
re-pointed before the delete. The failure modes are not uniform:
- miss an `onDelete:restrict` child (`images`) → delete throws → LOUD, safe;
- miss an `onDelete:cascade` child (`topic_views`, `topic_aliases`) → the delete
  CASCADE-wipes that child → **SILENT data loss**.

`topic_views` (the later-added cascade child) was exactly the missed sibling for
multiple cycles until R16C16 `DBG-16-01` (`topics.ts:285-292`); `smart_collections`
was the next miss, fixed at R16C16 `DBG-16-03` (`topics.ts:294-319`). This is a
textbook recurring "fix one sibling, miss the next."

**Manifests.** `topics.ts:249-323` (recreate transaction); `schema.ts:16,33,236`
(FKs lacking `onUpdate`); `schema.ts:293-297` (`smart_collections` non-FK coupling).

**Failure mode it enables.** A developer adds a new table with an FK to `topics.slug`
(or a new place that stores a slug) without knowing to edit `updateTopic`. Next rename
either cascade-wipes the new child or restrict-blocks. The pinning test
(`topics-actions.test.ts:262`, mock list at `:98-110`) **encodes the same hand-maintained
child list as the code** — it mocks exactly `{topicAliases, images, topicViews,
smartCollections}` — so it cannot detect a missing NEW sibling; it passes while the
sibling is silently unhandled.

**Structural fix.** Add `onUpdate: 'cascade'` to the three FKs (schema + a migration
that drops/recreates each constraint) and convert the rename from delete+insert to an
in-place `UPDATE topics SET slug=…, label=…, order=…, image_filename=…, map_visible=…
WHERE slug=old`. InnoDB then cascades the slug change to `images` / `topic_aliases` /
`topic_views` automatically, and any FUTURE FK child added with `onUpdate:cascade` is
covered for free. Only `smart_collections` (a value embedded in a serialized AST, not a
referential column) legitimately remains a manual `remapTopicSlugInQuery` step — that one
is genuinely special and cannot be FK-enforced. Net effect: 3 of 4 fan-out targets
collapse into one DB-enforced invariant; the 4th is the only one that ever needs hand
code. Side benefit: eliminates the `image_filename`/`map_visible` carry-over footguns
(`COR-R4C13-01`) entirely, since there is no insert to forget columns on.

**Tactical alternative (if the FK-constraint migration is out of scope this cycle).**
Replace the hand-mocked rename test with a **schema-derived registry assertion**: at
test time query `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` for every FK where
`REFERENCED_TABLE_NAME='topics' AND REFERENCED_COLUMN_NAME='slug'`, and assert the
`updateTopic` rename re-points each. Adding a new FK child without re-pointing then fails
CI. This does NOT fix the asymmetric-failure root cause, but it removes the "test shares
the code's blind spot" gap — the cheapest defense against the next silent cascade-wipe.

**Confidence.** HIGH on diagnosis. MEDIUM on doing the full structural fix THIS cycle —
the in-place-update migration drops/recreates three FK constraints and deserves a focused
plan, not a drive-by. The tactical registry test is safe to land immediately.

---

### A2 — STRUCTURAL, MEDIUM-HIGH — public search-route enrichment selects sit OUTSIDE the compile-guarded privacy system; the cycle-16 fixture is a denylist that drifts

**Design risk.** Five public image-select sites now exist. Three carry the
`Extract<keyof, _PrivacySensitiveKeys>` compile guard (`publicSelectFields`,
`publicMapSelectFields`, `searchFields`). The two route-level enrichment selects
(`api/search/semantic/route.ts:293-309`, `api/search/similar/[id]/route.ts:195-210`)
hand-roll their column object and are guarded ONLY by `search-route-privacy.test.ts` —
a regex DENYLIST whose `PII_COLUMNS` array is a hand-copied mirror of `PrivacySensitiveKeys`.

**Failure mode (two independent drift vectors).**
1. A new PII column added to `schema.ts` + `adminSelectFields` + `PrivacySensitiveKeys`
   but NOT to the test's `PII_COLUMNS` array: the data.ts guards auto-cover (they
   `Extract` over the live union), but the route fixture silently does not, so a
   `latitude: images.latitude` wired into a route for a "show location" feature ships to
   anonymous callers with zero tsc/test signal. The denylist must be maintained in two
   places; the compile guard maintains itself.
2. The fixture matches the literal `images.<col>`. A PII value resolved via JOIN — e.g.
   `uploaded_by` → a username through an `adminUsers` join (the exact Atom-feed footgun
   class, `SEC-13-01`) — or via an aliased re-export sidesteps the regex entirely.

**Structural fix.** Export one guarded `searchEnrichmentSelectFields` const from data.ts
(shape `{id,title,description,filename_jpeg,width,height,topic,camera_model,lens_model,
capture_date}`; `topic_label` is added at the call site from the `topics` JOIN, not from
`images`, so it stays out of the const) carrying the same `_PrivacySensitiveKeys` Extract
guard, and have both routes import it instead of hand-rolling the object. The shape is
already byte-identical to data.ts `searchFields` (`data.ts:1486-1492`) minus `created_at`
— the routes could literally consume the same guarded source. A PII add then becomes a
tsc error at the definition, allowlist-style, with no denylist to maintain.

**Tactical alternative.** Keep the inline selects but convert the fixture from a denylist
to an ALLOWLIST: assert the set of `images.<col>` references in each route is a SUBSET of
the already-exported `publicSelectFieldKeys` (`data.ts:439`, sorted+frozen). Removes the
hand-maintained `PII_COLUMNS` drift without touching the routes. Cheaper, but still blind
to vector 2 (JOIN-sourced PII).

**Confidence.** HIGH. The hole is real; the structural fix is low-risk (a const extract +
two imports) and strictly subsumes the band-aid.

---

### A3 — STRUCTURAL SMELL, LOW-MEDIUM — migration DROP semantics invert the Drizzle contract; reconcileLegacySchema is the real applier, so every future DROP is a "mirror-it-or-it-no-ops" surface (the A1 pattern, in the migration layer)

**Design risk.** For DROP migrations (0023 paid-downloads, 0024 reactions) the journaled
`.sql` is BASELINED-NOT-RUN; the actual schema change executes only inside
`reconcileLegacySchema` via guarded `dropTableIfPresent` / `dropColumnIfPresent`
(`migrate.js:628-638`). This inverts the normal contract where the `.sql` IS the change.
Every future DROP must be hand-mirrored into `reconcileLegacySchema` or it is a silent
no-op on already-baselined DBs — which is precisely the 0014-orphan → 0024-fix history
(documented in `0024_drop_reactions.sql`'s header). Same "miss the next sibling" shape as
A1, one layer down.

**Manifests.** `migrate.js:267-640` (reconcile), `:628-638` (entitlements/reactions
drops), `drizzle/0024_drop_reactions.sql` (trigger-not-executor pattern).

**Mitigants already present.** `migrate-reconcile-coverage.test.ts` exists (registry-style
coverage), and the `runMigrations` hash post-condition (`migrate.js:740`) fails loud on
silently-skipped ADD migrations. The 0024 journaling approach itself is CORRECT: monotonic
`when` (1782100000000 > prior max), and "presence flips `journalCovered===false` →
reconcile runs" is the documented, sound mechanism — NOT a workaround.

**Recommendation.** Not a must-fix. Optional hardening: extend
`migrate-reconcile-coverage.test.ts` with a DROP-specific assertion that every journaled
`DROP TABLE` / `DROP COLUMN` statement has a corresponding `dropTableIfPresent` /
`dropColumnIfPresent` in `reconcileLegacySchema`, so the mirror cannot be forgotten on the
next removal. **Confidence MEDIUM** — a smell with existing nets, not an active defect.

---

## Re-confirmations (verified, no new risk)

- **Process-local state / single-writer invariant (B3).** Cycle-16's two substantive
  diffs are clean: `6babb405` reuses the EXISTING bootstrap config read for the
  embedding semantic-mode lookup (`image-queue.ts`), adding no state; `78a9c0c2` only
  REORDERS the existing upload quota-tracker claim earlier to close a TOCTOU
  (`images.ts:205`), adding no state. Invariant remains documented in CLAUDE.md
  "Runtime topology". **PASS.**
- **gallery-config layering (B4).** Validation → resolution → consumption boundary intact;
  both semantic routes read the mode through `getGalleryConfig()` (resolver heal at
  `gallery-config.ts:126-135`), no raw-DB settings bypass. **PASS.**
- **`@/lib/storage` quarantine (B5).** AST fail-loud test enforced; zero non-test
  importers. **PASS.**
- **Journal monotonicity (B6).** The non-monotonic idx 7–17 block persists by design;
  0024 appended above max; the `migrate.js` hash post-condition is the permanent net that
  catches any future author who picks a `when` ≤ current max. Documented hazard, defended.
  **PASS (no new risk).**

---

## Priority ledger

| ID | Risk | Class | Severity | Must-fix-now vs Restructure |
|----|------|-------|----------|------------------------------|
| A1 | topics.slug recreate fan-out, asymmetric silent loss | structural (FK onUpdate + in-place update) | HIGH | Restructure (plan it); land tactical INFORMATION_SCHEMA registry test now |
| A2 | search-route inline selects outside privacy compile guard | structural (shared guarded const) | MED-HIGH | Should restructure now — low-risk const extract |
| A3 | migration DROP mirror in reconcile, not in .sql | structural smell | LOW-MED | Optional hardening; existing nets adequate |

