# code-reviewer — Cycle 3 (HEAD `839d98c`, 2026-04-26)

## Inventory & method

Spawned inline (Task spawn-agent unavailable in this catalog). Walked
`apps/web/src/**` (219 ts/tsx files, 64 tests), with focus on the cycle-2
RPF deltas: `lib/blur-data-url.ts`, `__tests__/touch-target-audit.test.ts`,
`lib/data.ts` (`tagNamesAgg`), `components/photo-viewer.tsx`.

## Findings

### CR3-MED-01 — touch-target audit FORBIDDEN regex line-bounded; misses every multi-line `<Button size="icon">`

- **Files:** `apps/web/src/__tests__/touch-target-audit.test.ts:191-231` (regex), `apps/web/src/__tests__/touch-target-audit.test.ts:254-272` (`scanFile` per-line walker)
- **Confidence:** **High** (verified with grep against the codebase)
- **Severity:** Medium

The audit walks files line by line and runs the FORBIDDEN regex against
each line in isolation. The patterns require `<Button`, `size="icon"`,
and the className override to all live on the same `\n`-delimited line.
In practice the codebase formats `<Button>` openings across 4-7 lines
(Prettier default for JSX with multiple props), e.g.
`apps/web/src/components/upload-dropzone.tsx:404-413` opens `<Button` on
405, `size="icon"` on 407, `className="...h-6 w-6..."` on 408 — a 24 px
destructive control on every uploaded preview that the audit cannot see.

Same false-negative covers `admin-user-manager.tsx:142-150`,
`topic-manager.tsx:156, 221, 224`, `tag-manager.tsx:88, 109, 112`,
`settings-client.tsx:77`, `seo-client.tsx:76`, `search.tsx:150-164,
222-232`, `photo-navigation.tsx:212, 226`. The cycle-2 fix that hardened
the `KNOWN_VIOLATIONS` map is correct but operates on a regex that scans
nothing for these files; the present `KNOWN_VIOLATIONS = 1/3/4` counts
match scanned counts only because they happen to coincide with the
single-line single-line single-line violations the regex CAN see.

**Failure scenario:** a contributor adds a new single-line
`<Button size="icon">` in admin-user-manager. The audit reports zero new
violations because the file's KNOWN count of 1 (delete button) was
inflated by a single-line bump while the multi-line delete is invisible
— the math underflows and the new violation hides.

**Fix path:** before scanning, normalize multi-line `<Button>` /
`<button>` JSX expressions into a single logical line by joining lines
inside the JSX opening tag. Cheapest implementation:
`source.replace(/<(Button|button)\b([^>]*?)>/gs, m => m.replace(/\s+/g, ' '))`
applied before line-splitting. Then re-baseline `KNOWN_VIOLATIONS` with
the new true-positive set.

### CR3-LOW-01 — `assertBlurDataUrl` warn fires unbounded on every page load when DB row holds invalid value

- **File:** `apps/web/src/lib/blur-data-url.ts:58-75`
- **Confidence:** Medium / **Severity:** Low

If a DB-restored row has a non-conforming `blur_data_url`, the warn
fires once per `getImage()` call (route is `revalidate = 0`). Sustained
traffic to a single broken image saturates the log. Per-id throttle
(LRU of "already warned tuples") would address it.

### CR3-LOW-02 — `data-tag-names-sql.test.ts` "Drizzle .toSQL() output" sub-test does nothing

- **File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts:140-156`
- **Confidence:** High / **Severity:** Low

The test's docstring promises to verify `.toSQL()` output, but the body
only asserts that the three exported functions are typed as `function`.
Either build the query and call `.toSQL()` for real (Drizzle supports
this without a live DB), or drop the placeholder.

## Verdict

1 NEW MEDIUM, 2 NEW LOW. Cycle-2 touch-target hardening shipped a
correct accounting layer on top of an under-powered scanner; widening
the scanner is the next iteration.
