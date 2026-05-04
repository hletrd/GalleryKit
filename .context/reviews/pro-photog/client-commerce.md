# Pro Photographer Review — Client Proofing & Commerce Path

**Reviewer perspective:** working professional photographers — wedding/event shooters, portrait pros, editorial/agency, fine-art print sellers.
**Scope:** shared galleries (`/g/[key]`, `/s/[key]`), Stripe checkout/webhook/download path, license tiers, watermarking, embeds, picks, expiring shares.
**Out of scope:** color management (already addressed in `_aggregate.md`).

---

## Executive Summary

The proofing-and-commerce surface that ships today is **a Stripe single-image-license storefront, not a pro-grade client-proofing system**. The webhook + entitlement + single-use download core is well-engineered (idempotency keys, atomic claim, structured logs, refund flow) but the surrounding workflow that wedding/portrait/editorial pros expect is almost entirely absent:

- **No watermark anywhere in the image pipeline.** A working pro cannot send a proofing gallery to a client without a logo or "PROOF" overlay; without it, the client right-clicks every photo and walks away. This is the single biggest blocker (PRO-CRIT).
- **No password-protected gallery** — `sharedGroups` has only a random URL slug. For a private wedding deliverable that's industry-standard table stakes (PRO-CRIT).
- **`sharedGroups.expires_at` exists in schema but is unreachable** — read-side enforcement is correct (`data.ts:996-997`), but nothing in `createGroupShareLink` writes it, no admin UI sets it, no cleanup job sweeps expired rows (PRO-HIGH).
- **No client-picks / favorites flow** — `imageReactions` is anonymous heart counts, not identifiable picks; admin has no "which 50 photos did the bride select" report (PRO-CRIT for wedding/portrait pros).
- **No bundled-zip delivery** — even after a paid sale the customer downloads photos one at a time. There's no `archiver`/`yazl` dep and no zip route. For a 50-photo wedding selection that's dead-on-arrival UX (PRO-HIGH).
- **License tiers are global price points, not per-image.** A million-dollar Annie-Leibovitz frame and a $50 stock shot share `license_price_editorial_cents`; no per-image price override (PRO-HIGH).
- **No Stripe Tax / VAT collection, no multi-currency.** USD-only checkout; an EU client gets no VAT invoice and a JP client pays in USD (PRO-HIGH for editorial/agency).
- **Webhook handles only `checkout.session.completed`.** No `charge.refunded` (admin-side refunds reach the DB but Stripe-dashboard refunds don't), no `charge.dispute.created` (chargebacks silently leave entitlements active), no `checkout.session.async_payment_succeeded` (ACH/SEPA flows perma-fail) (PRO-CRIT).
- **No customer order portal.** Buy → email link with token → token used = customer has no way to revisit their purchase. If they lose the email, the only recovery path is "ask the photographer" (PRO-HIGH).
- **No per-image download counter, no per-shared-group view limit, no per-topic branding, no print-lab fulfillment, no embed code, no second-shooter attribution.** Each individually a smaller gap; collectively they signal that the storefront was built for a single-photographer-selling-stock model rather than a multi-client deliverable model.

The Stripe core works. The pro-photographer workflow on top of it does not. Treat this as a list of work items, prioritized by how badly each gap breaks a real shoot.

---

## Findings

### PRO-CRIT-01 — Zero watermarking in the image pipeline

**File:** `apps/web/src/lib/process-image.ts` (entire file — search for `watermark` returns 0 hits across all of `apps/web/src`; sharp's `composite()` is used only by `histogram.tsx` and `data-timeline.ts`, never on photo derivatives).
**Severity:** PRO-CRIT
**Failure scenario:** A wedding photographer delivers a 600-photo gallery to the bride for selection. Industry convention is a discreet logo bottom-right corner on every preview JPEG/WebP/AVIF. Without it, the bride's mother screen-grabs every photo and prints them at Costco; the photographer never sees a print order or the selection-fee revenue. For an editorial pro doing on-spec submissions to a magazine, the same gallery is forwarded to a competing publication without attribution. The current pipeline produces clean, watermark-free derivatives at every size.
**What exists:** `process-image.ts` resizes + colour-converts via sharp; the `licensePrices` Buy button on `photo-viewer.tsx:450` hides the gratis JPEG download for paid tiers (cycle 1 RPF C1RPF-PHOTO-LOW-02), but the displayed image itself is the same clean derivative every visitor can right-click.
**Fix:**
1. Add an admin setting `watermark_enabled` + `watermark_image_filename` + `watermark_position` (`bottom-right`/`tile`) to `GALLERY_SETTING_KEYS` in `apps/web/src/lib/gallery-config-shared.ts:10`.
2. In `process-image.ts`, after the resize step and before the colour-conversion roundtrip, run `sharp(buffer).composite([{ input: watermarkBuffer, gravity: 'southeast', blend: 'over' }])` for derivatives served by `/uploads/{webp,avif,jpeg}/`. The original at `/uploads/original/` MUST stay clean — it's served only to entitled buyers via `/api/download/[imageId]/route.ts:182`.
3. Add a per-tier override: `entitlements.tier === 'editorial' | 'commercial' | 'rm'` → clean original served from /api/download (already correct); `tier === 'none'` (free download button on `photo-viewer.tsx:844-855`) → the JPEG derivative is already watermarked from step 2.
4. Add a per-topic toggle so personal-portfolio topics aren't forced to watermark.

---

### PRO-CRIT-02 — Webhook handles only `checkout.session.completed`; no refund / dispute / async-payment events

**File:** `apps/web/src/app/api/stripe/webhook/route.ts:79`
```ts
if (event.type === 'checkout.session.completed') { … }
return NextResponse.json({ received: true }, { headers: NO_STORE });
```
**Severity:** PRO-CRIT
**Failure scenario:**
- **Refund-via-Stripe-dashboard**: a wedding photographer issues a refund directly in the Stripe dashboard (the more common path than logging into the gallery admin), Stripe fires `charge.refunded`, the webhook quietly returns 200 — `entitlements.refunded` stays `false`, the customer can still download. The gallery's refund UX (`sales.ts:163` `refundEntitlement`) only flips the flag when refund is initiated via the gallery admin.
- **Chargeback**: a buyer disputes the charge with their bank, Stripe fires `charge.dispute.created`. Today the webhook ignores it, the entitlement stays active, the customer can keep downloading the original while the dispute is open — the photographer loses the original AND the money.
- **ACH / SEPA / Boleto**: cycle 3 RPF correctly added the `payment_status === 'paid'` gate (line 96), but there's no `checkout.session.async_payment_succeeded` handler. The async-paid customer gets a "completed" toast on the gallery (cycle 1 RPF `checkoutStatus='success'`) and never receives a download token because the webhook bails at line 108. PRD docstring explicitly calls this out as a TODO ("Async-paid flows are not currently supported") but the photographer never sees this — they just see Stripe Checkout offering ACH.
**Fix:**
1. Add branches for `charge.refunded` and `charge.dispute.created`. Look up entitlement by `payment_intent` (need to either store `payment_intent_id` on entitlements at insert or query Stripe), set `refunded: true` and null `downloadTokenHash`. For disputes also block downloads (add `disputed: boolean` column).
2. Add `checkout.session.async_payment_succeeded` to mint the entitlement for ACH/bank-transfer flows. Mirror the existing idempotent insert.
3. Add `checkout.session.async_payment_failed` to NOT mint and to surface as a failed-payment row in admin /sales.
4. Either disable async payment methods in `checkout.sessions.create` (add `payment_method_types: ['card']`) OR document this as a feature switch — silent half-coverage is worse than either extreme.

---

### PRO-CRIT-03 — No password protection on shared galleries

**File:** `apps/web/src/db/schema.ts:100-108` (`sharedGroups` table — no `password_hash` column)
```ts
export const sharedGroups = mysqlTable("shared_groups", {
    id: int("id").primaryKey().autoincrement(),
    key: varchar("key", { length: 255 }).notNull().unique(),
    view_count: int("view_count").default(0).notNull(),
    expires_at: datetime("expires_at", { mode: 'string' }),
    created_at: timestamp("created_at")…
});
```
**Severity:** PRO-CRIT
**Failure scenario:** A wedding photographer shares `https://gallery.atik.kr/g/aB3kPq2x9z` with the couple for selection. The bride forwards the URL to her sister; the sister forwards it to an open Slack channel; a stranger lands on the gallery and downloads watermarked JPEGs (or, given PRO-CRIT-01, clean JPEGs). Industry convention for any private deliverable is a per-gallery password the photographer separately texts to the couple. Pixieset, ShootProof, Pic-Time, SmugMug, Squarespace Galleries — every commercial competitor has this.
**What exists:** Only the random base56 10-char URL slug (`sharing.ts:19,239`). Rate-limit on key enumeration is correct (`sharing.ts:107`), but a forwarded URL is identical to a guessed URL.
**Fix:**
1. Schema migration: add `password_hash varchar(96)` (nullable) and `password_set_at timestamp` to `sharedGroups`.
2. Hash with argon2 on the same parameters used by `lib/password-hashing.ts` (already in repo for admin auth).
3. New server action `setSharedGroupPassword(groupId, password)` requiring `requireSameOriginAdmin()`.
4. New server action `verifySharedGroupPassword(key, password)` issuing a short-lived signed cookie (`sg_<groupId>_unlocked`, signed with `SESSION_SECRET`, 7-day TTL).
5. In `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:79`, after the rate-limit check, look up `password_hash`. If set and cookie not present → render password gate component (matching existing admin-login UI conventions). Don't 404; the URL is correct, just locked.
6. The `/s/[key]` single-photo share probably doesn't need password (URL-only share is the design intent there) — but `imageReactions` POST should also be gated when the parent group is password-locked.

---

### PRO-CRIT-04 — No client-picks / favorites flow

**Files:**
- `apps/web/src/db/schema.ts:173` (`imageReactions` — anonymous, hashed visitor ID, no group context).
- Searched `picks|favorites|selections|client_picks` across `apps/web/src` — zero hits.
**Severity:** PRO-CRIT (for wedding/portrait/editorial pros; LOW for fine-art print)
**Failure scenario:** The pro proofing flow is: photographer uploads 500 photos → client logs into the gallery → client marks 50 picks → photographer delivers full-res for those 50. The current product has only `imageReactions`: a public hashed-cookie heart count, displayed as `Heart` in `photo-viewer.tsx:434`. Two failure modes:
1. **Photographer can't see "the bride's picks"** — the data model has no concept of "this visitor selected these 50 photos for delivery." `image_reactions.visitor_id_hash = SHA-256(visitor_uuid + YYYY-MM-DD)` is intentionally anonymized AND **rotates every day** (per `db/schema.ts:171` comment), so even within the same browser the bride's Tuesday picks are a different visitor than her Thursday picks. The admin has no "show me visitor X's picks" report.
2. **Client can't undo / reconsider** — anonymous like-toggles don't survive cookie clear, browser switch, or the day rolling over.
**Fix (minimal):**
1. Add `gallery_picks` table:
   ```sql
   CREATE TABLE gallery_picks (
     id INT AUTO_INCREMENT PRIMARY KEY,
     shared_group_id INT NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
     visitor_token_hash VARCHAR(64) NOT NULL,  -- bound to a long-lived cookie issued by the gallery, NOT day-rotated
     visitor_label VARCHAR(255),               -- optional "Sarah B." set by the visitor
     image_id INT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
     note TEXT,                                -- "use this for the album"
     picked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(shared_group_id, visitor_token_hash, image_id)
   );
   ```
2. Issue `visitor_token` cookie on first POST to `/api/picks/[groupId]/[imageId]` — opaque random token, 90-day TTL, signed with `SESSION_SECRET`. Survives day rollover (the existing `imageReactions` rotation is good for like-counter privacy but bad for a multi-session selection workflow).
3. Optional `visitor_label` field on the gallery page — "Who's selecting? (so the photographer knows)" — voluntary, not auth.
4. New admin route `/admin/sales/picks/[groupId]` showing `[visitor_label, count, last_picked_at]` rows, click into per-image grid with picks highlighted.
5. CSV export of picks.
6. Send the bride a passwordless magic link to come back and continue selecting (overlap with PRO-HIGH-08 below).

---

### PRO-HIGH-01 — `sharedGroups.expires_at` exists in schema but is unreachable from admin UI

**Files:**
- Schema: `apps/web/src/db/schema.ts:104` — `expires_at: datetime("expires_at", { mode: 'string' })` (nullable).
- Read enforcement: `apps/web/src/lib/data.ts:991-1000` — correct, gates the SELECT with `expires_at > NOW() OR expires_at IS NULL`.
- Write path: `apps/web/src/app/actions/sharing.ts:241-244` — `tx.insert(sharedGroups).values({ key: groupKey })` — never sets `expires_at`.
- Search for `setExpiresAt|update.*expires|expire.*share` across the admin UI: zero hits.
- Cleanup: `apps/web/src/lib/image-queue.ts:457` purges `sessions` only; no analogous sweep for expired share groups or expired entitlements.
**Severity:** PRO-HIGH
**Failure scenario:** A photographer wants to send an editorial agency a 30-day review window. The schema column is there, the read path enforces it, but no `createGroupShareLink(imageIds, { expiresAt: ... })` overload exists, no admin UI sets it. Result: every share is permanent, every URL leak is permanent. Photographer manually deletes the group when they remember to.
**Fix:**
1. Add `expiresInDays?: number | null` parameter to `createGroupShareLink` (`sharing.ts:179`). Translate to `new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')` and write into the `tx.insert(sharedGroups).values(...)` payload.
2. Add a `setSharedGroupExpiry(groupId, expiresAt | null)` action so the photographer can extend or shorten in flight.
3. Surface `expires_at` in the admin /admin/dashboard share-link card with a date picker.
4. Add a sweep in `image-queue.ts` next to the session-purge pattern at line 457:
   ```ts
   await db.delete(sharedGroups).where(sql`${sharedGroups.expires_at} IS NOT NULL AND ${sharedGroups.expires_at} < NOW() - INTERVAL 30 DAY`);
   ```
   30-day grace period after expiry so the audit log can correlate with the `group_share_create` entry. CASCADE on `sharedGroupImages` already handles the link table.
5. Surface "expired N days ago" in admin so the photographer can choose to extend rather than recreate.

---

### PRO-HIGH-02 — License tiers are global; no per-image price override

**Files:**
- Schema: `apps/web/src/db/schema.ts:55` — `license_tier varchar(16) NOT NULL DEFAULT 'none'`. No `license_price_cents` column on `images`.
- Tier → price lookup: `apps/web/src/app/api/checkout/[imageId]/route.ts:41-52` — `getTierPriceCents(tier)` reads `admin_settings.license_price_${tier}_cents`. Same price for every image with that tier.
- Tier allowlist: `apps/web/src/lib/license-tiers.ts:17` — `['editorial', 'commercial', 'rm']`.
**Severity:** PRO-HIGH
**Failure scenario:** A landscape pro has two photos in their commercial-license bucket: a quick stock-style shot ($150) and a 16-hour-composite portfolio piece ($2,500). Today both checkout for whatever `license_price_commercial_cents` says. Either the stock shot is over-priced and never sells or the portfolio piece is under-priced and the photographer torches their licensing margin. Editorial pros face the same with one-week-exclusive vs perpetual rates.
**Fix:**
1. Add nullable `license_price_override_cents int` to `images`. NULL → fall through to global tier price; non-NULL → use this.
2. In `checkout/[imageId]/route.ts`, change `getTierPriceCents` to accept the image row and return `image.license_price_override_cents ?? globalTierPrice`. Keep the `priceCents <= 0` reject.
3. Surface the override in the admin image-manager / bulk-edit dialog. Default to "use tier price" with a "set custom price" expander.
4. Stripe `product_data.name` in checkout already includes the tier name; consider adding the photo title regardless of override (already done — line 144).
5. **Multi-tier per image (the deeper question):** today an image can be "editorial OR commercial," not both at different prices. A real photo is often both — editorial $500/year, commercial $5k. To do this right, replace `images.license_tier varchar` with a `image_licenses(image_id, tier, price_cents)` table; the Buy button then surfaces a tier picker. This is bigger surgery; flag for v2.

---

### PRO-HIGH-03 — No bundled-zip delivery for multi-photo purchases / picks

**Files:**
- `apps/web/src/app/api/download/[imageId]/route.ts` (entire file — single-image, single-token, streams one original).
- Searched `archiver|yazl|jszip|adm-zip|node-stream-zip` across the repo: zero hits.
- `package.json` does not include any zip lib.
**Severity:** PRO-HIGH
**Failure scenario:** A wedding photographer's bride pays for 50 selected photos. With the current flow, that's 50 separate Stripe checkouts (or, less plausibly, a manual-distribution run where the photographer emails 50 download links). Either way the bride downloads files one at a time. Compare this to ShootProof's "Download All" button that streams a single zip.
**Fix:**
1. Add `archiver` (or `yazl` for streaming-no-buffer behavior) to `apps/web/package.json`.
2. Schema: extend `entitlements` to a `bundle_entitlements` model — `entitlement_id, image_id` row per photo in the bundle. Or simpler v1: add `bundle_image_ids json` to `entitlements` and let the download route stream a zip of every listed file.
3. New route `GET /api/download/bundle/[entitlementId]?token=...` — same single-use atomic claim pattern as `/api/download/[imageId]`, but pipes a `archiver('zip', { store: true })` stream (originals are already JPEGs — no value re-zipping). Set `Content-Type: application/zip` and `Content-Disposition: attachment; filename="picks-${groupKey}.zip"`.
4. Stripe `line_items` should bill per-image-in-bundle so the receipt itemizes; OR a single line-item with the bundle name and a metadata array.
5. Token shape: keep `dl_<base64url>` (per `download-tokens.ts:21`) — same generator, same hash.
6. Single-use claim is even more important here; once consumed, the bride has the zip and the photographer is done.

---

### PRO-HIGH-04 — No customer order history / token resend

**Files:**
- Searched `order.history|customer.orders|my.purchases|my.orders`: zero hits.
- Searched `resend.*download|reissue.*token|recover.*token`: zero hits.
- Plaintext token surfaces only via `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` (`webhook/route.ts:345-349`) — opt-in operator-only, never the customer.
**Severity:** PRO-HIGH
**Failure scenario:** Customer pays $500 for a commercial license, Stripe receipt arrives, photographer (manually, via the docker logs grep workflow) emails the download token. Customer's email server marks it as junk; customer deletes it. Three months later customer rebuilds their server and asks for the file again. Today: the only path is "ask the photographer, who looks up the entitlement in admin /sales and... reissues a token? No, that flow doesn't exist either." `entitlements.downloadTokenHash` is nulled after first use (`/api/download/[imageId]/route.ts:165`). Token is unrecoverable.
**Fix:**
1. New action `reissueDownloadToken(entitlementId)` requiring `requireSameOriginAdmin()` — generate fresh token, write hash, reset `downloaded_at` to NULL, push expiry to `NOW() + 24h`, return plaintext token to admin (one-shot reveal). Surface as a "Reissue" button next to "Refund" in `sales-client.tsx:248`.
2. Optional: a `/order/[sessionId]?email=…` public lookup that re-emails the token if `customer_email` matches and the entitlement isn't refunded. Rate-limited per-IP and per-email (use existing rate-limit lib at `lib/rate-limit.ts`). Email is the auth factor here — fine for a low-stakes "recover my $50 stock photo" flow.
3. A "your purchases" page presupposes accounts; no account system today, and adding one is a larger lift. Magic-link via `customer_email` is the lighter fix.

---

### PRO-HIGH-05 — No Stripe Tax / VAT collection; USD-only

**Files:**
- `apps/web/src/app/api/checkout/[imageId]/route.ts:140` — `currency: 'usd'` hardcoded.
- Searched `tax|vat|stripe.*tax`: only `error-shell.ts` matches (irrelevant).
- `stripe.checkout.sessions.create` call (lines 134-160) does not pass `automatic_tax`, `tax_id_collection`, or `customer_creation`.
**Severity:** PRO-HIGH (for editorial/agency working with EU/UK/CA clients; LOW for US-only consumer print)
**Failure scenario:** An EU agency buys an editorial license; the photographer (a one-person German GbR) is legally obliged to collect VAT and issue a VAT invoice. Today: USD charge, no VAT line, no VAT ID field, no invoice with the buyer's company VAT ID. The photographer manually fixes this in their accounting at year-end and probably eats the VAT.
**Fix:**
1. Configure Stripe Tax in the Stripe dashboard, then on the checkout call:
   ```ts
   automatic_tax: { enabled: true },
   tax_id_collection: { enabled: true },
   customer_creation: 'always',
   ```
2. `currency`: pull from a new admin setting `commerce_currency` (default 'usd'); validate against a Stripe-allowed list. Pricing settings in `gallery-config-shared.ts:33-35` would need a per-currency fan-out OR a canonical-currency-with-Stripe-conversion approach. The simpler v1 is "one currency per gallery instance, pick at setup."
3. Surface `tax_amount` and `tax_id` in the entitlement row + the admin /sales view so the photographer can reconcile.
4. Document the Stripe Tax setup steps in CLAUDE.md (currently silent on tax).

---

### PRO-HIGH-06 — No right-click / context-menu protection on proof galleries

**Files:** Searched `contextmenu|onContextMenu|right.click` across `apps/web/src/components` — zero matches in any image-rendering component (`photo-viewer.tsx`, `lightbox.tsx`, `image-zoom.tsx`, the `/g/[key]` masonry).
**Severity:** PRO-HIGH (CRIT for studio-portrait pros; OPT-OUT for fine-art who don't care)
**Failure scenario:** Pro proofing convention is split — wedding/portrait pros want right-click "Save Image As" disabled on proof galleries (it doesn't stop a determined thief but it stops the casual mother-of-the-bride save), editorial/agency don't care because they're shipping watermarked JPEGs anyway. Today the gallery offers no toggle.
**Fix:**
1. Add admin setting `disable_right_click_on_shares` boolean. Per-topic override would be nice but a global setting is fine for v1.
2. In `photo-viewer.tsx` and the `/g/[key]` masonry `<Image>` components (line 184), add `onContextMenu={(e) => disableRightClick && e.preventDefault()}` when `isSharedView === true`.
3. Pair with CSS `user-select: none` and `-webkit-user-drag: none` on those `<img>` tags.
4. Document explicitly that this is a usability nudge, not a security boundary — the Save Image As path can always be reproduced from the network panel. The pros asking for this know that.

---

### PRO-HIGH-07 — No embed code generation for individual photos / topics

**Files:** Searched `embed|<iframe|<script.*async`: only matches are general-purpose (sanitize tests, dialogs). No embed-snippet emission anywhere.
**Severity:** PRO-MED
**Failure scenario:** A pro keeps a portfolio at `me.example.com` and wants to embed a single photo or a topic-as-grid in their case-study page. With Pixieset / SmugMug / Pic-Time, "Embed" is a button that emits `<iframe src="…/embed/photo/123" width=… height=… />`. The gallery has no equivalent — the pro screenshots the photo or hotlinks the AVIF directly (which then breaks the moment the gallery re-encodes derivatives or rotates filenames).
**Fix:**
1. New route `/embed/photo/[id]` — server-rendered, no app chrome, just the `<picture>` srcset block from `photo-viewer.tsx:373-398` plus a "view on gallery.atik.kr" backlink at the bottom.
2. New route `/embed/group/[key]` — masonry-only, no nav, no admin gear.
3. Set `Content-Security-Policy: frame-ancestors *` (or a configurable allowlist) and `X-Frame-Options` removed for these routes only.
4. In `photo-viewer.tsx` next to the Share button (line 513), add an "Embed" action that opens a dialog with the prefilled `<iframe>` snippet at recommended dimensions.
5. The OG image route at `apps/web/src/app/api/og/photo/[id]/route.tsx` already exists for social sharing — embed is the natural progression. Reuse the same image-URL construction.

---

### PRO-HIGH-08 — No order-resume after token loss; no email pipeline at all

**Files:**
- `apps/web/src/app/api/stripe/webhook/route.ts:296` — `// TODO(US-P54-phase2): replace this scaffold with the email pipeline.`
- Search for `nodemailer|resend|@sendgrid|mailer`: zero matches in source — confirmed there's no email client.
- The customer-facing distribution path is **operator-runs-grep-on-docker-logs** (line 345-349, opt-in via `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`).
**Severity:** PRO-HIGH (CRIT if a single sale slips through the cracks)
**Failure scenario:** Photographer runs a clean default deployment with `LOG_PLAINTEXT_DOWNLOAD_TOKENS=false`. A buyer pays. The webhook persists the entitlement, the hash is in the DB, and **literally no human or system has the plaintext token to send**. The PRD docstring acknowledges this — the gallery currently relies on the photographer opting into the log-grep workflow. That works for a hobbyist; it does not work for someone selling 100 stock licenses a month.
**Fix:**
1. Add an email transport behind a single `lib/email.ts` interface so providers (Resend / SES / Postmark) are swappable. Add `EMAIL_PROVIDER` and `EMAIL_FROM` env vars.
2. In `webhook/route.ts` after the entitlement insert (line 315), call `sendDownloadEmail({ to: customerEmail, token: downloadToken, image, tier })`. Failure to send must NOT 500 the webhook (would trigger Stripe retry → duplicate entitlements via the idempotency guard, which is fine, but better to log + continue).
3. Add "resend" admin button (covered in PRO-HIGH-04).
4. Do NOT send the plaintext token over a non-TLS link; document this as required.
5. Add subject-line and from-name customization (overlap with PRO-LOW-01 below).

---

### PRO-HIGH-09 — No per-image download counter; no per-shared-group view limit

**Files:**
- `images.reaction_count` exists (`schema.ts:59`), `image_views` table exists (`schema.ts:196`), `shared_group_views` exists (`schema.ts:218`) — analytics are good.
- Searched `download_count|download_counter|downloads_per_image`: zero hits.
- Searched `view_limit|max_views|view_count.*limit`: zero hits.
**Severity:** PRO-MED
**Failure scenario:**
1. Photographer wants to know "how many people downloaded this stock photo this month." Today there's no answer — `entitlements` has `downloaded_at` (single boolean per entitlement, not a counter), `image_views` tracks displays not downloads. A column needs to exist.
2. Photographer wants a one-time-share-link for a high-value editorial preview ("anyone who clicks this once locks the gallery"). Today there's no `view_count_limit` cap; `view_count` accumulates indefinitely.
**Fix:**
1. Add `images.download_count int NOT NULL DEFAULT 0`. Bump in the atomic-claim path in `download/[imageId]/route.ts:163-169`:
   ```ts
   await db.update(images).set({ download_count: sql`${images.download_count} + 1` }).where(eq(images.id, imageId));
   ```
   Surface in admin /sales next to view count.
2. Add `shared_groups.view_limit int` (nullable). In `getSharedGroup` (`data.ts:981`), reject if `view_count >= view_limit`. Pair with a "lock after N views" admin checkbox.
3. Both are small, additive fields — low-risk.

---

### PRO-MED-01 — License tier UX surface is a single global tier per image; no per-image multi-tier picker

**Files:** `apps/web/src/components/photo-viewer.tsx:450-495` — Buy button reads `image.license_tier` directly, looks up `licensePrices[image.license_tier]`. A photo with `license_tier='editorial'` cannot also be sold as commercial.
**Severity:** PRO-MED (depending on photographer mix)
**Failure scenario:** Same image, same admin: a magazine buys a one-year editorial license at $400, a beverage company buys a perpetual commercial license at $4,000. Today the admin has to flip the image's tier between sales (which retroactively confuses the audit trail and the existing entitlement records). Schema `license_tier varchar(16)` is single-valued.
**Fix:** Same as PRO-HIGH-02 step 5 — replace `images.license_tier` with a per-image `image_licenses(tier, price_cents)` join. Surface a tier-picker dropdown in the Buy button when more than one tier is configured. Stripe `metadata.tier` already exists at checkout (line 154); the webhook tier-validation (line 201) already accepts the picked tier. The change is upstream from the webhook.

---

### PRO-MED-02 — Stripe customer portal not linked / used

**Files:** Searched `customer.portal|billingPortal|billing_portal`: zero hits.
**Severity:** PRO-MED
**Failure scenario:** Customer wants to update their email on file (a forwarding alias broke), see all their past purchases, download the receipts. Stripe ships this for free as the Customer Portal — a hosted page at `https://billing.stripe.com/p/...` that takes a single API call (`stripe.billingPortal.sessions.create`). The gallery doesn't link to it; the photographer ends up doing email-to-Stripe-dashboard lookups by hand.
**Fix:**
1. After payment success (PhotoViewer's `checkoutStatus === 'success'` branch, `photo-viewer.tsx:108`), surface a "Manage your purchase →" CTA that POSTs `/api/customer-portal` with the session_id, server creates a billing-portal session, returns the URL.
2. Stripe `customer_creation: 'always'` (already required for PRO-HIGH-05) is the prerequisite — Customer Portal needs a Customer object.
3. Document in CLAUDE.md.

---

### PRO-MED-03 — Topics support event-style slugs but no collision-handling guidance for "john-and-jane-2026" patterns

**Files:**
- `apps/web/src/db/schema.ts:5` — `topics.slug varchar(255) PRIMARY KEY`. Free-form, admin sets it.
- `apps/web/src/app/actions/topics.ts:100-105` — `isValidSlug(slug)` + `isReservedTopicRouteSegment(slug)` + duplicate-detect via the lock at `withTopicRouteMutationLock`.
- Aliases supported via `topicAliases` (`schema.ts:14`).
**Severity:** PRO-MED — actually works, just under-documented
**Failure scenario:** A wedding pro shoots 40 weddings a year. Each gets a topic at `/john-and-jane-2026`. Today this works (slugs are free-form), and aliases support `/jj-2026 → /john-and-jane-2026` redirect. But:
1. There's no auto-slug generator from the gallery title — the admin types the slug by hand each time, error-prone.
2. There's no per-topic visibility flag for "private clients only" vs "public portfolio" — `map_visible` exists but it's GPS-only.
3. Collision handling on duplicate slugs is correct (`ER_DUP_ENTRY` returns `slugAlreadyExists`) but doesn't suggest a fixup ("did you mean `john-and-jane-2026-2`?").
**Fix:**
1. Add a `slugify(label)` helper that's wired into the topic-create form's onChange (label → suggested-slug, admin can override).
2. Add `topics.is_public boolean NOT NULL DEFAULT true`. Public-true is the existing portfolio behavior; public-false means "only reachable via the per-share-group link or admin." This shifts the wedding pro from "everything I shoot is on the open homepage" to "only the curated portfolio is."
3. On `ER_DUP_ENTRY`, append a numeric suffix and retry — same loop pattern as `createPhotoShareLink` (`sharing.ts:125-176`).

---

### PRO-MED-04 — No print-fulfillment integration / external print-partner field

**Files:** Searched `print|whitewall|prodpi|bay.photo|fulfillment`: only matches are CSS print stylesheets, JSON output, etc. — no print-lab integration.
**Severity:** PRO-MED (CRIT for fine-art print sellers; LOW for everyone else)
**Failure scenario:** A landscape pro sells prints — 16×24 archival pigment, 24×36 metal, etc. — through Bay Photo or WhiteWall (the photographer-grade labs). Today the gallery sells *download licenses* via Stripe; there's no print SKU, no size picker, no fulfillment hand-off. A potential buyer who wants a print has no path. Even a primitive "Want a print? Email me at hello@example.com" admin field would help.
**Fix:**
1. **v0:** Add admin setting `print_partner_url` (string, optional). When set, surface a "Order a print →" button next to the Buy/Download button on `photo-viewer.tsx`. Plain external link.
2. **v1:** Per-image print product configuration: SKU, size, paper, lab. Stripe `price_data` per SKU. Webhook fans out to a fulfillment partner via their API (Bay Photo + ProDPI both have APIs). This is an entire feature; flag for v2.
3. Either way — `license_tier='print'` could plug into the existing tier allowlist with minimal disruption (`lib/license-tiers.ts:17`).

---

### PRO-MED-05 — Per-topic branding (theme color, logo, custom CSS) absent

**Files:** Searched `brand|theme_color|custom_css|logo_override|topic_branding`: zero topic-scoped matches.
**Severity:** PRO-MED
**Failure scenario:** A photographer runs a multi-photographer studio (two shooters, one website). They want each shooter's gallery to render under that shooter's brand — different accent colour, different logo. Today the entire gallery shares `site-config.json` and a global tailwind theme.
**Fix:**
1. Add `topics.theme_color varchar(7)` (hex), `topics.logo_filename varchar(255)`, `topics.custom_css text` (sanitized).
2. Inject a per-topic `<style>` block in `app/[locale]/[topic]/layout.tsx` with sanitized custom CSS scoped to a topic-specific class.
3. `custom_css` MUST be sanitized — any free-form CSS from admin input is a vector for `url()` exfiltration (a CSS resource hint to a tracking domain on the photographer's wedding gallery is a privacy own-goal). Allowlist properties.
4. Per-topic favicon — separate route `/api/favicon/[topic]/route.ts` returning the topic logo cropped to favicon dimensions.

---

### PRO-MED-06 — No second-shooter / multi-photographer attribution per image

**Files:** `apps/web/src/db/schema.ts:19-79` — `images` has no `photographer_id`, `creator`, `attribution`, or `byline` field.
**Severity:** PRO-MED
**Failure scenario:** A wedding pro brings a second shooter ("getting-ready" coverage). The photographer is the legal author of half the gallery; the second shooter holds copyright on the other half (per their work-for-hire contract). Today the gallery has no `creator_name` / `creator_url` / `creator_email` fields on images. EXIF carries it (the Artist tag), but the gallery doesn't surface it on the photo page or expose it to search engines via `<meta name="creator">`.
**Fix:**
1. Add `images.creator_name varchar(255)` and `images.creator_url varchar(500)` (nullable, defaults to admin's profile).
2. Surface in `photo-viewer.tsx` info sidebar next to the EXIF block (`photo-viewer.tsx:674`).
3. Emit `<meta name="creator" content="...">` in the photo-page metadata.
4. Auto-populate from EXIF Artist tag during upload processing in `process-image.ts`.
5. For the multi-shooter studio case (PRO-MED-05), also tie this to a per-topic default creator.

---

### PRO-LOW-01 — Stripe customer email lacks photographer branding

**Files:**
- `webhook/route.ts:134-160` — `stripe.checkout.sessions.create` does not pass `payment_intent_data.statement_descriptor`, `payment_intent_data.description`, or `customer_email_subject`. Receipt emails are entirely Stripe-default.
**Severity:** PRO-LOW
**Failure scenario:** Customer pays $200 to "ATIK.KR PHOTO" (the Stripe statement descriptor) and gets a receipt from `noreply@stripe.com`. Doesn't feel like a transaction with a real photographer. A pro using Squarespace Commerce or Shopify has full control over receipt branding.
**Fix:**
1. Configure custom-domain receipt in Stripe Dashboard → Settings → Branding (free, no code change).
2. Pass `statement_descriptor_suffix: 'PHOTOGRAPHER'` on the PaymentIntent (Stripe limits to 22 chars total combined with prefix).
3. Once email pipeline ships (PRO-HIGH-08), our own from-line branding solves this entirely.

---

### PRO-LOW-02 — Watermark personalization for print not in scope, but flag for product roadmap

**Files:** N/A (entire feature absent)
**Severity:** PRO-LOW
**Failure scenario:** Some labs (WhiteWall, Bay Photo) print purchaser metadata on the back of fine-art prints — purchaser name, license type, edition number. Out of scope for v1, but worth flagging now so the schema accommodates it. `entitlements` already tracks `customer_email`, `tier`, `amount_total_cents`; adding `purchaser_name` and `license_certificate_pdf_url` later is straightforward.

---

## Verification Notes

| Claim | Evidence |
|---|---|
| No watermark code | `Grep "watermark" apps/web/src` → 0 hits; `composite` only in histogram, error-shell, data-timeline |
| Webhook handles only `checkout.session.completed` | `webhook/route.ts:79`; no other `event.type` branches |
| `expires_at` write-side missing | `Grep "setExpiresAt|update.*expires"` returns no source-code hits; `sharing.ts:241-244` insert never sets it |
| No password column | `Grep "password" schema.ts` → only `password_hash` on `admin_users`; nothing on `sharedGroups` |
| No picks flow | `Grep "picks|favorites|selections"` returns 0 hits in `apps/web/src` |
| No zip dep | `Grep "archiver|yazl|jszip|adm-zip"` returns 0 hits in repo |
| No customer portal | `Grep "customer.portal|billingPortal"` returns 0 hits |
| No tax | `Grep "tax|vat|stripe.*tax"` returns 0 source hits |
| No order history | `Grep "order.history|customer.orders|my.purchases"` returns 0 hits |
| No download counter | `Grep "download_count|download_counter"` returns 0 hits |
| No view limit | `Grep "view_limit|max_views"` returns 0 hits |
| No print partner | `Grep "print|whitewall|prodpi|bay.photo|fulfillment"` returns no integration matches |
| No multi-shooter | `Grep "creator|photographer_id|attribution|second_shooter" schema.ts` returns 0 hits |
| No per-topic branding | `Grep "brand|theme_color|custom_css|logo_override|topic_branding"` returns 0 topic hits |
| No email pipeline | `Grep "nodemailer|resend|@sendgrid|email_pipeline"` returns 0 hits |
| No right-click guard | `Grep "contextmenu|onContextMenu|right.click" components` returns 0 hits in image components |
| No embed surface | `Grep "embed|<iframe|<script"` returns no embed-snippet emission |
| No token resend | `Grep "resend.*download|reissue.*token"` returns 0 hits |

## Severity Roll-Up

| Severity | Count |
|---|---|
| PRO-CRIT | 4 (watermark, webhook coverage, password, picks) |
| PRO-HIGH | 9 (expiry UI, per-image price, zip, order history, tax, right-click, embed, email, download counter) |
| PRO-MED | 6 (multi-tier, customer portal, slugs, print, branding, attribution) |
| PRO-LOW | 2 (email branding, print-back metadata) |

## Recommended Sequencing

1. **Watermark** (PRO-CRIT-01) — single biggest blocker for any pro; touches `process-image.ts` only; ~1 day.
2. **Webhook coverage** (PRO-CRIT-02) — refund/dispute/async branches; ~1 day; pairs with adding `payment_intent_id` on entitlements.
3. **Password protection + expiry UI** (PRO-CRIT-03 + PRO-HIGH-01) — single-table-extension to `sharedGroups`; cohesive feature; ~2 days.
4. **Email pipeline + token resend** (PRO-HIGH-08 + PRO-HIGH-04) — closes the manual-distribution gap that the PRD already flags as TODO; ~1.5 days.
5. **Picks flow** (PRO-CRIT-04) — net-new feature, not a fix; ~3-5 days; prerequisite for any "pro proofing" claim.
6. **Per-image price + bundled-zip** (PRO-HIGH-02 + PRO-HIGH-03) — converge into the multi-tier-with-bundles model; ~3 days.
7. **Tax + customer portal** (PRO-HIGH-05 + PRO-MED-02) — Stripe-config-heavy, light on app code; ~1 day.
8. The remainder are smaller and can be sequenced as the customer base demands.

