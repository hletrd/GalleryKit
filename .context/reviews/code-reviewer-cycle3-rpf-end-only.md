# Code Review — Cycle 3 RPF (end-only)

Agent: code-reviewer
Scope: full repo, with focus on US-P54 paid-downloads code (cycles 1+2 RPF deltas), `actions/sales.ts`, `/api/checkout/[imageId]`, `/api/stripe/webhook`, `/api/download/[imageId]`, `lib/download-tokens.ts`, `lib/license-tiers.ts`, `lib/stripe.ts`, `sales-client.tsx`, `photo-viewer.tsx`, schema.

## Inventory built (review-relevant files)

- `apps/web/src/app/api/stripe/webhook/route.ts`
- `apps/web/src/app/api/checkout/[imageId]/route.ts`
- `apps/web/src/app/api/download/[imageId]/route.ts`
- `apps/web/src/lib/download-tokens.ts`
- `apps/web/src/lib/license-tiers.ts`
- `apps/web/src/lib/stripe.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/app/actions/sales.ts`
- `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx`
- `apps/web/src/components/photo-viewer.tsx` (Buy/Download/checkoutStatus path)
- `apps/web/src/db/schema.ts` (entitlements)
- `apps/web/messages/en.json`, `ko.json` (stripe.* / sales.* keys)
- `apps/web/src/__tests__/refund-clears-download-token.test.ts`
- `apps/web/src/__tests__/license-tiers.test.ts`
- `apps/web/src/__tests__/stripe-webhook-source.test.ts`

## Gate baseline (entering cycle)

- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run lint:api-auth` clean.
- `npm run lint:action-origin` clean.
- `npm test` — 937 tests passed across 107 files.
- `git status` clean on master.

## Cycle 2 RPF carry-forward verification

Verified each cycle 2 RPF in-cycle fix is present in code:
- C2-RPF-01 plaintext token gated behind `LOG_PLAINTEXT_DOWNLOAD_TOKENS` — verified at `webhook/route.ts:158-163`.
- C2-RPF-02 refund AlertDialog with destructive variant — verified at `sales-client.tsx:206-217`, `231-259`.
- C2-RPF-03 EMAIL_SHAPE guard — verified at `webhook/route.ts:76-81`.
- C2-RPF-04 `Intl.NumberFormat(locale,…)` for sales — verified at `sales-client.tsx:61-72,116`.
- C2-RPF-05 `||` fallback removed — verified at `sales-client.tsx:150-152`.
- C2-RPF-06 `STORED_HASH_SHAPE` — verified at `download-tokens.ts:45,53-58`.
- C2-RPF-07 CardFooter wrapped — verified at `photo-viewer.tsx:843-854`.
- C2-RPF-08 `LOCALES` import — verified at `license-tiers.ts:41`.
- C2-RPF-09 status icon — verified at `sales-client.tsx:84-99`.
- C2-RPF-13 Stripe error mapping — verified at `sales.ts:101-118,162-165`.
- C2-RPF-14 ellipsis on truncation — verified at `checkout/[imageId]/route.ts:120-122`.

## NEW Findings (cycle 3 RPF)

### C3RPF-CR-HIGH-01 — Stripe `checkout.session.completed` does not gate on `payment_status === 'paid'`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-94`
- Severity: **High** | Confidence: **High**
- **Code:**
  ```ts
  if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      // ... NO check on session.payment_status ...
      const amountTotalCents = session.amount_total ?? 0;
      // ... INSERT entitlement, generate plaintext token ...
  }
  ```
