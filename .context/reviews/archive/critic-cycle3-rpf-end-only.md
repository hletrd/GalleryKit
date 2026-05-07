# Critic Review — Cycle 3 RPF (end-only)

Agent: critic
Scope: assumptions, missing edge cases, "looks done but isn't", workflow gaps that no one else catches.

## Premise & method

I assume cycles 1-2 RPF closed the headline issues. My job is to find the things that look fixed but aren't, and the things nobody is reviewing because they're "policy" (operator workflow, retention, async events).

## CRITIC-01 — The headline assumption is wrong: webhook treats every `checkout.session.completed` as paid

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-94`
- Severity: **High** | Confidence: **High**
- The whole flow rests on the assumption that "session.completed = customer paid". Stripe's contract is "session reached terminal state" — that includes `payment_status: 'unpaid'` for async methods. Cycle 2 documented the manual-distribution path as the operator workflow but never added the gate. The `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` line writes the token + email for an unpaid customer if async methods are enabled.
- **Why this is a blind spot:** The reviewers in cycles 1+2 were focused on the "happy-path UI fix" stack. The async-payment path has never been mentioned in any of the deferred lists. Operators reading the README assume `checkout.session.completed` means paid because that's how every blog post calls it.
- **Fix:** Gate at line 57. See code-reviewer C3RPF-CR-HIGH-01.

## CRITIC-02 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` looks like the closure fix but isn't

- File: `apps/web/README.md:65-75`, `apps/web/src/app/api/stripe/webhook/route.ts:158-163`
- Severity: **Medium** | Confidence: **High**
- The README claims this closes the manual-distribution loop. In practice:
  1. Operator must SSH to the host and run `docker logs <web> | grep manual-distribution`.
  2. Operator must extract the most recent token (sometimes multiple per minute under load).
  3. Operator must compose an email and paste the URL.
  4. Operator must do this within 24 hours of payment, before token expiry.
  5. If the operator misses the SLA, the customer is locked out (token expired). No replay path.
- This is not "closed" — it is a temporary scaffold that requires a human in the loop within a tight SLA. Step 5 is the most fragile: **there is no admin UI surface to mint a fresh token for an existing entitlement**. If the operator misses the 24h window, the photographer must issue a refund and ask the customer to re-buy.
- **Fix candidates:**
  1. Increase entitlement-token expiry to 30 days. Tradeoff: stale tokens leak longer.
  2. Add an admin "regenerate token" action on the /admin/sales row that creates a new single-use token tied to the existing entitlement.
  3. Surface the most-recent plaintext token in /admin/sales as a "Copy URL" button (with explicit warning).
- Recommended this cycle: (2). It is the highest-leverage fix because it removes the SLA pressure entirely.

## CRITIC-03 — The cycle 2 "AlertDialog" fix has a residual UX bug

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:206-217`
- Severity: **Low** | Confidence: **High**
- The Refund button now opens AlertDialog. But the row's Refund button is itself styled `variant="destructive"`. So the user clicks a red button → confirmation dialog appears → confirms → red button works. Two layers of "destructive" visual weight is louder than necessary; the destructive variant should live only on the confirm-action button inside the dialog.
- **Why nobody else caught this:** Cycles 1+2 added the dialog and the destructive variant in different deltas. The double-emphasis is a fresh consequence.
- **Fix:** Change the row Refund button from `variant="destructive"` to `variant="outline"` (keep the AlertDialog confirm action as `destructive`). Visually less alarming but still discoverable.

## CRITIC-04 — The webhook tier-allowlist guard says "200 so Stripe does not retry" but the message is misleading

- File: `apps/web/src/app/api/stripe/webhook/route.ts:102-106`
- Severity: **Informational** | Confidence: **High**
- The comment says "200 so Stripe does not retry — this is a permanent metadata error". True. But: the comment also implies the customer is stuck (paid but no entitlement). There's no operational signal that surfaces this. If a Stripe configuration ever drifts (a future tier renamed in dashboard), every successful payment silently drops the entitlement.
- **Fix:** Add a `console.error` (not warn) on every reject branch (tier, email, imageId). Errors usually trigger alerts; warns often don't. Pair with a `metadata.dropReason` field if logs are structured.

## CRITIC-05 — `getTotalRevenueCents` is a textbook "deferred but should have been deleted" item

- File: `apps/web/src/app/actions/sales.ts:75-91`
- Severity: **Medium** | Confidence: **High**
- C2-RPF-D02 deferred it pending P260-05 landing. P260-05 landed in cycle 2. The deferral exit criterion was met, but the deletion never happened. This is the textbook way deferred-list items become permanent dead code.
- **Fix:** Delete the action and its prop in this cycle. Simple, low-risk, ticks one item off the deferred list.

## CRITIC-06 — The `errorLoad` prop is half-wired

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:45`
- Severity: **Low** | Confidence: **High**
- The prop is typed for translation strings but receives `salesResult.error` (server English string). Korean locale users see "Failed to load sales" verbatim.
- **Fix:** When `salesResult.error` is truthy, the page should pass `t('errorLoad')` (with key added to messages) instead of the server string. Or omit the field entirely and toast the error. Cross-listed with code-reviewer C3RPF-CR-LOW-06.

