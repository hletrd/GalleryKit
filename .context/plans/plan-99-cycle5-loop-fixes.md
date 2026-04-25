# Plan 99 — Cycle 5 (review-plan-fix loop) — Unicode-formatting rejection for topic.label, image.title, image.description

**Created:** 2026-04-25 (Cycle 5)
**Status:** PENDING
**Source review:** `.context/reviews/_aggregate.md` (Cycle 5)
**Related lineage:** C7R-RPL-11 / C8R-RPL-01 (CSV) → C3L-SEC-01 (topic alias) → C4L-SEC-01 (tag name) → **C5L-SEC-01 (this plan)**

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C5L-SEC-01 | Apply Unicode-formatting rejection to `topics.label`, `images.title`, `images.description` | LOW | Medium | IMPLEMENT |
| C5L-CR-02 | Update misleading sanitization comment in `updateImageMetadata` | INFO | Medium | BUNDLE |
| C5L-DOC-02 | Extend lineage comment in `validation.ts` | INFO | High | BUNDLE |
| C5L-DOC-01 | Update CLAUDE.md security architecture | LOW | Medium | OPTIONAL — defer if doc churn risk |
| C5L-DBG-01 | Document strip-vs-reject asymmetry between topics.ts and images.ts | INFO | Low | DOCUMENT in commit body |
| C5L-PERF-01 | (closed before write) | INFO | Low | NONE |

---

## C5L-SEC-01 implementation

### Step 1: `apps/web/src/app/actions/topics.ts`
After `const label = stripControlChars(rawLabel) ?? '';` and before the `if (label !== rawLabel)` check (or immediately after), add:
```ts
import { UNICODE_FORMAT_CHARS, ... } from '@/lib/validation';
...
if (UNICODE_FORMAT_CHARS.test(label)) return { error: t('invalidLabel') };
```
Apply in both `createTopic` (line ~73-76) and `updateTopic` (line ~170-175).

### Step 2: `apps/web/src/app/actions/images.ts` (`updateImageMetadata`)
Add import for `UNICODE_FORMAT_CHARS`. After computing `sanitizedTitle` / `sanitizedDescription` and before the length checks:
```ts
if (sanitizedTitle && UNICODE_FORMAT_CHARS.test(sanitizedTitle)) {
    return { error: t('invalidTitle') };
}
if (sanitizedDescription && UNICODE_FORMAT_CHARS.test(sanitizedDescription)) {
    return { error: t('invalidDescription') };
}
```

### Step 3: i18n keys
- `apps/web/messages/en.json` and `ko.json`: `invalidLabel` already exists. Add:
  - `"invalidTitle": "Invalid title"` / `"잘못된 제목입니다"`
  - `"invalidDescription": "Invalid description"` / `"잘못된 설명입니다"`
- Place under the same `serverActions` block as `invalidLabel`.

### Step 4: Lineage comment (`apps/web/src/lib/validation.ts:21-32`)
Extend the lineage line to mention `topic.label`, `image.title`, `image.description` and reference C5L-SEC-01.

### Step 5: Tests
- `apps/web/src/__tests__/topics-actions.test.ts`: at least one new test verifying `createTopic` (or `updateTopic`) returns `error: invalidLabel` for an RLO-bearing label.
- `apps/web/src/__tests__/images-actions.test.ts`: tests verifying `updateImageMetadata` rejects RLO title and ZWSP description.

### Step 6: Comment polish (C5L-CR-02)
Update the `// Sanitize title and description BEFORE length validation so checks…` comment in `updateImageMetadata` to read more accurately: "follows the sanitize-before-validate ordering from settings.ts/seo.ts; null preservation is image-specific. Unicode-formatting rejection added in C5L-SEC-01."

---

## Verification gates (must all be green before commit/push/deploy)

- [ ] `npm run lint --workspace=apps/web`
- [ ] `tsc --noEmit -p apps/web/tsconfig.json`
- [ ] `npm run lint:api-auth --workspace=apps/web`
- [ ] `npm run lint:action-origin --workspace=apps/web`
- [ ] `cd apps/web && npx vitest run` (count increases by ≥3 net cases)
- [ ] `npm run build --workspace=apps/web` (post-fix)
- [ ] Commit message: `fix(security): 🛡️ reject Unicode bidi/invisible chars in topic.label and image title/description` with C5L-SEC-01 lineage note in body.

---

## Out-of-scope / deferred (recorded — NOT silently dropped)

- **C5L-DOC-01 (CLAUDE.md update)** — DEFERRED. Severity LOW. Rationale: the policy is being applied incrementally; deferring the CLAUDE.md narrative consolidation until after one more cycle (when `admin_settings`/`seo` are reviewed) avoids re-editing the same paragraph twice.
  - **Exit criterion:** when one more admin-controlled string surface lands the same hardening, consolidate the CLAUDE.md security-architecture paragraph in a single docs commit.
  - **Citation:** `CLAUDE.md` Database Security bullet listing C7R-RPL-01 / C8R-RPL-01.
- **C5L-PERF-01** — closed (false positive; const is module-scoped).
- **C5L-DBG-01** — documented in commit body only; no behavioural change.

Per CLAUDE.md "Security/correctness/data-loss NOT deferrable unless repo rules explicitly allow": C5L-SEC-01 is LOW-severity admin-only spoofing surface, not data-loss/correctness. Both Cycle 3 and Cycle 4 closed parallel findings of the same severity in a single cycle; deferral here is consistent.