- **Why a problem:** Stripe documents that `checkout.session.completed` fires for ALL payment methods, including async ones (bank transfers, ACH, OXXO, Boleto, etc.) where the payment may NOT be collected at the time of the event. `session.payment_status` is `'paid'` only when funds are confirmed; `'unpaid'` for async pending; `'no_payment_required'` for $0 sessions. Without this gate the webhook creates a download entitlement for an `'unpaid'` session, generates a plaintext token, and (under `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`) the operator emails a customer who has not yet paid — and may never pay. There is no mechanism to retract the entitlement before expiresAt.
- **Failure scenario:** Photographer enables ACH or bank-transfer payment methods in the Stripe dashboard. Customer initiates ACH for $20 commercial-tier license. Stripe fires `checkout.session.completed` with `payment_status: 'unpaid'`. Webhook stores entitlement and writes the manual-distribution log line. Operator emails the token. Customer downloads the original. ACH bounces 2 business days later. No money was ever collected.
- **Fix:** Add `if (session.payment_status !== 'paid') { return NextResponse.json({ received: true }); }` between the signature verify and the INSERT. Optionally listen for `checkout.session.async_payment_succeeded` for the async-paid case (or document that async methods are not supported in this phase). Ship the gate now.

### C3RPF-CR-HIGH-02 — Webhook accepts `amount_total: 0` and creates a $0 entitlement

- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Severity: **High** | Confidence: **High**
- **Code:** `const amountTotalCents = session.amount_total ?? 0;` followed by INSERT with no positivity check.
- **Why a problem:** If a Stripe coupon, promotion code, or 100%-off discount is applied (Stripe supports these natively in Checkout), `amount_total` can be `0` and the webhook still happily inserts an entitlement and generates a download token. The /admin/sales view shows a $0 sale — looks like a free download, but the photographer's `license_tier != 'none'` setting was the explicit "do not give this away" signal. Also: the checkout route at `checkout/[imageId]/route.ts:103-106` correctly rejects `priceCents <= 0` server-side, so the only way a $0 session reaches this webhook is via a coupon/promo applied in the Stripe dashboard or a programmatic SDK call. The defense-in-depth gate belongs at webhook ingest, not just at session creation.
- **Failure scenario:** Photographer or assistant creates a 100%-off coupon in Stripe dashboard for a campaign. Customer applies the code at checkout. Webhook records a $0 entitlement. Photographer's revenue total in /admin/sales misrepresents the give-away as a sale.
- **Fix:** After the email-shape and tier-allowlist gates, add `if (!Number.isInteger(amountTotalCents) || amountTotalCents <= 0) { return 200 }` with a `console.warn`. Also matches the pattern that tier=`'none'` is rejected: a $0 amount is conceptually equivalent to "not for sale".

### C3RPF-CR-MED-01 — Refund check happens AFTER the entitlement select but does not re-check after Stripe call (race window)

- File: `apps/web/src/app/actions/sales.ts:120-167`
- Severity: **Medium** | Confidence: **Medium**
- **Code:** The action reads `row.refunded` once at line 140. Between that read and the `db.update` at line 154, another admin (or the same admin via a duplicate tab) could have already issued the refund.
- **Why a problem:** Two concurrent refund requests can both pass the `if (row.refunded)` guard, both reach `stripe.refunds.create`, and the second Stripe call returns `charge_already_refunded`. The mapped error code is correct (`'already-refunded'`) — but only after a real Stripe API call has been spent on a no-op. Cost: 1 wasted Stripe API call per concurrent refund; possible Stripe-side rate-limit pressure if many tabs are open.
- **Failure scenario:** Admin clicks Refund, opens a second tab, clicks Refund again before the first finishes. Both reach Stripe, second gets `charge_already_refunded`. UI shows the localized error toast (good). But a hostile/buggy admin client could spam refund clicks and trip Stripe rate limits.
- **Fix (defense in depth):** Wrap the refund logic in a transaction that does `SELECT … FOR UPDATE`, OR change the final UPDATE to `WHERE refunded = false` and check `affectedRows > 0` before treating the refund as a fresh one. Record `stripe_refund_id` (already deferred as C2-RPF-D08) — once stored, the action can check it and skip the Stripe call.
- Note: This is below the user-facing severity bar but matters when entering production.

