# Security Reviewer — Cycle 5/100 RPF loop (HEAD `be53b44`, 2026-04-26)

## Scope

Audited the cycle-4 closure of AGG4-L01 (producer-side blur contract):
- CSS `url()` injection surface (`photo-viewer.tsx:105`).
- Throttle log information leak (`blur-data-url.ts:115-118`).
- Three-point validator symmetry (producer to DB write to SSR read).

## Findings

**No new findings.**

The AGG4-L01 fix is a defensive no-op for the happy path (16x16 q40 JPEG ~270-680 base64 chars, well under MAX_BLUR_DATA_URL_LENGTH=4096). It only matters if a future contributor switches the producer MIME (e.g. AVIF) without updating `ALLOWED_PREFIXES` — at that point the validator now rejects at write time, surfacing the regression instead of silently masking it.

CSP `img-src` already enumerates `data:` and `blob:`. The contract limits `data:image/{jpeg,png,webp};base64,...` only, so CSP scanners will not flag unexpected MIME types on the public surface.

Rejection-log preview (`head=value.slice(0,8)`) leaks at most 8 chars of any poisoned value. For `data:image/jpeg;base64,...` this is the literal MIME prefix; for an attacker-injected `https://evil.example/?token=...` it leaks `https://`. No new info beyond what the existing warn line already prints.

## Confidence

High. No new attack surface introduced; symmetry now closed.
