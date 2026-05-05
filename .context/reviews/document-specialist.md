# Document Specialist Review — Cycle 22

## Method
Compared code against inline comments, CLAUDE.md references, and cross-file documentation. Focused on comments that no longer match implementation, stale references, and misleading documentation.

## Findings

### MEDIUM

#### C22-DOC-01: `decrementRateLimit` lacks warning about non-atomicity
- **Source**: `apps/web/src/lib/rate-limit.ts:422-426`
- **Confidence**: HIGH

The docstring for `decrementRateLimit` says:
```
Unlike resetRateLimit (which deletes the whole entry), this atomically
reduces the count by 1 so concurrent rollbacks don't lose counts.
```

This is misleading. The function is NOT atomic — the UPDATE and DELETE are separate statements. The comment claims atomicity, which is false.

**Fix**: Update the comment to accurately describe the behavior, or fix the function to be atomic and keep the comment.

---

#### C22-DOC-02: `clip-inference.ts` TODO remains untracked
- **Source**: `apps/web/src/lib/clip-inference.ts:9-13`
- **Confidence**: MEDIUM

The TODO comment references deferred work (ONNX inference, model download) but there is still no ticket reference or GitHub issue after multiple cycles.

**Fix**: Add a cycle reference or ticket ID to the TODO.

---

### LOW

#### C22-DOC-03: `caption-generator.ts` stub note could be more prominent
- **Source**: `apps/web/src/lib/caption-generator.ts:1-18`
- **Confidence**: LOW

The module header clearly documents that this is a stub, but the exported function name (`generateCaption`) and its return value do not indicate stub-ness. A developer using autocomplete would not know the captions are EXIF-derived placeholders.

**Fix**: No code change needed; documentation is clear in the header.

---

## Documentation confirmed accurate
- Rate-limit pattern docstring in `rate-limit.ts`: Accurate (except C22-DOC-01).
- CLAUDE.md "Security Architecture" section: Matches implementation.
- Semantic search route comments: Accurate and appropriately emphatic.
- `queue-shutdown.ts` abstraction: Clean, well-documented.