### C3RPF-CR-MED-02 — `getTotalRevenueCents` computes ALL-time sum but is now used only as zero-row fallback

- Files: `apps/web/src/app/actions/sales.ts:75-91`, `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:10-13`, `sales-client.tsx:150-152`
- Severity: **Medium** | Confidence: **High**
- **Why a problem:** Cycle 2 RPF P260-05 fixed the buggy `||` fallback so the client now computes revenue from loaded rows. The fallback `totalRevenueCents` is only used when `rows.length === 0`. But: if there are 0 rows, the all-time sum from `getTotalRevenueCents` is also definitionally 0 (no rows to sum). So the action's runtime behavior is dead code path — except in the silent `listEntitlements()` error case where `rows.length` is 0 even though entitlements exist. In that error case the all-time sum displays the pre-error revenue, but the table shows "No sales yet." which is misleading.
- **Failure scenario:** `listEntitlements()` throws (DB connection blip), returns `{ error: 'Failed to load sales' }`. Page passes `rows: []` and `totalRevenueCents: <real total>`. UI shows "$120.00 — No sales yet." which contradicts itself.
- **Fix:** Either remove `getTotalRevenueCents` and `totalRevenueCents` prop entirely (revenue is always derived from `rows`), OR fix the UX so the error state is visually distinguished from the empty state (e.g., show error toast, hide revenue when error). The simplest fix is to remove the action and the prop — there is no real surface where they help. C2-RPF-D02 was deferred for exactly this reason; its exit criterion was met when P260-05 landed.

### C3RPF-CR-MED-03 — `Content-Disposition` filename construction is unsafe under admin-controlled `filename_original`

- File: `apps/web/src/app/api/download/[imageId]/route.ts:142-148`
- Severity: **Medium** | Confidence: **High** (defense-in-depth; current upload sanitization makes practical exploitation hard)
- **Code:**
  ```ts
  const ext = path.extname(image.filename_original) || '.jpg';
  const downloadName = `photo-${imageId}${ext}`;
  return new NextResponse(webStream, {
      headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${downloadName}"`,
          ...
      },
  });
  ```
- **Why a problem:** `path.extname(image.filename_original)` is largely safe: it returns the substring after the last `.` until the end. But: `filename_original` is admin-uploaded and stored as a varchar(255). If the admin uploaded a file named `safe.jpg"; rm -rf /` the extname is `.jpg"; rm -rf /` — the trailing characters are not stripped by `path.extname` because there's no further `.` and no NUL. They land verbatim in the `filename="..."` value. The header line breaks RFC 6266 and lets a hostile/buggy admin inject `;` separators, fooling some clients into setting `Content-Disposition` parameters they did not intend.
- **Failure scenario:** Admin uploads (intentionally or via paste from CLI) a file with a quote/semicolon in the extension. Customer downloads. Browser interprets a malformed `Content-Disposition` and writes a different filename to disk than expected; some older browsers/clients have done worse with quoted-string injections.
- **Fix:** Replace any non-`[a-zA-Z0-9]` chars in `ext` with empty string before concat, OR drop the filename param entirely (`Content-Disposition: attachment` is valid and safe). Recommended: `const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 8) || '.jpg'; const downloadName = \`photo-${imageId}${safeExt}\`;`.
- C2-RPF-D07 deferred this with exit criterion "when upload-side filename allowlist is added"; the upload allowlist is bounded but the download-side belt-and-suspenders is cheap.

### C3RPF-CR-MED-04 — Atomic single-use claim consumes the token even when file streaming fails

- File: `apps/web/src/app/api/download/[imageId]/route.ts:90-160`
- Severity: **Medium** | Confidence: **High**
- **Code:**
  ```ts
  const result = await db.update(entitlements).set({ downloadedAt: sql`NOW()`, downloadTokenHash: null })
      .where(and(eq(entitlements.id, entitlement.id), isNull(entitlements.downloadedAt)));
  // ... open file ... read stream ... if file ENOENT → 404 ...
  ```
