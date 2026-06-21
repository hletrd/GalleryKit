# Tracer Report — RUN-9 Cycle-1

HEAD: d3858cfc (code byte-identical to converged f63af3b9)

---

## Trace Report

### Observation

Five data flows were traced end-to-end with file:line evidence to determine
whether any latent bug could cause a crash, admin-data leak, privacy breach,
cache-invalidation failure, or data-destruction event.

---

## FLOW-A: Public photo viewer download path

### Hypothesis

H-A1 (leading): The flow is clean — `publicSelectFields` omits
`color_pipeline_decision` (admin-only), `filename_jpeg` / `filename_avif`
are present, `isP3Pipeline` / `isWideGamutPrimary` are null-safe, and the
download hrefs are conditional on field presence.

H-A2 (alternative): `color_pipeline_decision` is absent from the public
object, so `isP3Pipeline(image.color_pipeline_decision)` receives
`undefined`; if `isP3Pipeline` is not null-safe this becomes a crash or
wrong label.

### Evidence

`data.ts:331` destructures `color_pipeline_decision: _omitColorPipelineDecision`
out of `adminSelectFields` before forming `publicSelectFieldCore`, confirming
the field is ABSENT from `publicSelectFields`.

`data.ts:414`: `PrivacySensitiveKeys` includes `'color_pipeline_decision'`
and the compile-time guard at `data.ts:416-417` (`_SensitiveKeysInPublic
extends never`) enforces this at `tsc`. No runtime check needed.

`color-pipeline-decisions.ts:60-64`:
```
export function isP3Pipeline(
    decision: ColorPipelineDecision | string | null | undefined,
): boolean {
    if (!decision) return false;
    return decision.startsWith('p3-from-');
}
```
Signature accepts `null | undefined`; early return on falsy. Passing
`undefined` (the JS value for an absent key) returns `false` — no crash,
correct SDR label shown.

`color-primaries.ts:46-48`: `isWideGamutPrimary` guards `if (!p) return
false` identically.

`photo-viewer.tsx:176`: `downloadHref` is set only if
`image?.filename_jpeg` is truthy. `photo-viewer.tsx:177`:
`avifDownloadHref` is set only if `image?.filename_avif` is truthy.
Both `filename_jpeg` and `filename_avif` are confirmed present in
`publicSelectFields` (they are in `adminSelectFields` at lines 211-213 and
are NOT in the destructured-omit block at lines 323-351).

`photo-viewer.tsx:927-934`: the AVIF download branch is gated on
`isWideGamutSource && avifDownloadHref` before rendering; `isP3Pipeline`
is only called to choose a label string, not to gate rendering.

`getImage` (`data.ts:954-976`) selects `...publicSelectFields` plus
`blur_data_url` and `topic_label`. `getImageCached = cache(getImage)`
(`data.ts:1606`). The photo viewer page (`p/[id]/page.tsx:58,145`) calls
`getImageCached`. No admin field escapes.

### Verdict: CLEAN

No admin-data leak. No crash path. `isP3Pipeline(undefined) === false`
produces "Download JPEG" label on non-wide-gamut public images — correct.

---

## FLOW-B: Originals leak via HTTP (privacy)

### Hypothesis

H-B1 (leading): The private `data/uploads/original/` tree is unreachable
over HTTP through all three serving paths (nginx, Next.js static,
`serve-upload.ts` route handler).

H-B2 (candidate): A `public/uploads/original/` legacy directory exists
(confirmed: `ls` shows the subdirectory); if files were placed there, the
Next.js static server would serve them because Next resolves `public/`
before route handlers, bypassing `ALLOWED_UPLOAD_DIRS`.

### Evidence

Three independent defences, applied in order:

1. **nginx** (`nginx/default.conf:163-165`):
   ```
   location ^~ /uploads/original/ {
       return 404;
   }
   ```
   The `^~` prefix wins over the regex image-serving location below it,
   so nginx 404s every request to `/uploads/original/` before it reaches
   Next.js. This is the outermost and most reliable guard.

2. **`serve-upload.ts:15,138`**: `ALLOWED_UPLOAD_DIRS = new Set(['jpeg',
   'webp', 'avif'])`. The route handler 404s any path where `topLevelDir`
   is not in that set. However, this handler only executes when Next.js
   does NOT serve the file statically — i.e. when the file is absent from
   `public/`. If a file existed in `public/uploads/original/`, Next's
   static server would serve it BEFORE the route handler.

