# Cycle 10 Architect Review (manual fallback)

## Inventory
- `README.md`, `apps/web/README.md`, `CLAUDE.md`
- `apps/web/src/app/actions/{topics,tags,images,sharing}.ts`
- `apps/web/src/lib/{data,rate-limit,restore-maintenance,revalidation}.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/playwright.config.ts`

## Confirmed issues

### A10-01 — Topic slug rename flow is architecturally incompatible with the schema’s current foreign-key contract
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/actions/topics.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/0001_sync_current_schema.sql`
- **Concrete failure scenario:** the current rename flow updates child rows before the parent slug exists even though the shipped FKs are `ON UPDATE no action`, so populated topics cannot be renamed safely.
- **Suggested fix:** either insert the replacement topic row before moving children and deleting the old row, or change the schema to an explicit `ON UPDATE CASCADE` contract and update only the parent slug.

### A10-02 — The documented host-nginx deployment story conflicts with the sample static upload root
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `README.md`, `apps/web/README.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`
- **Concrete failure scenario:** operators following the host-nginx docs end up with `/uploads/*` 404s because the sample config points at a container-internal path that a host nginx process cannot see.
- **Suggested fix:** document one consistent topology (sibling nginx container or explicit host path) and keep the sample config aligned with it.

## Likely issues

### A10-03 — Restore maintenance remains process-local instead of a shared architectural contract
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Citations:** `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/data.ts`
- **Concrete failure scenario:** one process enters restore mode while another process still serves writes/reads against the partially restored database.
- **Suggested fix:** move restore maintenance coordination to a shared store or shared DB-visible lock state rather than `globalThis` alone.