- **Why a problem:** The token is consumed (downloadedAt set, hash cleared) BEFORE the file existence check (line 129 `lstat`). If the upload directory is missing the original file (file was deleted, disk error, container migration), the customer hits a 404 / 500 — but their token is already invalidated. They cannot retry with the same token. Support burden falls on the photographer (must issue a refund + a fresh entitlement, manually).
- **Failure scenario:** Customer pays, gets token, clicks download URL. The original file was renamed during a migration. Customer sees a 404. Refresh → "Token already used" 410. Customer is now in support hell. The 24h validity meant nothing.
- **Fix:** Either (a) move the file-existence check (line 129 `lstat`) BEFORE the atomic claim (line 90), then trust the claim, OR (b) on stream open failure inside the catch at line 154, compensate the claim by setting `downloadedAt = NULL` and re-storing the hash. Option (a) is simpler and matches the "claim only on a viable download" semantic. Race: between lstat and stream-open another caller could not delete the file (admin protected), so the lstat is good-enough.
- Aligns with C2RPF-CR-LOW-01 / C2-RPF-D04 (orphan-image race) but is a separate, cheaper fix.

### C3RPF-CR-LOW-01 — `getTotalRevenueCents` does not filter by tier or by date range

- File: `apps/web/src/app/actions/sales.ts:75-91`
- Severity: **Low** | Confidence: **High**
- Even if C3RPF-CR-MED-02 lands and the action is removed, while it exists it computes `SUM(amount_total_cents) WHERE refunded=false` over ALL TIME with no bound. For a heavily-used gallery this is a full-table scan on entitlements every page load. Not currently a problem (≤ 500 rows by design) but worth noting.
- **Fix:** ride along with C3RPF-CR-MED-02 (remove the action).

### C3RPF-CR-LOW-02 — Webhook missing `customer_email` is treated as malformed (200) without distinguishing from anonymous-checkout

- File: `apps/web/src/app/api/stripe/webhook/route.ts:83-95`
- Severity: **Low** | Confidence: **Medium**
- **Code:**
  ```ts
  if (!imageIdStr || !tier || !customerEmail || !sessionId) {
      console.error('Stripe webhook: missing required metadata', { ... });
      return NextResponse.json({ received: true });
  }
  ```
