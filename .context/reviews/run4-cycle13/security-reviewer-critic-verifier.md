# Run-4 Cycle 13 — security-reviewer / critic / verifier angle

Full-inventory in-context pass (single-subagent constraint documented in the
aggregate). Inventory: the rotation surfaces (topics action stack,
process-topic-image, csv-escape, blur-data-url, icc-extractor, tag records),
the cycle-12 fix commit, schema FK/default semantics for the affected
columns, and the GPS-exposure path downstream of `map_visible`
(`lib/data.ts` getMapImages dual-layer guard).

## Verifier confirmation of COR-R4C13-01 (map_visible reset on rename)

Evidence chain, each link read from source this cycle:
1. `db/schema.ts:11` — `map_visible: boolean("map_visible").notNull().default(false)`.
   A Drizzle INSERT omitting the column lets MySQL apply `DEFAULT false`.
2. `app/actions/topics.ts:248-253` — rename insert omits `map_visible`.
3. `lib/data.ts:1533-1550` — public map STOPS returning the topic's images
   (INNER JOIN on `map_visible = true`); runtime guard would refuse rows
   even if the JOIN drifted. So the user-visible symptom is immediate.
4. UI: `topic-manager.tsx:244-249` renders the Switch from the DB value —
   after rename it displays OFF. The admin's only recovery is noticing and
   re-toggling.
CONFIRMED (HIGH confidence). Severity MEDIUM: silent loss of an explicit
admin opt-in; reachable from a routine admin flow (rename); recoverable by
re-toggling once noticed.

## Security read of the same finding

- Direction: fail-safe. The reset always moves a topic OUT of the public
  GPS map, never into it. No privacy regression, no GPS leak. The dual-layer
  guard in `getMapImages` is unaffected.
- The fix must NOT invert this: carrying `map_visible` from the
  transaction-selected authoritative row preserves the opt-in exactly;
  there is no path by which a non-opted topic gains `true`.
- Audit trail: `topic_update` audit events do not record map_visible
  transitions (only `topic_map_visible_set` does), so the reset is also
  invisible in the audit log — worth carrying the value precisely so the
  audit surface stays truthful (no event should mean no change).

## Re-audited clean (no findings)

- `process-topic-image.ts` upload handling: per-file size cap shared with
  the advertised `MAX_UPLOAD_FILE_BYTES`; extension allowlist on the
  client-supplied name only gates entry — output is always
  `${randomUUID()}.webp` under `public/resources/`, so no user-controlled
  filename reaches disk; temp file mode 0600; Sharp `limitInputPixels`
  bound (`MAX_INPUT_PIXELS_TOPIC`); failure path unlinks temp+output.
  `deleteTopicImage` validates with `isValidFilename` (no `..`, `/`, `\`)
  before unlink — DB-sourced values are our own UUIDs, and even a poisoned
  restore cannot traverse out of RESOURCES_DIR.
- `csv-escape.ts` — pass order verified: control-strip → invisible-char
  strip → CRLF collapse → whitespace-tolerant formula quote → quote-wrap.
  The documented C7R/C8R bypass lineage holds; no new bypass found (tested
  mentally against ZWSP-prefixed `=HYPERLINK`, tab-prefixed `=`, CR-only
  injection, bidi-wrapped formulas — all neutralized in order).
- `icc-extractor.ts` — bounds audit clean (see code angle for line-level
  detail); attacker-supplied ICC blobs cannot OOB-read or loop unbounded;
  whole parse is try/catch best-effort.
- `blur-data-url.ts` — allowlist prefixes + cap + redacted throttled warn;
  write barrier + producer wrap unchanged since the fixture tests locked
  them.
- Topics action auth posture: every mutating export checks restore
  maintenance → `isAdmin()` → `requireSameOriginAdmin()` before input
  handling; input sanitization (`sanitizeAdminString` / `requireCleanInput`)
  precedes validation; slug/alias surfaces enforce reserved-segment and
  format checks inside the route lock. Matches the lint-gate contract.
- `mysql-cli-ssl.ts` — local-host allowlist + `DB_SSL !== 'false'` default
  to REQUIRED for remote hosts; consistent with backup/restore CLI usage.

## Critic notes

- The recreate-row rename idiom is intrinsically column-addition-hostile:
  any future `topics` column repeats COR-R4C13-01 unless threaded through.
  The fix should pin the contract with a VALUES assertion in the rename
  test so the next column addition fails the suite instead of shipping a
  silent reset. (A runtime "SELECT *-and-spread" approach was considered
  and rejected: spreading an unvetted row into an INSERT hides intent and
  re-introduces the slug/label/order form-override logic ambiguity; the
  explicit column list + test is the auditable shape.)
- No HARD-SCOPE drift: nothing here proposes edit/culling/scoring features.
