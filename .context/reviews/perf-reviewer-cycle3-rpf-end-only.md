# Performance Review — Cycle 3 RPF (end-only)

Agent: perf-reviewer
Scope: paid-downloads + cycles 1-2 RPF deltas. Performance angle.

## Inventory

Same as code-reviewer.

## Findings

### C3RPF-PERF-MED-01 — `getTotalRevenueCents` runs an unbounded SUM on every /admin/sales page load and is now dead code

- File: `apps/web/src/app/actions/sales.ts:75-91`, `page.tsx:10-13`
- Severity: **Medium** | Confidence: **High**
- The action is now used only as a zero-row fallback that returns 0 in the only case it fires (post P260-05). Each page load runs an extra `SELECT SUM(amount_total_cents) FROM entitlements WHERE refunded=false` — full-table scan in the worst case (no index on `refunded`). On a 100k-row entitlements table this is wasted IO per page load.
- **Fix:** Remove the action and the `Promise.all` arm in `page.tsx`. Cross-listed with `code-reviewer` C3RPF-CR-MED-02.

### C3RPF-PERF-LOW-01 — `Intl.NumberFormat` constructed once via `useMemo` is correct, but `makeCurrencyFormatter` swallows constructor errors silently

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:61-72`
- Severity: **Low** | Confidence: **High**
- `useMemo(() => makeCurrencyFormatter(locale), [locale])` rebuilds on locale change (correct). The `try { fmt = new Intl.NumberFormat(...) } catch { fmt = null }` catches the rare failure mode (unsupported locale on old engines) but never logs it, so a misconfigured locale silently falls back to the `$N.NN` fallback for the entire session. Negligible perf impact.
- **Fix:** Add a `console.warn` in the catch. Cosmetic.

### C3RPF-PERF-LOW-02 — `displayedRevenueCents` recomputed every render

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:150-152`
- Severity: **Low** | Confidence: **High**
- The reduce runs on every render. With ≤ 500 rows this is ~5 µs and not a hot path; but a `useMemo([rows])` would lock the contract.
- **Fix:** Wrap in `useMemo`. Negligible win, but cheap.

### C3RPF-PERF-LOW-03 — `photo-viewer.tsx` Buy IIFE recreates `Intl.NumberFormat` per render (still — C2 deferred this)

- File: `apps/web/src/components/photo-viewer.tsx:480-491`
- Severity: **Low** | Confidence: **High** (already C2-RPF-D01)
- The IIFE pattern recreates the formatter on every PhotoViewer render. Photo viewer renders frequently (any state change re-renders the toolbar). Profiling impact: minimal under current usage. Stay deferred unless profiling escalates.

### C3RPF-PERF-LOW-04 — Webhook `onDuplicateKeyUpdate({ set: { sessionId } })` is a no-op write that touches the row

- File: `apps/web/src/app/api/stripe/webhook/route.ts:140`
- Severity: **Low** | Confidence: **High**
- Stripe retries the same `sessionId` on transient failures. The current pattern executes a no-op UPDATE on the row (sessionId set to itself) — MySQL still touches the row, updates `updated_at` (none on this table — OK), but the write lock is held briefly. For a high-throughput store this means concurrent retries serialize through the same row.
- **Fix:** Use `INSERT IGNORE`-equivalent (`onDuplicateKeyUpdate` with NO set, which Drizzle does not support directly) or a SELECT-first pattern. Acceptable as-is at current scale.

### C3RPF-PERF-LOW-05 — `idx_entitlements_token_hash` covers fast lookup but the WHERE in download/route.ts is `(imageId, tokenHash)` composite

- File: `apps/web/src/db/schema.ts:264-265`, `apps/web/src/app/api/download/[imageId]/route.ts:59-63`
- Severity: **Low** | Confidence: **High**
- `idx_entitlements_token_hash` is single-column. The WHERE filter is `imageId = ? AND downloadTokenHash = ?`. Optimizer typically uses `idx_entitlements_token_hash` and filters; a composite index `(downloadTokenHash, imageId)` would be slightly tighter but at the cost of an extra index. Negligible at current scale; document for when entitlements grow.
- **Fix:** None required.

### C3RPF-PERF-LOW-06 — `path.resolve` on every download call

- File: `apps/web/src/app/api/download/[imageId]/route.ts:120-121`
- Severity: **Informational** | Confidence: **High**
- `path.resolve(process.cwd(), 'data', 'uploads', 'original')` runs every call. Could hoist to module level (constant). Negligible.

### C3RPF-PERF-LOW-07 — Status icon mapping in StatusBadge recreates per-row config object

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:84-99`
- Severity: **Informational** | Confidence: **High**
- The `cfg` object literal inside `StatusBadge` recreates on every render. With ≤ 500 rows = 500 small object allocations per render. Negligible. Worth hoisting to module scope (no `t` dependency) or `useMemo` keyed by `t`.
- **Fix:** Hoist the static parts (icon mapping, classes) to module scope; pass labels via props. Cosmetic.

## Confirmed vs likely

All findings are confirmed by reading source. None are urgent at current scale.
