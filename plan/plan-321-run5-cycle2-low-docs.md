# Plan 321 — LOW + doc items (Run-5 Cycle 2)

**Source:** `.context/reviews/run5-cycle2/_aggregate.md`. Original severities preserved (4 MED doc-only items live here per plan-316 precedent; they are still MED).

## Unit A — CLAUDE.md truth pass (one commit)

| Finding | Sev | Edit |
|---|---|---|
| AGG-R5C2-20 / DOC-R5C2-02 | MED | NCLX transfer table: `1=BT.709 (labelled 'srgb' — practical SDR approximation)`; note code 13 = canonical sRGB; point at `color-detection.ts:NCLX_TRANSFER_MAP` |
| AGG-R5C2-21 / DOC-R5C2-05 | MED | SW section: replace "framework-default `no-store`" with "dynamic rendering (`revalidate = 0`); Next emits no-cache headers" (also adjust the same wording in `sw.template.js` comment + regenerate sw.js) |
| AGG-R5C2-22 / DOC-R5C2-06 | MED | ETag section: precedence = headers() config → filesystem (incl. `public/`) → route handlers |
| AGG-R5C2-23 / DOC-R5C2-09 | MED | Stripe schema note: warn `checkout.session.async_payment_succeeded` unhandled — delayed payment methods create no entitlement until plan-316 CRT-R5C1-04 ships |
| AGG-R5C2-47 / VER-R5C2-02 | LOW | Database Indexes list: add `(uploaded_by)` + the two migration-0021 `image_views` indexes |
| AGG-R5C2-48 / DOC-R5C2-03 | LOW | Touch-target policy: reference WCAG 2.2 (2.5.8 AA 24px / 2.5.5 AAA 44px — repo exceeds both); same note in `touch-target-audit.test.ts` header |
| AGG-R5C2-49 / DOC-R5C2-04 | LOW | GPS note: withMetadata keeps all EXIF per Sharp docs (drop the imprecise 0.33-version framing, keep the warning) |
| AGG-R5C2-50 / DOC-R5C2-08 | LOW | Security section: document Argon2id params (m=65536, t=3, p=4 — exceeds OWASP minimums) |
| AGG-R5C2-51 / DOC-R5C2-13 | LOW | Migration runbook: mark `dialect.cjs:62` ref as informational / version-drifting |

## Unit B — small code hardening (separate fine-grained commits)

| Finding | Sev/Conf | Edit |
|---|---|---|
| AGG-R5C2-30 / SEC-R5C2-01 | LOW/High | `lib/session.ts:99-128`: post-HMAC shape assert `/^[0-9a-f]{32}$/` on random + `/^[0-9a-f]{64}$/` on signature |
| AGG-R5C2-32 / COR-R5C2-04 | LOW/High | `lib/data.ts:425-428`: derive `_MapSensitiveKeys` from canonical `PrivacySensitiveKeys` minus `latitude`/`longitude` so the map guard can't drift below the destructured set |
| AGG-R5C2-33 / COR-R5C2-06 | LOW/Low | `api/search/semantic/route.ts:61-64`: reject non-number `topK` explicitly (optional strictness; clamp already total) |
| AGG-R5C2-37 / TRC-R5C2-03 | LOW/High | `actions/images.ts` retryFailedImage: also `state.claimRetryCounts.delete(id)` |
| AGG-R5C2-38 / ARCH-R5C2-04 | LOW/Med | `admin-backfill-runner.ts:160`: comment — keyset re-query relies on advisory lock + fresh-uploads-at-CURRENT invariant (non-snapshot semantics) |
| AGG-R5C2-39 / BUG-R5C2-08 | LOW/High | `process-image.ts:856`: comment — assertBlurDataUrl returns null, never throws |

## Unit C — designer LOW batch

| Finding | Sev/Conf | Edit |
|---|---|---|
| AGG-R5C2-40 / DES-R5C2-02 | LOW/High | `app/[locale]/not-found.tsx:43`: `inline-flex items-center min-h-11` on the recovery link |
| AGG-R5C2-41 / DES-R5C2-03 | LOW/High | `app/[locale]/error.tsx:18`: decorative `aria-hidden` span + `sr-only` h1 (option A) |
| AGG-R5C2-42 / DES-R5C2-04 | LOW/High | `components/home-client.tsx:395`: `aria-hidden="true"` on empty-state svg |
| AGG-R5C2-43 / DES-R5C2-05 | LOW/High | `components/nav-client.tsx:164`: `LOCALE_DISPLAY_NAMES` map instead of ternary |
| AGG-R5C2-44 / DES-R5C2-06 | LOW/High | `components/photo-viewer.tsx:592`: wire `aria-describedby="photo-viewer-shortcuts"` on the viewer region or remove the dead sr-only block |
| AGG-R5C2-45 / DES-R5C2-07 | LOW/Med | `components/upload-dropzone.tsx:490`: VERIFY tag spans are non-focusable (no tabIndex); if so, record as verified non-issue in progress table; else add `aria-disabled` |
| AGG-R5C2-46 / DES-R5C2-08 | LOW/Low | `components/info-bottom-sheet.tsx`: `max-h-[95vh]` → add `supports-[height:100dvh]:max-h-[95dvh]` (vh fallback retained) |

## Unit D — test LOW batch

| Finding | Sev | Edit |
|---|---|---|
| AGG-R5C2-52 / TEST-R5C2-11 | LOW | `e2e/admin.spec.ts`: wrong-password → error message assertion on the non-opt-in path |
| AGG-R5C2-53 / TEST-R5C2-13 | LOW | `checkout-route.test.ts:82-97`: replace order-dependent select-chain mock with labelled `mockImplementationOnce` pairs or table-keyed dispatch |
| AGG-R5C2-54 / TEST-R5C2-14 | LOW | new standalone `countCodePoints` tests (emoji/CJK surrogate pairs, combining marks) |

## Progress

(record per-row status + commit as work proceeds)
