# Document-Specialist Review — Run-8 Cycle-2

**HEAD:** f63af3b9  
**Date:** 2026-06-18  
**Scope:** Doc-code drift verification for key CLAUDE.md contract claims.

---

## NEW FINDINGS: 0

No on-disk drift discovered. All contract claims verified.

---

## Grep Evidence

### 1. IMAGE_PIPELINE_VERSION

```
grep -n "IMAGE_PIPELINE_VERSION = " apps/web/src/lib/gallery-config-shared.ts
→ 21:export const IMAGE_PIPELINE_VERSION = 7;
```

**Result:** PASS. On-disk value is 7; CLAUDE.md states 7.

---

### 2. COLOR_IMPACTING_KEYS count

```
sed -n '41,54p' apps/web/src/lib/settings-hash.ts
```

Counted string literals (settings-hash.ts lines 42–54):
1. `wide_gamut_jpeg_chroma`
2. `sdr_jpeg_chroma`
3. `avif_effort`
4. `force_srgb_derivatives`
5. `wide_gamut_max_source_pixels`
6. `image_quality_webp`
7. `image_quality_avif`
8. `image_quality_jpeg`
9. `image_sizes`

**Result:** PASS. Count is 9; CLAUDE.md states 9.

---

### 3. Paid-download / Stripe orphan refs in production src

```
grep -rniE "stripe|entitlement|license_tier|license-tiers|checkout|downloadToken|download-interstitial|actions/sales" \
  apps/web/src --include=*.ts --include=*.tsx | grep -v "__tests__"
→ (no output)
```

**Result:** PASS. Zero functional paid-download refs outside test fixtures.

---

### 4. CLAUDE.md / AGENTS.md / README.md stale feature docs

```
grep -niE "stripe|entitlement|paid.download|checkout.session" \
  CLAUDE.md AGENTS.md README.md apps/web/README.md 2>/dev/null
→ (no output)
```

**Result:** PASS. No live-feature mentions of Stripe/entitlements/paid-download/checkout in any on-disk doc file. Cycle-1 commit 961a7f1f already cleaned these. The references in the injected system-reminder context are stale session state, not on-disk content.

---

### 5. sw.js SW_VERSION stamp

```
grep -n "SW_VERSION" apps/web/public/sw.js
→ 26:const SW_VERSION = 'f63af3b9-p7';
```

**Result:** PASS. Stamp matches `{git-sha}-p{IMAGE_PIPELINE_VERSION}` pattern: `f63af3b9` (HEAD short SHA) + `p7` (pipeline version 7).

---

## Coverage Statement

Five doc-code contract claims verified with direct on-disk grep evidence:

| Claim | Expected | Found | Status |
|---|---|---|---|
| `IMAGE_PIPELINE_VERSION` | 7 | 7 (line 21) | PASS |
| `COLOR_IMPACTING_KEYS` count | 9 | 9 | PASS |
| Paid-download orphan refs in src (excl. tests) | 0 | 0 | PASS |
| Stripe/entitlement refs in on-disk docs | 0 | 0 | PASS |
| `sw.js` SW_VERSION stamp format | `{sha}-p7` | `f63af3b9-p7` | PASS |

No previously adjudicated findings re-filed. Cycle-1 work (NCLX matrix pin, process-image.ts:1108 idiom, downloadPage i18n cleanup, doc cleanup) confirmed complete and not duplicated here.
