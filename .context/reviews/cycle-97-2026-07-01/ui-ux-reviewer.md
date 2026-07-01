# Cycle 97 UI / UX / Accessibility Review

Scope: deployed `master` at `061c1c81af234469641f75a53e5bbc61fa63114a`.

## Findings

### C97-04 - Grid P3 badges render but never become visible

- Severity/confidence: Medium / High.
- Evidence: `apps/web/src/components/home-client.tsx:387` renders `.gamut-p3-badge`; `apps/web/src/app/[locale]/globals.css:152` hides that class until root `data-display-gamut` is `p3` or `rec2020`; `apps/web/src/components/photo-viewer.tsx:337`-`345` was the only root `data-display-gamut` setter and it unsets on unmount. Grid pages pass only `config.imageSizes` into `HomeClient`, for example `apps/web/src/app/[locale]/(public)/page.tsx:233`.
- Failure scenario: wide-gamut thumbnails on home/topic/smart collection pages expose badge markup and accessible labels but stay visually hidden on P3 displays. The admin `force_show_color_chips` demo override also cannot affect grid badges.
- Suggested fix: wire `HomeClient` to `useDisplayCapability`, set the root gamut/force-show attributes while grid pages are mounted, pass `config.forceShowColorChips`, and lock with source-contract coverage.

## Residual Risks

Existing broader mobile admin navigation, image-management, zoom/pan, and form-error UX findings remain in the deferred register.
