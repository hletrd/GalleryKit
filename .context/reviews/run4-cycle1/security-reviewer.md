# Security review — Run-4 Cycle 1

Angle: OWASP top 10, secrets, unsafe patterns, auth/authz, policy compliance.
Method: full-inventory pass over `app/api/**` (10 files), `app/actions/**` (14 files),
`lib/` auth/token/sanitize/rate-limit/serve surfaces, middleware (`proxy.ts`), SW template,
schema FKs. Heavily-locked surfaces (data.ts privacy guard, CSP, db-restore, Stripe webhook,
download tokens) carry multi-cycle lineage + test locks and were spot-verified, not re-litigated.

## Findings

### SEC-R4C1-01 — PAT token `label` bypasses the admin-string sanitization policy
- **Severity/Confidence: MEDIUM / High** (confirmed)
- **Where:** `apps/web/src/app/actions/lr-tokens.ts:22-56` (`createLrToken`),
  `apps/web/src/lib/admin-tokens.ts:201-203` (`createToken` — only `.trim().slice(0,128)`),
  rendered at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:113`
  (`{token.label}`) and `:130` (interpolated into `aria-label`), persisted into audit
  metadata at `lr-tokens.ts:47-50`.
- **Why it's a problem:** CLAUDE.md "Database Security" mandates that *admin-controlled
  persistent string fields … reject Unicode bidi overrides (U+202A-202E, U+2066-2069) and
  zero-width / invisible formatting characters at the validation layer* (lineage
  C7R-RPL-11 → C3L-SEC-01 → … → C6L-SEC-01). The token label is exactly that class —
  admin-entered, persisted, rendered back in an admin table — yet it skips
  `sanitizeAdminString` entirely. C0 control chars and bidi overrides land verbatim in the
  DB, the tokens list UI, the revoke-confirmation aria-label, and audit-log metadata.
- **Failure scenario:** an admin (or a CSRF-adjacent flow that tricks an admin's session in
  a multi-admin studio) creates a token labeled with RLO/LRI characters so "upload-only
  demo token" visually reads as a different label in the token list; the wrong token
  survives a revocation sweep. Trojan-Source-style spoofing on a credential-management
  surface is precisely what the existing policy was written to stop.
- **Fix:** run `label` through `sanitizeAdminString` in `createLrToken` and reject on
  `rejected===true`, mirroring every other admin string surface.
- **Adjacent hardening (fold into same fix):**
  - `lr-tokens.ts:36`: `new Date(opts.expiresAt)` accepts garbage → `Invalid Date`.
    `verifyToken` compares `row.expires_at.getTime() <= Date.now()` — `NaN <= x` is
    `false`, so a malformed expiry can produce a **never-expiring token** (if the driver
    accepts it) or a raw MySQL error leaking to the UI (if it doesn't). Validate
    `Number.isFinite(d.getTime())` and reject past dates.
  - `lr-tokens.ts:52-54`: returns raw `err.message` (DB error internals) to the client.
    Admin-only surface, but the repo convention is generic client messages + server-side
    logs. Return a generic error.

### SEC-R4C1-02 — LR PAT upload: unhandled insert/enqueue failure orphans the original and leaks claimed quota
- **Severity/Confidence: MEDIUM / High** (confirmed; shared with code-reviewer angle COR-R4C1-02)
- **Where:** `apps/web/src/app/api/admin/lr/upload/route.ts:344-371` — `db.insert(images)`,
  `safeInsertId(...)` (throws by design, `lib/validation.ts:156-168`), `enqueueImageProcessing(...)`
  run with NO try/catch; the surrounding `try { … } finally` only releases the contract lock.
- **Why:** topic existence is checked at `route.ts:101-107` but the FK is enforced at insert
  time — a concurrent admin deleting the topic between check and insert raises an FK
  violation. Any DB hiccup or a thrown `safeInsertId` does the same. On that path:
  (a) the saved on-disk original under `data/uploads/original/` is never deleted (disk-fill
  primitive on the authenticated PAT surface), (b) the pre-claimed upload-tracker quota
  (`tracker.count/bytes`, claimed at `route.ts:205-207`) is never settled back, so repeated
  failures can starve the photographer's 1-hour upload window, and (c) the Lightroom plugin
  receives an unstructured 500 instead of JSON. The browser path handles this exact case
  (`app/actions/images.ts:471-488`: catch → `deleteOriginalUploadFile` → settle).
- **Fix:** wrap the post-save tail in try/catch parity: on failure
  `deleteOriginalUploadFile(data.filenameOriginal)` + `settleTrackerToActual(false)` +
  structured 500 JSON.

### SEC-R4C1-03 — LR PAT upload: `user_filename` written without `getSafeUserFilename` parity
- **Severity/Confidence: LOW-MEDIUM / High** (confirmed; details under code-reviewer COR-R4C1-03)
- `route.ts:307` stores `fileEntry.name.slice(0,255)` raw: no `path.basename`, no
  control/format-char rejection, empty string allowed, UTF-16 slice can bisect a surrogate
  pair (mysql2's UTF-8 encoder then writes U+FFFD). Browser path rejects all of these
  (`images.ts:46-56`, C2L2-03/C2L2-05). `fileEntry.name` also flows raw into audit metadata
  (`route.ts:386`). Control characters in an attacker-supplied (compromised-PAT) filename
  pollute admin-rendered strings and forensics output. Mirror `getSafeUserFilename` and
  strip the audit copy.

## Verified-clean (no finding)
- `withAdminAuth` token path (`lib/api-auth.ts`): scope check before handler, 401 fail-closed,
  same-origin enforced for cookie path; `lint:api-auth` green.
- `lib/admin-tokens.ts`: SHA-256-only at rest, constant-time digest compare, fail-closed on
  missing table, hash-keyed lookup (no plaintext in query logs), `admin_tokens.user_id`
  FK `ON DELETE CASCADE` (schema.ts:196-208) — no dangling-user tokens.
- LR route restore-maintenance entry + late re-check, contract lock try/finally, disk
  pre-check, HDR gate, GPS strip parity — all present (run-3 closures hold).
- SW template: admin-route bypass, 401/403/no-store never cached, versioned caches purged on
  activate; no auth-bearing responses cacheable.
- `serve-upload.ts`: traversal guards (SAFE_SEGMENT, allowlist, realpath containment,
  lstat symlink rejection) intact.
- Public mutating routes all covered by `lint:public-route-rate-limit` (gate green).
- i18n EN/KO 812/812 parity both directions; no secrets in tree (`.env*` gitignored, examples only).

## HARD-SCOPE check
No finding proposes edit/culling/scoring features. N/A.
