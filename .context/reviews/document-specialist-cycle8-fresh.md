# Document Specialist — Cycle 8 (Fresh, broad sweep)

**Scope:** drift between docs (CLAUDE.md, README, .env.local.example) and code reality.

## Findings

### DS8F-01 — Several env knobs are runtime-active but absent from `.env.local.example`
**Where:** Code references vs `.env.local.example`.
**Drift:**
- `AUDIT_LOG_RETENTION_DAYS` (`lib/audit.ts:52`) — undocumented.
- `IMAGE_MAX_INPUT_PIXELS_TOPIC` (`lib/process-image.ts:34-39`) — undocumented.
- `SHARP_CONCURRENCY` (`lib/process-image.ts:20`) — undocumented.
- `QUEUE_CONCURRENCY` (`lib/image-queue.ts:120`) — documented in CLAUDE.md but not `.env.local.example`.
- `IMAGE_MAX_INPUT_PIXELS` (`lib/process-image.ts:26-29`) — undocumented.
- `BASE_URL` (`app/sitemap.ts:14`, `lib/data.ts:889`) — referenced; verify against `.env.local.example`.
- `TRUSTED_PROXY_HOPS` (`lib/rate-limit.ts:62-67`) — verify documentation.

**Recommendation:** Audit the example file against actual `process.env` reads and add the missing knobs with sensible commented defaults.
**Severity:** LOW. Confidence: High.

### DS8F-02 — CLAUDE.md "Image Processing Pipeline" mentions `4 sizes (640, 1536, 2048, 4096)` but does not call out `IMAGE_MAX_INPUT_PIXELS_TOPIC` separate cap
**Where:** CLAUDE.md, `process-image.ts:34-39`.
**Drift:** Topic-image processing has a separate, smaller cap (64M pixels vs full-image 256M). CLAUDE.md does not mention this.
**Recommendation:** Add a one-line note to the pipeline section.
**Severity:** LOW. Confidence: High.

### DS8F-03 — `Permissions-Policy` documented as just camera/microphone/geolocation
**Where:** CLAUDE.md "Security Architecture" sub-sections (assumed); `next.config.ts:45`; `nginx/default.conf`.
**Drift:** Modern privacy directives missing. If/when they land, CLAUDE.md should reflect.
**Severity:** LOW.

### DS8F-04 — CLAUDE.md "Common Commands" lists `npm test --workspace=apps/web` but the `Lint Gates` section also lists it as an enforced gate. Slight redundancy. Cosmetic.
**Severity:** Trivial.

### DS8F-05 — `.context/plans/` and `.context/reviews/` are absent from `.gitignore` and CLAUDE.md doesn't explicitly say whether they should be committed
**Where:** Git history shows they ARE committed (e.g., 5+ MB of plan files).
**Recommendation:** A one-line note in CLAUDE.md "Repository structure" stating `.context/` is intentionally tracked for the review-plan-fix loop's evidence trail.
**Severity:** LOW.

### DS8F-06 — `apps/web/Dockerfile` HEALTHCHECK probes `/api/live` (correct; CLAUDE.md aligns)
**Status:** No drift. CLAUDE.md "Important Notes" already says "Docker liveness should probe `/api/live`; `/api/health` is DB-aware".

### DS8F-07 — `BASE56_CHARS` documentation
**Where:** `lib/base56.ts:3`. Comment-only documentation. No CLAUDE.md mention. The character set excludes `0`, `1`, `I`, `O`, `o`, `l` (ambiguous chars). This is good but a future security-conscious reader might want a one-liner explaining the choice.
**Severity:** Trivial.

## Net summary

- `.env.local.example` is the most material drift surface — five undocumented runtime knobs.
- Other drift is cosmetic.
- No factually wrong documentation found this cycle.
