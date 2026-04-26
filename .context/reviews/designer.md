# designer — Cycle 3 (HEAD `839d98c`, 2026-04-26)

## UI/UX findings (text-evidence based; agent-browser unavailable)

### DSGN3-MED-01 — sub-44 px destructive controls present on real surfaces, masked by audit blind spot

- **Files:**
  - `apps/web/src/components/upload-dropzone.tsx:405-413` — per-preview
    REMOVE button at `h-6 w-6` (24 px). Primary destructive affordance
    for "I uploaded the wrong file."
  - `apps/web/src/components/admin-user-manager.tsx:142-150` — per-row
    DELETE USER icon, default `size="icon"` (h-9 = 36 px), no override.
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:156, 221, 224`
    — back arrow + per-row edit/delete, all default `size="icon"`.
  - `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:88, 109, 112`
    — same shape.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:77`
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:76`
- **Confidence:** High / **Severity:** Medium

Per WCAG 2.5.5 AAA / Apple HIG / Google MDN. The cycle-2 audit was
supposed to enforce 44 px floor; the regex blind spot masks every
multi-line Button. Designer concern is the upload-dropzone REMOVE button
specifically: 24 px destructive action with no confirm dialog, sitting
close to the preview itself, is both an a11y miss and a "fat-finger
destruction" UX risk.

**Fix path:** raise the upload-dropzone REMOVE button to `h-11 w-11` (or
keep visual size and add a 44 px hit zone via padded wrapper). Admin
table icons are keyboard-primary on desktop — keeping the existing
`size="icon"` h-9 is acceptable but should be DOCUMENTED in
`KNOWN_VIOLATIONS` after CR3-MED-01 fix lands so the audit truly
reflects them.

### DSGN3-LOW-01 — `photo-navigation.tsx` size="icon" + h-12 w-12 multi-line is COMPLIANT but invisible to audit

- **File:** `apps/web/src/components/photo-navigation.tsx:208-216, 222-230`
- **Confidence:** High / **Severity:** Low

These render at h-12 (48 px), correctly above 44 px floor. After
CR3-MED-01 lands the multi-line normalization will let override
detection work and the file will pass cleanly.

## Verdict

1 NEW MEDIUM (real-world UX miss), 1 NEW LOW (post-fix compliance check).