## CRITIC-07 — The "Manual download distribution" docs are a maintenance debt

- File: `apps/web/README.md:63-75`
- Severity: **Low** | Confidence: **High**
- The README has a half-page section on the manual distribution workflow. This is a temporary scaffold but it's documented as "the operational workflow". Future readers will treat this as the design.
- **Fix:** Add a banner sentence at the top: "This is a phase-1 manual workflow; phase 2 (email pipeline) is on the roadmap. Plan to migrate when phase 2 ships."

## CRITIC-08 — There is no test that asserts the webhook rejects an unsigned event

- File: `apps/web/src/__tests__/stripe-webhook-source.test.ts`
- Severity: **Low** | Confidence: **High**
- The source-contract test asserts the structure of guards, not the runtime behavior. There's no fixture-based test that constructs an unsigned request body and asserts the route returns 400. The signature check is the most important security guard in the file.
- **Fix:** Add a fixture-based test using `next/server` `Request` that POSTs without a `stripe-signature` header → assert 400. Cheap, locks the contract.

## CRITIC-09 — The download route assumes `data/uploads/original/` but elsewhere uses `public/uploads/original/`

- Files: `apps/web/src/app/api/download/[imageId]/route.ts:120`, `apps/web/CLAUDE.md`, `apps/web/README.md`
- Severity: **Medium** | Confidence: **Medium** (depends on actual deployment topology)
- The download route resolves `path.resolve(process.cwd(), 'data', 'uploads', 'original')`. The repo CLAUDE.md says "Images stored in `apps/web/public/uploads/`". The Dockerfile and docker-compose may or may not bind-mount `data/uploads` and `public/uploads` to the same volume. If they are different paths, the download route fails 404 / ENOENT for every paid download.
- **Fix:** Verify the deployment topology. If two paths are correct (uploads-on-disk at `data/uploads/`, public CDN-mirror at `public/uploads/`), document it and add an env var for the originals path. If they should be the same path, fix the route to use `public/uploads/original/` and the docker volume mount accordingly. **High priority to verify** because it would mean every paid download is broken in the current shape.

## CRITIC-10 — `entitlements` row stores the customer email as a `varchar(255)` but RFC 5321 max is 320

- File: `apps/web/src/db/schema.ts:255`, `webhook/route.ts:67`
- Severity: **Low** | Confidence: **High**
- The webhook truncates to 320 chars. The DB column is 255. So a 256-320 char email passes the webhook truncate but is silently re-truncated by MySQL on INSERT (or rejected, depending on `sql_mode`). The mismatch makes the webhook truncate redundant on the upper end but means a 256-320 char email is dropped silently.
- **Fix:** Either widen the column to 320 or tighten the webhook truncate to 255. The RFC-correct path is 320, but in practice email providers cap at 254. Recommended: tighten the webhook to 254 and document.

## Cross-cutting reflection

The cycle 1-2 RPF flow has been disciplined — every cycle's deferred list has been honored. But the deferred list is now 17 items long (P261). Some are truly low-priority (C2-RPF-D12 empty-state polish) but others have stale exit criteria that have already been met (C2-RPF-D02, see CRITIC-05). The deferred list is becoming a graveyard. This cycle should clean out the items whose exit criteria have already met.

The headline issue this cycle is **CRITIC-01** (`payment_status` gate). It's the kind of issue that only shows up when a non-card payment method is enabled, and self-hosters often only enable cards initially. But the moment they expand payment options, the gallery silently mints free downloads to unpaid customers. This is the fix to ship today.
