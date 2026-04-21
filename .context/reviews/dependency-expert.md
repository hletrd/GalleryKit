# Cycle 7 Dependency / Build Review (manual fallback)

## Inventory
- Reviewed workspace manifests, build/deploy scripts, Dockerfile, nginx config, and dependency posture surfaced by the current lockfile.

## Confirmed Issues

### DEP7-01 — `drizzle-kit` currently resolves to an esbuild advisory in the dev-tooling tree
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/package.json:56-70`, `package-lock.json` (`drizzle-kit` -> `@esbuild-kit/*` -> `esbuild`)
- **Why it is a problem:** the production runtime is unaffected, but local/tooling workflows still carry the known `esbuild` advisory chain reported by `npm audit`.
- **Concrete failure scenario:** a developer runs the vulnerable dev-tooling stack on an untrusted network and inherits the upstream advisory behavior.
- **Suggested fix:** update `drizzle-kit` (or the transitive esbuild-resolving chain) to a patched version and re-run the audit.
