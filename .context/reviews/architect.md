# Architect — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Architectural lens
- Cross-cutting policy: Unicode-formatting hardening for admin-controlled persistent strings.
- Current organisation: one constant in `validation.ts`, two consumer functions (`isValidTopicAlias`, `isValidTagName`), and three other admin-controlled string fields with no consumer (`topic.label`, `image.title`, `image.description`).

## New findings

### C5L-ARCH-01 — No single architectural seam for "admin-controlled string sanitization" [LOW] [High confidence]

**Files:**
- `apps/web/src/lib/validation.ts:33` (`UNICODE_FORMAT_CHARS`)
- `apps/web/src/lib/sanitize.ts:6` (`stripControlChars`)
- Six call sites in `apps/web/src/app/actions/*.ts` that copy-paste the `stripControlChars(rawX)` then `if (clean !== raw) return error` pattern.

**Why a problem.** The two layers (control-char strip; bidi/invisible reject) are owned by two helpers with non-overlapping consumers. A future contributor asking "how do I sanitize an admin-controlled string?" has to grep both libraries and infer the policy from existing call sites. C3L/C4L progressively added Unicode rejection to two of the four obvious admin string surfaces, leaving the others inconsistent.

**Concrete failure scenario.** A new admin field (e.g. `topics.description`, `tags.description`, audit-log free-form note) is added; the author copies the closest existing pattern (`stripControlChars` + length check) and silently inherits the parity gap.

**Suggested fix.** Either extract a single `sanitizeAdminString` helper in `lib/sanitize.ts` (return `{ value, error }`), or — at minimum for this cycle — add a reusable `rejectUnicodeFormatting(value): string | null` helper in `validation.ts` and apply it inline in `topics.ts` / `images.ts`. Scope the change minimally: only `topic.label`, `image.title`, `image.description`. Leave `admin_settings`/`seo` for follow-up because their values are intentionally permissive.

## Out of scope
The single-instance / single-writer topology constraint is documented; no change.

## Cross-agent agreement
Overlaps with critic (C5L-CRIT-01 piecemeal-application), code-reviewer (C5L-CR-01 inconsistency), security-reviewer (C5L-SEC-01 root issue).
