# Document Specialist — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Doc-Code Alignment Verification

Verified CLAUDE.md documentation against actual code implementation.

### Aligned (No Discrepancies)

| Documented Claim | Code Reference | Status |
|---|---|---|
| Next.js 16 App Router | `package.json` | Aligned |
| MySQL 8.0+ with Drizzle ORM | `db/index.ts`, `db/schema.ts` | Aligned |
| Argon2 password hashing | `auth.ts:144`, `admin-users.ts:144` | Aligned |
| Sharp image processing | `lib/process-image.ts` | Aligned |
| Tailwind CSS + shadcn/ui | Component imports | Aligned |
| next-intl i18n (en, ko) | `messages/en.json`, `messages/ko.json` | Aligned |
| Docker standalone output | `Dockerfile` | Aligned |
| Max upload 200MB per file | `process-image.ts:46` | Aligned |
| Batch byte cap UPLOAD_MAX_TOTAL_BYTES | `upload-limits.ts` | Aligned |
| Batch file count UPLOAD_MAX_FILES_PER_WINDOW | `upload-limits.ts` | Aligned |
| 24-hour session expiry | `auth.ts:186,218` | Aligned |
| Rate limiting per-IP + per-account | `auth.ts:113-147` | Aligned |
| Advisory locks scope note | Multiple files | Aligned |
| View count best-effort | `data.ts:12-105` | Aligned |
| Single-writer topology | CLAUDE.md note | Aligned |
| blur_data_url 4KB cap | `blur-data-url.ts:45` | Aligned |
| Producer-side assertBlurDataUrl | `process-image.ts:305` | Aligned |

### Findings (New — Doc/Code Mismatches)

| ID | Finding | Severity | Confidence |
|---|---|---|---|
| C3-DS01 | CLAUDE.md states "TypeScript 6" in the tech stack but does not specify the exact minor version. The `tsconfig.json` uses `"target": "ESNext"` and `"module": "ESNext"` which is consistent with the CLAUDE.md instruction to use ESNext. No mismatch. | Info | High |
| C3-DS02 | CLAUDE.md states "React 19" but does not document the specific minor version or whether server components or client components are the default pattern. The codebase uses a mix of server and client components (marked with `'use client'`). This is implicit in Next.js App Router and not a real documentation gap. | Info | Info |

## Verified Controls

All CLAUDE.md documented patterns are accurately reflected in the code. No documentation-code mismatches found this cycle.
