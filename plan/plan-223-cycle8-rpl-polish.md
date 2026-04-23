# Plan 223 — Cycle 8 RPL polish

**Status:** COMPLETE (implemented in cycle-8-rpl loop). See section
"Implementation status" at the bottom for per-task resolution.

**Source review:** `.context/reviews/_aggregate-cycle8-rpl.md`

**Scope:** address the cross-agent-agreed LOW-severity findings and
the HIGH-confidence documentation/polish items. All changes are
scoped to a single implementation pass.

**Repo rule alignment:** commits must be GPG-signed (`-S` flag),
use Conventional Commits + gitmoji, no `--no-verify`, no
force-push to master, fine-grained per-fix commits, and must run
`~/flash-shared/gitminer-cuda/mine_commit.sh 7` after each commit
to mine the 7-leading-hex-zero prefix. Always `git pull --rebase`
before `git push`.

## Tasks

### T8R-01 — Extend CSV defense to strip zero-width characters [AGG8R-01, LOW, HIGH, 5-agent agreement]

**File:** `apps/web/src/lib/csv-escape.ts:26-30`

**Problem:** current bidi-strip regex `[‪-‮⁦-⁩]`
covers U+202A-202E and U+2066-2069 only. Zero-width characters
(U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM, U+2060 WJ,
U+180E MVS) are NOT covered. A field starting with `​=HYPERLINK(...)`
bypasses the formula-prefix guard because JS regex `\s` does not
match U+200B.

**Fix:** extend the Unicode-strip regex to include:
- U+200B-200F (zero-width space, ZWNJ, ZWJ, LRM, RLM)
- U+202A-202E (bidi overrides, existing)
- U+2060-2064 (word joiner, function application, invisible ops)
- U+2066-2069 (bidi isolates, existing)
- U+FEFF (byte-order mark)
- U+180E (Mongolian vowel separator)
- U+FFF9-FFFB (interlinear annotation anchors)

Combine into a single regex pass.

**Test:** add fixtures to `csv-escape.test.ts`:
- `​=HYPERLINK("evil")` → `"'=HYPERLINK(""evil"")"` (ZWSP stripped + formula prefixed)
- `﻿=SUM(A1)` → `"'=SUM(A1)"` (BOM stripped + formula prefixed)
- `⁠=cmd` → `"'=cmd"` (word joiner stripped + formula prefixed)
- `‌hello` (ZWNJ only, no formula) → `"hello"` (stripped, no prefix)

**Expected commit:** `fix(csv): 🛡️ strip zero-width chars to close formula-injection bypass (C8R-RPL-01)`

### T8R-02 — Pre-register upload tracker entry to close first-insert race [AGG8R-02, LOW, HIGH, 5-agent agreement]

**File:** `apps/web/src/app/actions/images.ts:127-176`

**Problem:** when `uploadTracker.get(uploadIp)` returns undefined,
two concurrent requests each create their own fresh object and
both pass the cumulative-limit check before either `set()`s.

**Fix:** immediately set the tracker BEFORE the first await if
the entry doesn't exist. Use an atomic check-and-set on the Map:

```ts
let tracker = uploadTracker.get(uploadIp);
if (!tracker) {
    // Claim the slot BEFORE any await so concurrent requests share the reference.
    tracker = { count: 0, bytes: 0, windowStart: now };
    uploadTracker.set(uploadIp, tracker);
}
```

All subsequent reads of `tracker` are on the shared reference, so
the first-insert race is closed.

**Test:** add a fixture in `images-actions.test.ts` that mocks two
concurrent `uploadImages` calls against the same IP with no prior
tracker, verifies only one tracker entry exists post-call, and
verifies cumulative counts reflect both claims.

**Expected commit:** `fix(upload): 🩹 pre-register tracker entry to close first-insert race (C8R-RPL-02)`

### T8R-03 — Document custom lint gates in CLAUDE.md [AGG8R-06, LOW, HIGH]

**File:** `CLAUDE.md` "Lint Gates (security-critical)" section.

**Status:** already documented. Verified during cycle-8 implementation
— the "Lint Gates (security-critical)" section of `CLAUDE.md`
(lines 227-242) already describes both `lint:api-auth` and
`lint:action-origin` with exact semantics, auto-exempt rules, and
fixture locations. The AGG8R-06 finding was based on an inspection
of only the "Testing" section without reading the following
section. No additional action required.

### T8R-04 — Narrow `cleanOrphanedTmpFiles` catch to ENOENT [AGG8R-08, LOW, HIGH]

**File:** `apps/web/src/lib/image-queue.ts:48-50`

**Problem:** broad `catch {}` silences EACCES, EIO, EMFILE as well
as the intended ENOENT. Operator logs lack the signal.

**Fix:**
```ts
} catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : null;
    if (code === 'ENOENT') {
        return;
    }
    console.warn(`[Cleanup] Failed to scan ${dir} for orphaned .tmp files:`, err);
}
```

**Expected commit:** `fix(queue): 🩹 log non-ENOENT errors from cleanOrphanedTmpFiles (C8R-RPL-04)`

### T8R-05 — Drop unreachable `\t` from CSV formula-prefix regex [AGG8R-10, LOW, HIGH]

**File:** `apps/web/src/lib/csv-escape.ts:35`

**Problem:** `\t` in `/^\s*[=+\-@\t]/` is dead code because the
control-char strip (line 25) removes `\x09` (tab) before the
formula-prefix check sees it.

