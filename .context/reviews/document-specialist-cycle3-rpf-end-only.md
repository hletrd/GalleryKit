# Document Specialist Review — Cycle 3 RPF (end-only)

Agent: document-specialist
Scope: docs ↔ code consistency, env-var docs, CLAUDE.md, README.md, JSDoc.

## Inventory

- `apps/web/README.md` (Stripe paid-downloads section + general docs)
- `apps/web/.env.local.example`
- `apps/web/CLAUDE.md` (referenced by review only — top-level CLAUDE.md is the source of truth)
- `CLAUDE.md` (repo root)
- JSDoc on lib/* and route.ts files

## Findings

### C3RPF-DOC-MED-01 — README "Manual download distribution" doc-vs-code mismatch on payment_status

- File: `apps/web/README.md:63-75`
- Severity: **Medium** | Confidence: **High**
- The README says "When a customer completes checkout, the webhook generates a single-use download token". This is mostly true for card payments but false for async-pay (`payment_status: 'unpaid'`). If/when C3RPF-CR-HIGH-01 is fixed, the docs need an update: "for `payment_status: 'paid'` events only".
- **Fix:** Coordinate doc + code update. After the gate lands, README should say: "When `checkout.session.completed` fires for a session with `payment_status: 'paid'`, the webhook ...".

### C3RPF-DOC-MED-02 — `data/uploads/original/` path not documented in deployment doc

- Files: `apps/web/src/app/api/download/[imageId]/route.ts:120`, `apps/web/README.md`
- Severity: **Medium** | Confidence: **High**
- The download route reads from `data/uploads/original/`. The CLAUDE.md says "Images stored in `apps/web/public/uploads/`". The README does not call out the discrepancy. If a self-hoster bind-mounts only `public/uploads`, paid downloads break ENOENT.
- **Fix:** Either harmonize paths (preferred — see architect C3RPF-ARCH-LOW-04) or add a "Storage paths for paid downloads" section to README explicitly listing which directories must be writable / bind-mounted.

### C3RPF-DOC-LOW-01 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` env var docs lack retention warning

- File: `apps/web/README.md:67-75`, `apps/web/.env.local.example:78-80`
- Severity: **Low** | Confidence: **High**
- Cross-listed with security C3RPF-SEC-MED-02. The README mentions "do not leak tokens into log shippers without explicit opt-in" but does not warn about retention windows in log shippers (Loki, Datadog, CloudWatch). A self-hoster reading the README might enable the flag in production without realizing the token + email will be retained for 30-90 days in their log shipper.
- **Fix:** Add a sentence to README and `.env.local.example`: "Token + email are written to a single stdout line. Confirm your log retention is short or your log shippers redact this prefix before enabling in production."

### C3RPF-DOC-LOW-02 — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` lack rotation guidance

- File: `apps/web/README.md:52-57`, `apps/web/.env.local.example`
- Severity: **Low** | Confidence: **High**
- README says "Rotate STRIPE_SECRET_KEY → restart the web container; the SDK captures the value at first call." Good. But STRIPE_WEBHOOK_SECRET rotation is not documented (rolling secret rotation requires a transient overlap window). Operators rotating the webhook secret without overlap will see signature failures for in-flight events.
- **Fix:** Add a sentence on rotation strategy: "Stripe supports two webhook signing secrets simultaneously during rotation; configure both in the dashboard, then update STRIPE_WEBHOOK_SECRET, redeploy, and finally remove the old secret."

### C3RPF-DOC-LOW-03 — JSDoc on `getTotalRevenueCents` does not mention it is dead code

- File: `apps/web/src/app/actions/sales.ts:75-91`
- Severity: **Low** | Confidence: **High** (will be moot after CRITIC-05 fix)
- The action is dead code per critic CRITIC-05. JSDoc should reflect that, OR the action should be deleted. Cross-listed.

### C3RPF-DOC-LOW-04 — `apps/web/CLAUDE.md` does not exist, but root CLAUDE.md may have stale paths

- File: repo root `CLAUDE.md`
- Severity: **Low** | Confidence: **High**
- The repo root CLAUDE.md says "Images stored in `apps/web/public/uploads/`". The download route uses `data/uploads`. Either the route is wrong or the docs are wrong. **Verify and harmonize.** Cross-listed with critic CRITIC-09.

### C3RPF-DOC-LOW-05 — `lib/license-tiers.ts` JSDoc still says "Future admin UIs that surface tier choices" (unchanged from cycle 1)

- File: `apps/web/src/lib/license-tiers.ts:11-12`
- Severity: **Informational** | Confidence: **High**
- Doc still hints at future work; no harm. Skip.

### C3RPF-DOC-LOW-06 — `download-tokens.ts` JSDoc claims SHA-256 hex digest is persisted but does not say "lowercase"

- File: `apps/web/src/lib/download-tokens.ts:8-15`
- Severity: **Informational** | Confidence: **High**
- The shape regex enforces lowercase. The JSDoc should reflect "lowercase hex".
- **Fix:** Update JSDoc.

## Confirmed vs likely

- All confirmed (read source vs docs).
- C3RPF-DOC-LOW-04 needs deployment-topology verification.

## Cross-cutting

The README's "Paid downloads (Stripe — US-P54)" section is well-structured but references "phase 2 (email pipeline)" four times without a tracking link. Either link to an issue/plan doc, or remove the cross-references and consolidate the deferral note in one place.
