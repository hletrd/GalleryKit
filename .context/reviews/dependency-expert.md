# Dependency / Platform Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Platform constraint noted

### P5-01 — The clean fix for restore-size enforcement is platform-boundary work, not just application code
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/next.config.ts:96-101`, `apps/web/src/app/[locale]/admin/db-actions.ts:227-230,289-290`
- **Observation:** Next.js server-action body limits are configured globally here through `NEXT_UPLOAD_BODY_SIZE_LIMIT`. That makes it awkward to keep normal uploads at 2 GiB while restore stays at 250 MB using the same transport.
- **Implication:** a complete fix likely means moving restore to a dedicated route/ingress boundary or adding proxy-level enforcement specific to restore traffic.
