# Plan 104 — Cycle 38 Fixes

**Created:** 2026-04-19 (Cycle 38)
**Status:** DONE

---

## Scope

Addresses findings from the Cycle 38 aggregate review (`_aggregate-cycle38.md`).

### C38-01: `removeTagFromImage` removes by slug, not by exact tag name [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/tags.ts` lines 159-181
- **Fix:** Change `removeTagFromImage` to look up by exact name first (`eq(tags.name, cleanName)`), then fall back to slug lookup only if no exact name match is found. This prevents removing the wrong tag when slug collisions exist.
- **Implementation:**
  1. In `removeTagFromImage`, first query `tags` by `eq(tags.name, cleanName)`.
  2. If found, use that tag's ID for deletion.
  3. If not found, fall back to slug-based lookup (current behavior).
  4. Add a test case or verify manually with slug collision scenario.

### C38-02: Dead GPS display code in public PhotoViewer [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/photo-viewer.tsx` lines 470-483
- **Fix:** Add a clear comment block explaining that GPS coordinates are unreachable in the current query path because `selectFields` (used by `getImage`) excludes `latitude` and `longitude`. This preserves the code structure for potential future admin-only GPS display while preventing confusion.
- **Implementation:**
  1. Add a comment above the GPS display block explaining it's currently unreachable from public queries.
  2. No code removal needed — the dead code is harmless and the compile-time privacy guard prevents accidental inclusion.

### C38-03: Upload dropzone file removal button only visible on hover (touch accessibility) [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/upload-dropzone.tsx` lines 288-295
- **Fix:** Make the removal button always visible on small screens (no hover capability), keep hover-to-reveal on larger screens.
- **Implementation:**
  1. Change `opacity-0 group-hover:opacity-100 focus:opacity-100` to `sm:opacity-0 sm:group-hover:opacity-100 opacity-100 focus:opacity-100`.
  2. This makes the button always visible on mobile (no hover state) and hover-to-reveal on desktop.

### C38-04: Back-to-top button accessible when invisible [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/home-client.tsx` lines 334-348
- **Fix:** Add `aria-hidden` and `tabIndex` based on visibility state.
- **Implementation:**
  1. Add `aria-hidden={showBackToTop ? undefined : true}` to the button.
  2. Add `tabIndex={showBackToTop ? 0 : -1}` to the button.

### C38-05: Image manager select-all checkbox lacks indeterminate state [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/image-manager.tsx` lines 293-300
- **Fix:** Add a ref to the checkbox and set `indeterminate` property in an effect when some but not all images are selected.
- **Implementation:**
  1. Add `useRef<HTMLInputElement>(null)` for the select-all checkbox.
  2. Add a `useEffect` that sets `ref.current.indeterminate = selectedIds.size > 0 && selectedIds.size < images.length`.
  3. Attach the ref to the checkbox input element.

---

## Not In Scope (Deferred)

See Plan 105 (deferred carry-forward) for items not addressed this cycle.

## Gate Checks

After all changes:
- [x] `eslint` passes
- [x] `next build` succeeds
- [x] `vitest` passes (66/66 tests)
- [x] `tsc --noEmit` passes

## Completion Notes

All 5 fixes implemented, committed (5 GPG-signed commits), pushed, and deployed successfully.

### C38-01: DONE
- `removeTagFromImage` now queries by exact tag name first, falling back to slug only when no name match is found.
- Commit: `00000005fff35065ec2861003094d47d4376c7ae`

### C38-02: DONE
- Added comment block above GPS display code explaining it's unreachable from public queries.
- Commit: `00000003c3df3628258e09df8a7cf35b8822fbd8`

### C38-03: DONE
- Upload dropzone file removal button now always visible on mobile, hover-to-reveal on desktop.
- Commit: `000000077f29e755edfa4b40f6ed970c126370e6`

### C38-04: DONE
- Back-to-top button now hidden from screen readers and keyboard navigation when invisible.
- Commit: `000000009aed981a6c9db6b85828cee0c96b6f73`

### C38-05: DONE
- Select-all checkbox now shows indeterminate state when some (but not all) images are selected.
- Commit: `0000000cf3721c17fde1549d833117534d443533`