**Fix:** remove `\t` from the character class → `/^\s*[=+\-@]/`.
Add a comment noting tab is pre-stripped.

Alternative: keep `\t` for defense-in-depth and add a comment
explaining why it's unreachable. Choose per code quality
preference — first option aligns with "dead code should be
removed".

Either way, the regex semantics don't change for any realistic
input.

**Expected commit:** `refactor(csv): ♻️ drop unreachable \t from formula-prefix regex (C8R-RPL-05)`

### T8R-06 — Document advisory-lock DB-server scoping in CLAUDE.md [AGG8R-05, LOW, MEDIUM, 2-agent]

**File:** `CLAUDE.md` "Race Condition Protections" section.

**Fix:** add a line under the existing advisory-lock bullet:

```md
Advisory-lock names (`gallerykit_db_restore`, `gallerykit:image-processing:*`,
`gallerykit_topic_route_segments`, `gallerykit_admin_delete`) are
scoped to the MySQL SERVER, not to a single database. Running
multiple GalleryKit instances against one shared MySQL server will
serialize restores, topic-rename, and image-processing across
instances. Run one GalleryKit per MySQL server; or prefix lock
names with a per-instance identifier for multi-tenant deployments.
```

**Expected commit:** `docs(claude): 📝 document advisory-lock DB-server scoping (C8R-RPL-06)`

### T8R-07 — Mention bidi & zero-width strip in CLAUDE.md Security Architecture [AGG8R-07, LOW, LOW]

**File:** `CLAUDE.md` "Database Security" section.

**Fix:** expand the CSV bullet to:

```md
CSV export escapes formula injection characters (`=`, `+`, `-`, `@`),
strips C0/C1 control characters, strips Unicode bidi override
characters (U+202A-202E, U+2066-2069) to prevent Trojan-Source
visual reordering, and strips zero-width characters (U+200B-200F,
U+2060, U+FEFF, U+180E) to prevent invisible-character formula
bypass. See `apps/web/src/lib/csv-escape.ts` for the full regex.
```

**Expected commit:** `docs(claude): 📝 document CSV bidi + zero-width strips (C8R-RPL-07)`

### T8R-08 — Reorganize plan-222 so AGG7R-05 is not in deferred heading [AGG8R-18, LOW, HIGH]

**File:** `plan/plan-222-cycle7-rpl-deferred.md:17-23`

**Problem:** AGG7R-05 sits under the "Deferred findings" heading
but its status says "NOT deferred (see plan-221)". Inconsistent
org.

**Fix:** move AGG7R-05 out of the "Deferred findings" list into a
short "Implemented (for provenance — see plan-221)" section at the
top of the deferred file, or remove it entirely since plan-221 is
the canonical record.

**Expected commit:** `docs(plan): 📝 reorganize plan-222 so AGG7R-05 isn't under deferred heading (C8R-RPL-08)`

### T8R-09 — Convert RELEASE_LOCK early-return `.catch(() => {})` to debug log [AGG8R-03, LOW, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:279, 298`

**Problem:** silent catches swallow DB errors on lock release.

**Fix:** both sites:
```ts
await conn.query("SELECT RELEASE_LOCK('gallerykit_db_restore')")
    .catch((err) => console.debug('RELEASE_LOCK failed:', err));
```

**Expected commit:** `fix(restore): 🩹 log RELEASE_LOCK catch instead of silencing (C8R-RPL-09)`

## Implementation order

1. T8R-01 (zero-width CSV strip — security, 5-agent agreement)
2. T8R-02 (upload-tracker first-insert race — security, 5-agent agreement)
3. T8R-03 (docs lint gates — no code risk)
4. T8R-04 (cleanOrphanedTmpFiles narrow catch — correctness)
5. T8R-05 (csv \t dead code — cleanup)
6. T8R-06, T8R-07 (docs)
7. T8R-08 (plan reorg)
8. T8R-09 (RELEASE_LOCK log)

One commit per task. Mine each commit with
`~/flash-shared/gitminer-cuda/mine_commit.sh 7` after signing.
Use `git pull --rebase` before `git push`.

## Gate policy

After all tasks land:
- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run build --workspace=apps/web` (includes tsc type-check)
- `npm run test:e2e --workspace=apps/web` (best-effort)

All gates must be green before `npm run deploy`.

## Implementation status (cycle-8-rpl loop, 2026-04-23 → 2026-04-24)

| Task | Status | Commit (mined) |
|---|---|---|
| T8R-01 (zero-width CSV strip) | done | `00000000566e9419` |
| T8R-02 (upload tracker pre-register) | done | `0000000aa1b7c114` |
| T8R-03 (docs lint gates) | no-op (already documented in CLAUDE.md lines 227-242) | — |
| T8R-04 (cleanOrphanedTmpFiles narrow catch) | done | `00000001bea32e17` |
| T8R-05 (drop unreachable \t) | done (rolled into T8R-01 commit) | `00000000566e9419` |
| T8R-06 (docs advisory-lock DB scoping) | done | `00000005fc427c92` |
| T8R-07 (docs CSV defense layers) | done | `00000000fff7ca10` |
| T8R-08 (plan-222 reorg AGG7R-05) | done | `0000000b5695b7ba` |
| T8R-09 (RELEASE_LOCK debug log) | done | `00000002e40efe50` |
