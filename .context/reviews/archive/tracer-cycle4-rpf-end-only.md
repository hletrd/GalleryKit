# Cycle 4 RPF (end-only) — Tracer

## Method
Causal trace of failure scenarios end-to-end through paid-download flow.

## Findings

### LOW

#### C4-RPF-TR-01 — Trace: a 256-char customer email arrives in webhook

- Path: Stripe → webhook → SHA-256 token → INSERT
- Step 1: `session.customer_details?.email` = 256-char string
- Step 2: `customerEmailRaw.slice(0, 320).toLowerCase()` = 256-char string
- Step 3: EMAIL_SHAPE regex passes (no whitespace, has `@`, has `.`)
- Step 4: tier allowlist passes
- Step 5: imageId valid
- Step 6: amount > 0
- Step 7: SELECT existing → not found
- Step 8: generateDownloadToken → fresh token
- Step 9: INSERT entitlements.customerEmail = 256-char string
- Step 10: MySQL strict mode → `Data too long for column 'customer_email'` (column is 255)
- Step 11: catch block → return 500
- Step 12: Stripe retries indefinitely
- Step 13: `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` → token already logged at step 8 (before INSERT)
- Step 14: Each retry mints a NEW token (cycle 3 P262-07 SELECT skips this if a row exists, but step 10 means no row exists, so SELECT returns empty every retry, and EVERY retry re-mints a token)
- Severity: **Low** | Confidence: **High**
- **Root cause:** the slice limit (320) exceeds the column width (255).
- **In-cycle fix:** slice to 255.

#### C4-RPF-TR-02 — Trace: ACH/OXXO async-paid customer's first webhook

- Path: Stripe ACH → webhook (payment_status: 'unpaid')
- Step 1: signature verifies
- Step 2: payment_status = 'unpaid' → cycle 3 P262-01 gate at line 70 → `console.error` → return 200
- Step 3: PagerDuty fires alert (operator's logs forward error-level)
- Step 4: operator pages, sees the false-positive, desensitizes
- Severity: **Low** (ops UX) | Confidence: **High**
- **Root cause:** unpaid is the documented happy-path for async; should be `console.warn`, not `console.error`.

#### C4-RPF-TR-03 — Trace: filename `photo.tar.gz` original

- Path: admin uploads .tar.gz → DB stores `photo.tar.gz` in filename_original → customer downloads
- Step 1: `path.extname('photo.tar.gz')` = `.gz`
- Step 2: sanitizer keeps `.gz`
- Step 3: downloadName = `photo-42.gz`
- Browser interprets as `.gz`. If the actual file is JPEG renamed to `.tar.gz`, the browser's MIME sniffing might still try to render as image (depending on `X-Content-Type-Options: nosniff` which IS set).
- Severity: **Informational** | Confidence: **High**
- Behavior is acceptable: customer gets `photo-42.gz`; can rename. nosniff prevents browser sniffing.
- **No action needed.**

#### C4-RPF-TR-04 — Trace: customer downloads with token then deletes, then operator deletes file

- Path: customer downloads → token claimed → operator deletes file → customer wants to re-download
- Step 1: customer hits /api/download/42?token=dl_X
- Step 2: token verified → entitlement found
- Step 3: entitlement.downloadedAt is non-null (already used) → 410 "Token already used"
- This is the correct single-use behavior. No bug.
- **No action needed.**

#### C4-RPF-TR-05 — Trace: Stripe webhook retry after 5xx response

- Path: webhook → DB error 500 → Stripe retries
- Step 1: webhook gets event
- Step 2: SELECT existing → empty
- Step 3: generateDownloadToken → token1
- Step 4: INSERT fails (e.g., DB connection pool exhausted) → 500
- Step 5: Stripe retries 1 minute later
- Step 6: SELECT existing → empty (still no row)
- Step 7: generateDownloadToken → token2 (DIFFERENT from token1)
- Step 8: INSERT succeeds → DB has hash(token2), and operator log has token2 (plus the failed retry's token1 from step 3 — NOT in DB)
- This is correct: only token2 is valid, only token2 is in DB. The orphan token1 in operator log is dead (not in DB → 404 on download attempt).
- However: the cycle 2 [manual-distribution] log line writes the plaintext token AFTER the INSERT succeeds (line 230-235), so token1's log line is NEVER written (early return at line 215 on INSERT failure). So no orphan log line. Good.
- **No action needed.**

#### C4-RPF-TR-06 — Trace: refund flow with FK delete cascade

- Path: admin deletes image → entitlements row CASCADE-deletes → admin tries to refund
- Step 1: image deleted → entitlements row gone
- Step 2: admin clicks Refund on a stale UI list (cached rows)
- Step 3: `refundEntitlement(id)` → SELECT WHERE id = ? → not found
- Step 4: returns `{ error: 'Entitlement not found', errorCode: 'not-found' }`
- Step 5: client `mapErrorCode('not-found')` → falls through default → `t.refundError` ("Refund failed")
- Severity: **Informational** | Confidence: **High** (overlaps with critic CRIT-05)
- The error message is non-specific. CRIT-05 fix would distinguish.
- **In-cycle fix:** part of CRIT-05.

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 2 (TR-01, TR-02 — both overlap with code-reviewer + critic)
- INFO: 4

## In-cycle scheduling proposal

- All findings overlap with already-scheduled in-cycle fixes.