3. **`instrumentation.ts:3-4`**: `assertNoLegacyPublicOriginalUploads({
   failInProduction: true })` runs at startup and throws if any file
   exists in `LEGACY_UPLOAD_DIR_ORIGINAL` (`public/uploads/original/`),
   crashing the server in production before it can serve requests.

4. **`migrate.js:58-95`**: `migrateLegacyOriginalUploads` moves any files
   from the old public location to the private `data/uploads/original/`
   directory at every deploy, then `assertLegacyOriginalUploadsCleared`
   confirms the directory is empty in production (`NODE_ENV=production`).

5. **`UPLOAD_DIR_ORIGINAL`** (`upload-paths.ts:40`) resolves to
   `UPLOAD_ORIGINAL_ROOT` which defaults to `data/uploads/original/` —
   entirely outside `public/`. Confirmed separate from `UPLOAD_ROOT`
   (`public/uploads/`).

**Local state**: `public/uploads/original/` exists but contains 0 files.

H-B2 is refuted by the nginx `return 404` (nginx-level, cannot be
bypassed from the browser), the startup assertion (crashes server before
serving), and the migrate-time evacuation. The directory structure is a
remnant of the legacy layout with no files in it.

### Verdict: CLEAN

Three independent mechanisms prevent serving originals. Nginx is the
outermost gate and the only one that matters for actual HTTP clients.

---

## FLOW-C: Migration on an existing DB

### Hypothesis

H-C1 (leading): `prepareLegacyDatabaseIfNeeded` + `runMigrations` together
handle the known non-monotonic journal (idx 7-17 land in 2025, idx 6 in
2026-05), baseline correctly, and the post-condition assertion catches any
drizzle silent-skip.

H-C2 (alternative): The non-monotonic `when` at idx 7
(`1746144000000`, 2025-05-02) less than idx 6 (`1778304060000`, 2026-05-09)
makes drizzle's `MAX(created_at)` cursor skip idx 7-17 even after the
per-entry baseline, causing the post-condition to throw on every deploy.

### Evidence

`getAllJournalMigrations` (`migrate.js:144-160`) reads every journal entry
and computes a SHA-256 hash of each SQL file. It does NOT use `when` for
any logic — it only stores `folderMillis: entry.when` for the INSERT.

`baselineAllJournalMigrations` (`migrate.js:658-680`) inserts one
`__drizzle_migrations` row per journal entry with `created_at =
entry.when`. For idx 7 the row has `created_at = 1746144000000` (2025).

`runMigrations` calls `drizzle.migrate()` which uses `MAX(created_at)` as
its cursor. After the per-entry baseline the table's `MAX(created_at)` is
`1782000000000` (idx 23, 2023-09 in the `when` field — actually the
highest numeric value). Drizzle will then check whether any journal entry's
`folderMillis > MAX(created_at)`. For idx 7-17 this is false (their whens
are 2025 < MAX). They were already baseline-inserted, so drizzle's hash
check short-circuits them as applied — the cursor comparison only triggers
apply for entries NOT yet in the table.

Post-condition (`migrate.js:723-732`) then checks `recordedHashes` — the
full set of hashes in `__drizzle_migrations` — against every journal entry.
Because `baselineAllJournalMigrations` already inserted every hash, the
`missing` array is empty and no exception is thrown.

Journal `when` monotonicity for 0023: confirmed.
```
idx=22 tag=0022_image_embeddings_model_version_idx when=1781687094232
idx=23 tag=0023_remove_paid_downloads when=1782000000000
```
`1782000000000 > 1781687094232` — strictly greater.

H-C2 is refuted. The historical non-monotonicity is structural in the
journal but the per-entry-hash baseline approach is immune to it — drizzle
never needs to re-apply already-baselined entries regardless of their
`created_at` values.

One nuance verified: `prepareLegacyDatabaseIfNeeded` checks
`journalCovered` (`migrate.js:698-703`) — if ALL hashes are already
present it returns early without calling `reconcileLegacySchema`. This
is the normal fast path for an up-to-date production deployment. A new
migration (idx 24+) will have a hash NOT in the table, triggering the
reconcile+baseline path, then `drizzle.migrate()` applies the new SQL
(its `folderMillis` will be > current `MAX(created_at)` assuming the
`when` rule is followed), and the post-condition verifies the new hash
is recorded.

