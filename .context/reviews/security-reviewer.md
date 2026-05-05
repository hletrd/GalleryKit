# Security Review — Cycle 21

## Review Scope
OWASP Top 10, auth/authz, secrets, unsafe patterns, injection risks, and data leakage paths. Focused on recently modified security-critical code.

## Findings

### C21-SEC-01: Semantic Search Body Size Guard Bypass via Chunked Encoding
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 74-90)
**Severity**: Medium
**Confidence**: High
**OWASP**: A05:2021 - Security Misconfiguration

The `Content-Length`-based body size guard is bypassed when `Transfer-Encoding: chunked` is used. An attacker can send an arbitrarily large chunked request body that gets buffered before JSON parsing fails.

**Impact**: Memory exhaustion / DoS on the semantic search endpoint.
**Fix**: Add chunked encoding rejection OR read body as text with explicit length cap before JSON.parse.

---

### C21-SEC-02: `decrementRateLimit` Race Condition Allows Count Manipulation
**File**: `apps/web/src/lib/rate-limit.ts` (lines 427-454)
**Severity**: Low
**Confidence**: Medium
**OWASP**: A01:2021 - Broken Access Control

The non-atomic UPDATE+DELETE sequence in `decrementRateLimit` creates a window where concurrent `incrementRateLimit` calls can have their counts silently deleted. In high-concurrency scenarios, this could allow more requests through than the configured limit.

**Impact**: Rate limit bypass under high concurrency.
**Fix**: Wrap in a transaction or use a single atomic operation.

---

### C21-SEC-03: `backfillClipEmbeddings` Lacks Rate Limiting
**File**: `apps/web/src/app/actions/embeddings.ts`
**Severity**: Low
**Confidence**: High
**OWASP**: A05:2021 - Security Misconfiguration

Admin-only action with no rate limiting. Processing 5000 images involves significant CPU (SHA-256 hashing) and DB writes. Repeated invocation could degrade service.

**Impact**: DoS via admin action repetition.
**Fix**: Add per-admin or global rate limiting.

---

### C21-SEC-04: Semantic Search Stub Returns Random Results That Appear Legitimate
**File**: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/lib/clip-inference.ts`
**Severity**: Low
**Confidence**: High
**OWASP**: A07:2021 - Identification and Authentication Failures (trust boundary)

The semantic search endpoint returns structured, enriched results with cosine similarity scores that appear mathematically valid but are semantically meaningless. An admin enabling this feature may not realize it produces random results, leading to confused users and potential data leakage (random photos shown for sensitive queries).

**Impact**: Loss of user trust; potential inappropriate content exposure.
**Fix**: Add explicit stub-mode warning or require real ONNX model before enabling.

---

### C21-SEC-05: OG Photo Route Internal Fetch Without Size Cap on Chunked Responses
**File**: `apps/web/src/app/api/og/photo/[id]/route.tsx` (lines 86-100)
**Severity**: Low
**Confidence**: Medium
**OWASP**: A05:2021 - Security Misconfiguration

The internal fetch for JPEG derivatives relies on `Content-Length` for size guarding. With chunked responses, the `arrayBuffer()` call buffers the full response unchecked. While the origin is same-origin (internal `/uploads/jpeg`), a misconfiguration or symlink attack could cause an unexpectedly large response.

**Impact**: Memory pressure from large response buffering.
**Fix**: Add post-fetch buffer size validation.

---

## No-Security-Finding Confirmation
The following areas were reviewed and found adequately protected:
- Auth flows (Argon2, session rotation, same-origin guards)
- Upload path traversal prevention (SAFE_SEGMENT, symlink rejection)
- SQL injection (Drizzle parameterization throughout)
- XSS (output encoding, CSP headers)
- PII leakage (publicSelectFields compile-time guards)
- Stripe webhook signature verification
- Admin token hashing
