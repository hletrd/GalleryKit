# Cycle 11 Verifier Notes

Finding count: 2

### V11-01 — Local storage reads are not symlink-safe for intermediate directories
- **Severity:** HIGH
- **Confidence:** HIGH
- **Citation:** `apps/web/src/lib/storage/local.ts`
- `resolve()` and final-file `lstat()` are insufficient if an intermediate upload directory is a symlink that escapes the root.

### V11-02 — Share-link key uniqueness still depends on DB collation
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/db/schema.ts`, `apps/web/src/lib/base56.ts`, `apps/web/src/app/actions/sharing.ts`
- Case-sensitive Base56 tokens are stored in `varchar` columns without an explicit binary collation, shrinking the effective token space on case-insensitive collations.