### Verdict: CLEAN

---

## FLOW-D: ETag / cache invalidation on color-setting flip

### Hypothesis

H-D1: The serve-upload path (`serve-upload.ts`) gets a new ETag within
≤5s+one-refresh of a setting change; the Next.js static path does NOT
invalidate until a re-encode rewrites the file mtime. Both behaviours are
correctly documented as CRT-D1.

H-D2: `COLOR_IMPACTING_KEYS` in `settings-hash.ts` is missing a key that
actually changes derivative bytes, silently producing stale cached images.

### Evidence

`settings-hash.ts:42-56`: `COLOR_IMPACTING_KEYS` contains 9 entries:
`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`,
`force_srgb_derivatives`, `wide_gamut_max_source_pixels`,
`image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`,
`image_sizes`. The compile-time guard `_ColorKeysAreSettingKeys`
(`settings-hash.ts:63-65`) ensures every string is a valid
`GallerySettingKey`.

`serve-upload.ts:214-215`: ETag = `W/"v${IMAGE_PIPELINE_VERSION}-
${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`.
`settingsHash` is produced by `getServingColorSettingsHash()` which caches
for 5s with stale-while-revalidate.

`next.config.ts:68-74`: the `headers()` rule covers
`/uploads/:format(jpeg|webp|avif)/:file*` — sets `Cache-Control: public,
max-age=3600, must-revalidate`. This applies to the static-path responses;
the ETag on the static path is Next's own `W/"{size-hex}-{mtime-hex}"` form
which does NOT include the settings hash.

CRT-D1 is accurately stated: a color-setting flip invalidates the
serve-upload ETag but not the static-path ETag until re-encode. This is an
acknowledged operational caveat, not a bug.

H-D2: reviewing all admin settings that drive derivative byte changes
against `COLOR_IMPACTING_KEYS`:
- `force_srgb_derivatives` — in list
- `wide_gamut_jpeg_chroma` / `sdr_jpeg_chroma` — in list
- `avif_effort` — in list
- `image_quality_webp/avif/jpeg` — in list
- `image_sizes` — in list
- `wide_gamut_max_source_pixels` — in list (changes which sources get
  downscaled before encode)
- `allow_hdr_ingest` — this gates upload rejection but does NOT change
  bytes of already-processed derivatives; correct to exclude.
- `strip_gps_on_upload` — changes the original, not derivatives; correct
  to exclude.
- `image_quality_jpeg` / `avif_effort` — already confirmed present.

No missing byte-impacting key found. H-D2 refuted.

### Verdict: CLEAN

CRT-D1 caveat accurately stated in CLAUDE.md. No silent invalidation gap.

---

## FLOW-E (chosen): `buildDownloadFilename` / download `<a download>` attribute

This flow was selected because it takes user-controlled admin-entered
`title` strings and emits them as a browser `download` attribute. A
malformed or adversarially crafted title could inject path separators,
cause filename collisions, or produce cross-platform issues.

### Hypothesis

H-E1 (leading): `slugifyTitle` fully sanitises the title before it
reaches the `download` attribute — path separators, shell metacharacters,
control bytes, and bidi chars are all stripped.

H-E2 (alternative): The `download` attribute on an `<a>` element is
client-side only; the browser enforces its own filename sanitisation. Even
if `slugifyTitle` had a gap, no server-side file is created and the
worst-case outcome is an ugly filename in the user's Downloads folder.

### Evidence

`download-filename.ts:37-67` (`slugifyTitle`):

1. Unicode bidi / zero-width chars stripped via `UNICODE_FORMAT_CHARS`
   regex (imported from `validation.ts`, same regex used for DB field
   validation).
