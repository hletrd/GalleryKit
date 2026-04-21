# Dependency / Runtime / Build / Deploy / Performance Review

Scope: `apps/web` runtime, build, deploy, and dependency-adjacent operational paths.

## Inventory reviewed

Primary docs/config:
- `README.md`
- `apps/web/README.md`
- `CLAUDE.md`
- `package.json`
- `apps/web/package.json`
- `.env.deploy.example`

Deployment/runtime files:
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/next.config.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/storage/*`

Sanity checks run:
- `npm run build --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅

## Findings summary

- **2 confirmed issues**
- **2 likely issues**
- **1 manual-validation risk**
- **5 total findings**

---

## Confirmed issues

### DEP-01 — Production image ships build-only toolchain into the runtime layer
**Confidence:** High

**File / region:** `apps/web/Dockerfile:1-10,41-61`

**What I found:**
The `base` stage installs `python3`, `make`, and `g++`, and the final `runner` stage is still `FROM base AS runner`. That means the production image inherits the build toolchain even though only the build stages need it. The runtime layer also copies the full production `node_modules` tree on top of the standalone app.

**Concrete failure scenario:**
Every deployed container carries unnecessary build packages in production. That increases image size, slows pulls and cold starts, and broadens the CVE surface for the live image. On a frequently redeployed host, this becomes an operational drag even though the app itself does not need those packages at runtime.

**Suggested fix:**
Split the Docker base into a build-only stage and a slimmer runtime stage. Keep only true runtime dependencies in the final image (`gosu`, `mariadb-client`, and the app/runtime artifacts), and drop `python3`, `make`, and `g++` from the runner layer.

---

### DEP-02 — CSV export still materializes the full result set and full CSV string in memory
**Confidence:** High

**File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-99`

**What I found:**
`exportImagesCsv()` limits the query to 50,000 rows, but it still loads the entire result set into `results`, then builds `csvLines`, then joins everything into one large `csvContent` string before returning. The inline comments acknowledge the memory concern, but the implementation is still all-in-memory.

**Concrete failure scenario:**
On a large gallery, an admin click on “Export CSV” can allocate a large transient heap spike. That can slow the server, trigger GC churn, or OOM a memory-constrained container. The 50k cap lowers the blast radius, but it does not make the export safe for modest-memory deployments.

**Suggested fix:**
Stream CSV output instead of materializing it all at once, or write the export to a file/response stream and only keep a small row buffer in memory. If streaming is not practical, reduce the cap and surface a hard upper bound in the UI.

---

## Likely issues

### DEP-03 — CPU sizing ignores container quotas, so Sharp and libuv can oversubscribe the host
**Confidence:** Medium

**File / region:**
- `apps/web/src/lib/process-image.ts:15-22`
- `apps/web/scripts/entrypoint.sh:24-31`

**What I found:**
`process-image.ts` derives `sharpConcurrency` from `os.cpus().length - 1`, and `entrypoint.sh` sets `UV_THREADPOOL_SIZE` to `nproc` when unset. Both heuristics use the machine’s reported CPU count rather than the container’s actual CPU quota.

**Concrete failure scenario:**
A container limited to 2 vCPUs but scheduled on a 16- or 32-core host can end up with a Sharp worker pool and libuv thread pool sized for the host, not the cgroup limit. During image uploads or backup work, the process can oversubscribe CPU, increase latency for requests, and in the worst case create memory pressure from too much concurrent native work.

**Suggested fix:**
Use cgroup-aware CPU detection or cap both values conservatively by default. Prefer explicit, documented env overrides for `SHARP_CONCURRENCY` and `UV_THREADPOOL_SIZE`, and make the default conservative enough for small containers.

---

### DEP-04 — Remote deploy script uses a blind `git pull`, which is fragile on real servers
**Confidence:** Medium

**File / region:** `apps/web/deploy.sh:6-30`

**What I found:**
The remote deploy script changes to the repo root and immediately runs `git pull` before building the container stack. There is no cleanliness check, no pinned revision, and no guardrail around local changes on the target host.

**Concrete failure scenario:**
If the server has any local hotfix, uncommitted change, or branch divergence, `git pull` can fail or merge unexpectedly. That turns a deployment into an interactive git problem and can leave the host in a partially updated state.

**Suggested fix:**
Require a clean checkout and a known branch, or replace `git pull` with an explicit `git fetch` plus `git reset --hard origin/<branch>`. If you need to preserve local edits, make that an explicit opt-in path rather than the default.

---

## Manual-validation risk

### DEP-05 — The Docker image is not self-contained; it depends on the compose bind mount for `public/`
**Confidence:** Medium

**File / region:**
- `apps/web/Dockerfile:51-64`
- `apps/web/docker-compose.yml:19-22`

**What I found:**
The final image copies the standalone server, static chunks, scripts, and database helpers, but not `apps/web/public`. The compose file compensates by bind-mounting `./public:/app/apps/web/public` at runtime.

**Why this matters:**
That is fine for the documented compose deployment, but it means the built image is not a portable, standalone artifact. If someone reuses the image without the exact volume mount, static assets such as fonts and `histogram-worker.js` will be missing.

**Suggested fix:**
Either bake `apps/web/public` into the image and mount only the writable upload subtree, or document very explicitly that the image must always be run with the companion bind mount. For portability, the first option is safer.

**Manual validation needed:**
Verify any alternative deployment path you intend to support (plain `docker run`, Kubernetes, or another Compose file) still supplies the `public` volume or bakes those assets into the image.

---

## Bottom line

The repo builds and lints cleanly, but there are still deployment/runtime concerns around image size, container CPU sizing, deploy reproducibility, and memory-heavy export behavior. The most actionable fixes are trimming the runtime image, capping native concurrency more conservatively, and streaming the CSV export.
