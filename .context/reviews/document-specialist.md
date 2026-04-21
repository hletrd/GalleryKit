# Cycle 7 Document Specialist Review (manual fallback)

## Inventory
- Reviewed `README.md`, `CLAUDE.md`, `.env.deploy.example`, deploy scripts, Docker/nginx config, and public/admin runtime assumptions reflected in the code.

## Confirmed Issues

### DOC7-01 — Deployment docs/examples do not currently call out that nginx body limits must track the app's 2 GiB upload cap and 250 MB restore cap
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `README.md:97-105,146-157`, `CLAUDE.md:54-65,220-238`, `apps/web/nginx/default.conf:13-18,47-60`
- **Why it is a problem:** deployers can safely update app-side upload limits while forgetting to align the reverse proxy caps, which recreates the oversized-body gap at the edge.
- **Concrete failure scenario:** an operator edits the app limits or reverse proxy independently and ends up with nginx accepting bodies much larger than the application is prepared to validate.
- **Suggested fix:** document the proxy/app body-size contract alongside the existing deployment instructions.