2. C0/C1 control bytes stripped (`/[\x00-\x1F\x7F-\x9F]/g`).
3. NFKD + diacritic strip for accented Latin.
4. Lowercase.
5. `[^a-z0-9]+` replaced with `-` — path separators (`/`, `\`), shell
   metacharacters, whitespace all become `-`.
6. Repeated `-` collapsed, leading/trailing trimmed.
7. Cap at 60 chars, trailing `-` trimmed.

`download-filename.ts:70-78` (`buildDownloadFilename`):
- `cleanExt = ext.replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g,
  '')` — extension sanitised to `[a-z0-9]` only.
- `idPart = String(id).replace(/[^0-9]/g, '')` — id stripped to digits.
- Output: `${slug}-${idPart}.${cleanExt}` or `photo-${idPart}.${cleanExt}`.

A title of `../../../etc/passwd` becomes `etc-passwd-{id}.jpg` after the
`[^a-z0-9]+→-` step. A title of `foo/bar` becomes `foo-bar-{id}.jpg`.
No path component can survive into the output.

H-E2 is also true as belt-and-braces: the HTML `download` attribute is
a suggested filename hint to the browser, never a server path. Modern
browsers further sanitise `download` values (strip path separators). The
sanitisation in `slugifyTitle` makes the hint clean before it even reaches
the browser.

The only edge case: a CJK-only title slugifies to empty and falls back to
`photo-{id}.{ext}`. This is intentional and documented.

### Verdict: CLEAN

Both the application-layer sanitisation and the browser's own `download`
attribute semantics prevent any harmful path construction.

---

## Synthesis

### Hypothesis Table

| Flow | Hypothesis | Confidence | Evidence Strength | Verdict |
|------|-----------|------------|-------------------|---------|
| A | No admin leak, no crash in download UI | High | Strong (compile-time guard + null-safe helpers + field set verified) | CLEAN |
| B | `data/uploads/original/` unreachable via HTTP | High | Strong (nginx `return 404` + startup assertion + migrate evacuation) | CLEAN |
| C | Migration handles non-monotonic journal; 0023 monotonic | High | Strong (per-entry hash baseline immune to cursor; `when` diff verified) | CLEAN |
| D | CRT-D1 accurately stated; no missing byte-impacting key | High | Strong (9-key list cross-checked against all derivative-affecting settings) | CLEAN |
| E | `buildDownloadFilename` fully sanitises user-controlled title | High | Strong (step-by-step sanitisation verified; path separator eliminated) | CLEAN |

### Rebuttal Round

The only candidate that warranted close attention was H-B2: the
`public/uploads/original/` directory physically exists on disk. If an
operator had placed original files there without running migrate.js, the
Next.js static server would serve them and neither `serve-upload.ts` nor
the `ALLOWED_UPLOAD_DIRS` check would run. However, three mitigations
collapse this: (1) nginx `location ^~ /uploads/original/ { return 404; }`
is at the outermost layer and cannot be bypassed; (2) `instrumentation.ts`
crashes the Node process before accepting traffic if any file exists there
in production; (3) `migrate.js` evacuates files at deploy time. The threat
model requires the operator to bypass all three independently. Refuted.

### Current Best Explanation

All five flows are clean. The code paths are well-defended and the
compile-time guards (privacy, color-key) catch regressions before runtime.
The one structural fact worth noting — `public/uploads/original/` exists as
an empty directory — is benign given the nginx block, but could confuse a
future developer who modifies the nginx config without understanding the
legacy migration context.

### Critical Unknown

None identified that would change any verdict. The closest open question
is whether a production instance that had files in `public/uploads/original/`
before the `assertNoLegacyPublicOriginalUploads` startup check was introduced
could have survived the check (e.g. the check was added after migration, so
files were already moved). This is not a current-codebase concern — it is
an operational history question that has no bearing on code in HEAD.

### Discriminating Probe

If a follow-on reviewer wishes to falsify FLOW-B further: run
`assertNoLegacyPublicOriginalUploads({ failInProduction: true })` against
a production container and verify it passes with 0 files found. This is the
only remaining empirical check not already covered by static analysis.

### Uncertainty Notes

- All analysis is static. Runtime behavior on the production host (file
  counts, nginx version, exact drizzle-orm version in use) was not
  directly inspected.
- `drizzle.migrate()` internal logic (hash short-circuit vs cursor check
  precedence) was inferred from the documented behavior in CLAUDE.md and
  migrate.js comments, not from reading the drizzle-orm source directly.
  The post-condition assertion in `runMigrations` provides a runtime
  safety net for any discrepancy.

---

**Zero new findings. All five flows trace CLEAN.**