- **Why a problem:** Stripe Checkout supports anonymous email-less guest mode in some payment-method configurations. If a future config change allows this, the webhook silently drops the entitlement (200, Stripe stops retrying). Customer paid; no entitlement created; no token. Worst-case revenue without delivery.
- **Fix:** Distinguish "missing customerEmail (configurable)" from "missing tier/imageId (programmer error)" — if the path can legitimately have no email, fail-closed at checkout creation (force `customer_email` to be required client-side OR require Stripe's `customer_creation: 'always'`).
- Currently the checkout route sets `customer_email: undefined` (line 144 of checkout route), so Stripe handles the prompt. Documenting this for future config changes.

### C3RPF-CR-LOW-03 — `expiresAt` stored without TZ literal; relies on Docker UTC default

- File: `apps/web/src/app/api/stripe/webhook/route.ts:128`, `apps/web/src/db/schema.ts:260`
- Severity: **Low** | Confidence: **High** (already C2-RPF-D10)
- The Docker baseline is UTC, but a non-Docker self-host on a non-UTC server stores `expiresAt` in local time and the download check `new Date() > new Date(entitlement.expiresAt)` compares apples to oranges. Cycle 2 deferred this with exit criterion "DB connection TZ changed". Worth a unit test that asserts the conversion to confirm the contract; currently no test asserts this.
- **Fix:** Add a unit test that creates an entitlement with `expiresAt = new Date('2099-01-01T00:00:00Z')` and asserts the round-trip back from the DB compares as `>` `new Date()`. Cheap, locks the contract.

### C3RPF-CR-LOW-04 — `sales-client.tsx` `formatCents` and `computeStatus` not extracted; not unit-tested

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:61-81`
- Severity: **Low** | Confidence: **High** (already C2-RPF-D16)
- Logic is exercised end-to-end via the integration test only. Extracting and unit-testing them is cheap and locks the locale-aware contract from regression.

### C3RPF-CR-LOW-05 — `mapStripeRefundError` cast pattern is brittle

- File: `apps/web/src/app/actions/sales.ts:110-118`
- Severity: **Low** | Confidence: **Medium**
- **Code:** `const e = err as Error & { code?: string; type?: string };` followed by `e.code === 'charge_already_refunded'`.
- **Why a problem:** Stripe SDK errors are subclasses of `Stripe.errors.StripeError`. The duck-cast works but does not benefit from the official types. If the SDK renames `code` to `errorCode` in a future major, the cast still compiles and silently returns `'unknown'` for every refund failure — masking a real Stripe regression.
- **Fix:** `import Stripe from 'stripe'` (already imported via `getStripe`); narrow with `if (err instanceof Stripe.errors.StripeError)`. Cheap, locks the import.

### C3RPF-CR-LOW-06 — `sales-client.tsx` `errorLoad` accepts a translation string but renders only the salesResult.error string

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:45`, `sales-client.tsx:163-165`
- Severity: **Low** | Confidence: **High**
- **Code:** `errorLoad: salesResult.error ?? ''` — passes the SERVER error text to the CLIENT untranslated. `listEntitlements` returns `{ error: 'Failed to load sales' }` (English-only).
- **Why a problem:** The Korean locale shows the English server-error string verbatim. UX inconsistent with the rest of the page.
- **Fix:** In `page.tsx`, when `salesResult.error` exists, replace it with `t('errorLoad')` and ensure the messages have the key. Already half-wired (`errorLoad` is a translation key field on the prop, just not pulled from `t`).

### C3RPF-CR-LOW-07 — `customer_email: undefined` line in checkout is dead code

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:144`
- Severity: **Informational** | Confidence: **High**
- `customer_email: undefined` on a Stripe Checkout session has the same effect as omitting the field. The line is intentional comment-as-code but adds noise.
- **Fix:** Remove the line. Or replace with a comment that documents why it's not set (Stripe will collect via the form). Cosmetic.

### C3RPF-CR-LOW-08 — Refund AlertDialog title hardcoded `text-destructive` styling

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:235-247`
- Severity: **Informational** | Confidence: **High**
- The dialog title is plain (no destructive emphasis). The only destructive styling is the action button. This is consistent with shadcn AlertDialog defaults but a destructive action like "irreversibly refund" benefits from extra visual weight on the title (e.g., red icon).
- **Fix:** Cosmetic — defer or include a small lucide icon (`AlertTriangle`) in the dialog title.

## Confirmed issues vs likely vs needs-validation

- **Confirmed:** C3RPF-CR-HIGH-01, HIGH-02 (Stripe SDK contract, easily reproduced via fixture).
- **Confirmed:** C3RPF-CR-MED-02 (dead code path proven by reading flow).
- **Confirmed:** C3RPF-CR-MED-03 (defense-in-depth, no current incident).
- **Confirmed:** C3RPF-CR-MED-04 (logic ordering reading code).
- **Likely:** C3RPF-CR-MED-01 (race window, hard to repro under normal use).
- **Needs validation:** C3RPF-CR-LOW-02 (depends on Stripe payment-method config — verify with Stripe dashboard before fixing).

## Cross-cutting observations

- The webhook is a single 167-line function. As more event types ship (refund, dispute, async_payment_succeeded), splitting into per-event handlers in a switch is worth queuing.
- `entitlements` table lacks a `payment_status` column. If C3RPF-CR-HIGH-01 is fixed by listening to async events, that gap matters.
- Source-contract tests are good but lock the implementation, not the behavior. Consider adding at least one fixture-based webhook handler test that does not need a real Stripe signing secret.
