# Cycle 11 Dependency / Runtime / Deploy Notes

Finding count: 3

### R11-01 — Docker healthcheck is coupled to DB availability
- **Severity:** HIGH
- **Confidence:** HIGH
- **Citations:** `apps/web/Dockerfile`, `apps/web/src/app/api/health/route.ts`
- A DB outage or restore can make orchestration restart an otherwise-live web process.

### R11-02 — Production builds still fall back to the example site config
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/Dockerfile`, `README.md`, `apps/web/README.md`
- The docs say `src/site-config.json` is required, but builds still silently fall back to the example file.

### R11-03 — Compose/docs still assume host-managed nginx outside the compose stack
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Citations:** `README.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`
- Operators can mistake the compose quick-start for a full public deployment without understanding the separate host nginx requirement.
