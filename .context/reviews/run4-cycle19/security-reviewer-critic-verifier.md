# Run-4 Cycle 19 — security-reviewer + critic + verifier angle

Scope: the two SECURITY-CRITICAL lint-gate scripts (0 run-4 mentions),
ops scripts credential handling, e2e auth helpers, plus adversarial
verification of the cycle's headline correctness finding.

## Verifier adjudication of COR-R4C19-01 — CONFIRMED, evidence chain complete

Claim: `topicRouteSegmentExists` always returns true. Evidence verified
independently of the code-reviewer angle:
1. drizzle source: `mysql2/session.js:76` returns the raw mysql2
   `client.query()` result; `mysql-core/session.js:101` (`res[0][0]`)
   proves drizzle itself treats it as a tuple.
2. Stub-client execution: zero-row query → `[[],[]]`, length 2.
3. **Live MySQL execution** (gallerykit_e2e DB, nonexistent slug):
   `rows.length = 2`, `actual matching rows = 0`.
4. Counter-hypothesis ruled out: no monkey-patch in `src/db/index.ts`
   changes `db.execute`'s return shape — the `:74-90` query/execute
   pool patches only re-route through a dedicated connection and
   `return await` the same tuple. `mode: "default"` affects relational
   queries only.
5. Cross-consumer check: admin-tokens (4 sites), admin-backfill-runner
   (2 read sites), backfill-color-pipeline all unwrap `result[0]` —
   topics.ts and backfill-cicp-recheck are the only two raw consumers
   that do not (health route and UPDATE-only scripts ignore results).
Severity HIGH is justified: a core admin capability (topic create /
rename / alias-create) has been deterministically broken in production
for ~6 weeks. Not privilege-related, no injection angle (parameterized
SQL preserved), so not CRITICAL-security — HIGH-correctness.

## SEC-R4C19-06 — unguarded mass-NULL in migrate-titles.ts (MED-LOW / High)

Security lens: availability/integrity of admin-authored data. The repo
treats destructive ops behind flags/locks everywhere else (restore
advisory lock, `--force-reencode`, backup validation). This legacy
one-shot violates that posture: `db.execute(UPDATE images SET title =
NULL)` with zero ceremony. Schedule the additive refusal-flag guard;
script deletion stays an owner decision (DEF-R4C16-A precedent).

## Lint-gate scripts (check-api-auth.ts / check-public-route-rate-limit.ts)

- **check-api-auth.ts — fail-closed verified.** A route file whose
  handlers arrive via `export * from './impl'` yields
  `sawHandlerExport === false` → `:139` pushes "does not export any
  HTTP handlers" → **gate fails**. Aliased exports (`export { h as
  GET }`) fail at `:109`. Direct `export const GET = withAdminAuth(…)`
  with as/satisfies/parens unwrapping all verified. No bypass found.
- **OBS-R4C19-C (LOW/Medium): check-public-route-rate-limit is
  fail-open on the same star-re-export shape.** `:116-119` — zero
  detected mutating handlers → `passed: (no mutating handlers)`.
  A `route.ts` containing only `export * from './handlers'` (where
  handlers.ts exports POST) serves POST at runtime but passes the
  gate. No current public route uses star re-exports (verified by
  grep), and the author would be a repo contributor, but the asymmetry
  with its fail-closed sibling is exactly the kind of divergence this
  run keeps finding. Fix: treat `export * from` in a route file as a
  gate failure (conservative, zero current cost), mirroring
  check-api-auth's posture. Cheap hardening — schedule.
- `EXEMPT_TAG` string-stripping (`:124-127`) and comment-stripping
  (`:136-138`) orders are correct for their respective checks
  (tag must live in comments; helper calls must not). Naive regex
  string-stripping has theoretical multi-line-template edge cases —
  contributor-side CI gate, INFO, not scheduled.

## Credential handling sweep (scripts + e2e)

- `seed-admin.ts` / `migrate-admin-auth.ts`: weak-password denylist +
  16-char floor on plaintext bootstrap; hashes via shared
  `PASSWORD_HASH_OPTIONS`. Divergence: only migrate-admin-auth
  normalizes `$$argon2` (OBS-R4C19-A, recorded with exit criterion).
- `e2e/helpers.ts`: remote-admin e2e double opt-in
  (`E2E_ALLOW_REMOTE_ADMIN` + explicit plaintext `E2E_ADMIN_PASSWORD`),
  refuses Argon2-hash-as-password, session minted directly in DB with
  `SESSION_SECRET` length check — sound. The HMAC token format is
  duplicated from `lib/session.ts` by design (breaks loudly on drift).
- `mysql-connection-options.js` + `e2e/helpers.ts` TLS posture:
  `rejectUnauthorized: true` whenever host is non-local unless
  `DB_SSL=false` — consistent with `src/db/index.ts:6-11`.
- `run-e2e-server.mjs`: host pinned to 127.0.0.1/localhost, port
  regex-validated, `shell: false` spawns — no injection surface.
- `entrypoint.sh`: gosu privilege drop after chown; no env echo of
  secrets.

## Cycle-18 fix regression check (security lens) — PASS

- Feed locale 404: rejection happens pre-DB; no enumeration value
  (locale list is public); empty 404 body.
- Stripe deleted-image 200: signature verification still precedes all
  logic; the new logs carry session/image/tier/amount (operator
  reconciliation keys, no card data — Stripe session IDs are not
  secrets at error level in this codebase's established taxonomy).
- Rate-limit registry text: comment-only.

## No new findings in

`api-auth` wrapper usage (spot-checked 3 admin routes against the
gate), `backfill-clip-embeddings` admin-setting gate (reads
`semantic_search_enabled` correctly — contrast DOC-R4C19-05 where
alt-text does not), `seed-e2e` (production refusal at NODE_ENV check),
`ensure-site-config` placeholder-host refusal list.
