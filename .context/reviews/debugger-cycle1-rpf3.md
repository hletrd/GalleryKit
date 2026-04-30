# debugger — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Latent bug surface in the data path and UI surfaces touched.

## Findings

### D-1 (High, High confidence) — `tag_names` returns null silently with no error path

- File: `apps/web/src/lib/data.ts:324, 374`
- The correlated subquery either fails MySQL parsing (caught by Drizzle
  and returned null), executes but joins zero rows due to alias
  collision, or is dropped by query rewriter. No exception thrown.
  Production logs have no error to grep for.
- Detection: enable Drizzle query logging
  (`{ logger: true }` in `apps/web/src/db/index.ts`) and inspect
  compiled SQL.
- Fix: switch to LEFT JOIN + Drizzle column refs (matches `getImages`).
  Add regression test (TE-2).

### D-2 (Low, Medium confidence) — Lightbox auto-hide timer interaction with focus

`lightbox.tsx:124-130` checks `dialogRef.current?.contains(document.
activeElement)`. Existing logic correct; size change to `h-11 w-11` has
zero impact.

### D-3 (Low, Medium confidence) — `loadMore` `loadingRef` reset on `queryKey` change

`load-more.tsx:67-75` correctly increments `queryVersionRef` and
discards in-flight loads on query change. Size change has zero impact.

### D-4 (Low, Low confidence) — Admin login button `w-full h-11` interaction with `disabled={isPending}`

Pure visual change. No bug.

## Verdict

Only D-1 is a real bug. Others are tracking-only.
