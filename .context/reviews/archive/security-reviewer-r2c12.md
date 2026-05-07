# Security Reviewer — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Auth surfaces, rate-limit infrastructure, public API routes, upload pipeline, lint gates
**Method**: Manual audit of security-critical files with cross-file tracing

## Finding C12-SEC-01: Public-route-rate-limit lint gate can be bypassed by commented-out helper calls

- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 136-139
- **Cross-reference**: code-reviewer C12-LOW-01
- **Security impact**: A public API route with a mutating handler could ship without active rate limiting if the developer leaves a commented-out rate-limit helper call in the file. The lint gate would pass, CI would be green, and the unmetered mutation surface would be live. This is exactly the class of issue the gate was designed to prevent (see docstring at line 1-18).
- **Exploit scenario**: Developer adds `POST /api/new-feature/route.ts`, copies a commented-out rate-limit call from another file as a template, forgets to uncomment it. The gate passes. An attacker discovers the endpoint and brute-forces it without rate-limit constraints.
- **Fix**: Strip `//` and `/* */` comments from `withoutStrings` before the regex prefix check.
- **Severity**: Low | **Confidence**: High

## Finding C12-SEC-02: Semantic search Content-Length guard bypass via malformed header

- **File**: `apps/web/src/app/api/search/semantic/route.ts`, line 76
- **Cross-reference**: code-reviewer C12-LOW-02
- **Security impact**: The body-size guard is the first line of defense against oversized JSON payloads. Bypassing it allows an attacker to force the server to parse a multi-megabyte JSON body before the rate-limit check fires, wasting CPU and memory. While the rate limit is checked afterward, the attacker can still cause resource exhaustion on a small number of requests.
- **Exploit scenario**: Send `Content-Length: NaN` (or any non-numeric string) with a 10 MB body. The guard skips. `request.json()` attempts to parse the body. The request is eventually rate-limited, but only after the expensive parse.
- **Fix**: Use `Number(contentLength)` + `Number.isFinite()` validation.
- **Severity**: Low | **Confidence**: High

## No New Security Findings in Other Areas

- Auth flow (login, password change, session verification): all patterns are correct. No TOCTOU gaps.
- Upload pipeline: path traversal prevention, symlink rejection, and filename sanitization are intact.
- DB backup download route: containment checks, realpath validation, and symlink rejection are correct.
- Public share-key routes: base56 validation and expiry checks are correct.
- All configured lint gates (api-auth, action-origin, public-route-rate-limit) pass.
