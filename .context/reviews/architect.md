# Architect Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Architectural risk

### A5-01 — Restore maintenance authority is process-local only
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Citations:** `apps/web/src/lib/restore-maintenance.ts:1-37`, `apps/web/src/app/[locale]/admin/db-actions.ts:235-279`, `apps/web/docker-compose.yml` / deployment docs indicating today's single-instance topology
- **Why it matters:** the maintenance flag lives in a `globalThis` symbol inside one Node process. That is workable for the current single-instance deployment, but it does not coordinate across multiple app instances or worker processes.
- **Failure scenario:** if deployment evolves to multiple web instances, one instance could enter restore mode while another continues accepting writes because it never sees the local symbol flip.
- **Suggested fix:** keep the current process-local guard for now, but document it as a single-instance assumption and re-open the design if/when the app becomes multi-instance.
