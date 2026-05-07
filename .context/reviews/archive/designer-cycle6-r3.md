# Designer -- Cycle 6 (Round 3, 2026-04-20)

## Scope
UI/UX review of web frontend. Mature codebase with 46+ prior cycles.

## Findings

### D6R3-01: Storage backend setting in admin UI is misleading [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (assumed based on architecture)
**Description:** The admin settings page exposes a "Storage Backend" dropdown with options for Local, MinIO, and S3. When a user selects MinIO or S3 and saves, the settings are persisted and the storage singleton switches — but the actual upload/processing/serving pipeline still uses local filesystem operations. The user sees "Settings saved successfully" with no indication that the storage backend change has no practical effect. This is a UX trust violation.
**Fix:** Add a visible note or warning next to the storage backend setting: "Storage backend switching is not yet active. All uploads are stored locally regardless of this setting." Or disable the dropdown entirely until integration is complete.

### D6R3-02: Admin login form error feedback is transient [LOW] [LOW confidence]
**File:** `apps/web/src/app/[locale]/admin/login-form.tsx` lines 23-26
**Description:** Login errors are displayed via `toast.error(state.error)`. Toast notifications are ephemeral and disappear after a few seconds. For authentication errors (wrong password, rate limited), persistent feedback would be more appropriate since the user needs to read the error and take corrective action. This is a minor UX concern.
**Fix:** Consider displaying the error inline below the form (persistent) rather than as a toast (transient).

## Summary

Two minor UX findings. The storage backend setting is the most impactful since it can mislead admins into thinking their S3/MinIO configuration is active.
