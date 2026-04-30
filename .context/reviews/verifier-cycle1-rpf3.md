# verifier — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Verify designer-v2 findings against file evidence on disk.

## Per-finding verification

### V-1 — NF-1 admin form submit + toggle below 44 px → CONFIRMED

- File: `apps/web/src/app/[locale]/admin/login-form.tsx`
- Line 102: `<Button type="submit" className="w-full" disabled={isPending}>`
- Line 84: `className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex
  items-center justify-center w-9 h-9 rounded-md ..."`
- shadcn `Button` default size is `h-9 px-4 py-2` per
  `apps/web/src/components/ui/button.tsx:24`. Submit = 36 px tall. Toggle
  = 36 px (w-9 h-9).

### V-2 — NF-2 LightboxTrigger 32 px → CONFIRMED

- File: `apps/web/src/components/lightbox.tsx:41`
- Explicit `h-8 w-8` = 32×32.

### V-3 — NF-2 desktop Info sidebar toggle 32 px → CONFIRMED

- File: `apps/web/src/components/photo-viewer.tsx:314-328`
- `size="sm"` maps to `h-8 px-3` per shadcn button.tsx — 32 px tall.

### V-4 — NF-3 tag_names returns null → CONFIRMED

- File: `apps/web/src/lib/data.ts:324, 374`
- Raw-string aliases `it`, `t`, `it.tag_id`, `it.image_id`, `t.id`,
  `t.name` are problematic in Drizzle `sql` template combined with
  `COUNT(*) OVER()` window function on the outer SELECT. The working
  `getImages` at line 398-410 uses LEFT JOIN + Drizzle column refs.

### V-5 — NF-4 nav topic links 32 px → CONFIRMED

- File: `apps/web/src/components/nav-client.tsx:119`
- `py-1.5` × 2 + ~20 px line-height = 32 px.

### V-6 — NF-5 Load More button 36 px → CONFIRMED

- File: `apps/web/src/components/load-more.tsx:102`
- Default `<Button>` = h-9 = 36 px.

### V-7 — NF-6 site title 28 px → CONFIRMED

- File: `apps/web/src/components/nav-client.tsx:78`
- `text-xl` line-height ~28 px, no min-height.

### V-8 — F-10 partial: blur placeholder absent → CONFIRMED

- File: `apps/web/src/components/photo-viewer.tsx:346`
- `skeleton-shimmer` class present, no `style={{backgroundImage:
  url(${image.blur_data_url})}}`.

### V-9 — F-19 partial: scroll affordance unchanged → CONFIRMED

- File: `apps/web/src/components/nav-client.tsx:103-109`
- Mask-gradient present, no scroll-snap or visible chevron.

### V-10 — F-23 partial: blur fetched but not wired → CONFIRMED

- `data.ts:449,619` — `blur_data_url` included in `getImage()`.
- `photo-viewer.tsx` doesn't consume it.

## Verifier verdict

All 10 designer-v2 findings cross-checked against file evidence; all
confirmed.
