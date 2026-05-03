# Critic — Cycle 1 (RPF, end-only deploy mode)

## Multi-Perspective Critique

### Photographer (visitor) lens
- The photo viewer (`p/[id]`) renders JSON-LD via `safeJsonLd`. SEO is
  preserved while preventing `</script>` breakouts. Good.
- The shared link path (`s/[key]`) is rate-limited per IP; URL enumeration
  is throttled.
- The map and timeline pages use cached data and lazy bundles
  (`leaflet`, `framer-motion` loaded on demand).

### Maintainer lens
- The `actions.ts` barrel re-exports from per-domain action files. New
  contributors can add an action by extending the appropriate sub-file
  rather than the giant root.
- Plan/review file accumulation in `.context/` is a known artifact of the
  RPF cadence; not a defect.

### Adversary lens
- A scripted attacker hitting `/api/checkout/<id>` is throttled to 10
  attempts/IP/min — well below Stripe API rate limits.
- A spoofed `x-forwarded-for` is ignored unless `TRUST_PROXY=true` is set
  by the operator.
- Admin tokens are hashed on storage; only prefixes are logged.
- An attacker that obtains the DB cannot forge sessions in production
  because `SESSION_SECRET` is required from env, not DB.

### Observability lens
- Audit events flow through `logAuditEvent` from `lib/audit.ts`.
- PII (full IP, customer email) is intentionally not logged at error level
  — the webhook now logs presence flags only.

## Tradeoff Concerns
- **No CRITICAL or HIGH findings remain.** Two low-severity defense-in-depth
  items (S-CYCLE1-01 and S-CYCLE1-02) are recorded as Low; both are
  hardening opportunities, not defects.

## Conclusion
The codebase is in a converged state for the third consecutive cycle on
the security/correctness axis. Marginal hardening is still available but
no defect requires action.
