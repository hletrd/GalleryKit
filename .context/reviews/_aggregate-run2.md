# Aggregate Review -- Cycle 1 (Run 2)

**Date**: 2026-05-05
**Reviewers**: photographer-workflow, code-reviewer, security-reviewer, perf-reviewer
**Focus**: Professional photographer workflow, code quality, security, performance

---

## AGGREGATE FINDINGS (Deduplicated, Highest Severity Preserved)

### MEDIUM

| # | Finding | Severity | Confidence | Sources | File(s) |
|---|---------|----------|------------|---------|---------|
| 1 | EXIF metadata missing Artist and Copyright fields | Medium | High | PWF-R2-01 | process-image.ts, schema.ts |
| 2 | Downloaded JPEG lacks EXIF metadata (stripped during processing) | Medium | High | PWF-R2-03 | process-image.ts:651-717 |
| 3 | Admin search missing lens_model from searchable fields | Medium | High | PWF-R2-05 | data.ts:1130-1260 |
| 4 | `revalidateAllAppData()` overuse in tag actions | Low-Med | High | PR-R2-01, CR-R2-02 | tags.ts |

### LOW-MEDIUM

| # | Finding | Severity | Confidence | Sources | File(s) |
|---|---------|----------|------------|---------|---------|
| 5 | JPEG download serves middle-size derivative, not guaranteed largest | Low-Med | High | PWF-R2-04 | photo-viewer.tsx:222-224 |
| 6 | No per-image upload ETA/throughput indicator | Low-Med | High | PWF-R2-07 | upload-dropzone.tsx |
| 7 | f_number stored as float may lose precision for half-stops | Low | High | PWF-R2-02 | schema.ts:40 |
| 8 | "Uncalibrated" color space displayed without context | Low | Medium | PWF-R2-06 | process-image.ts:886-897 |

### LOW

| # | Finding | Severity | Confidence | Sources | File(s) |
|---|---------|----------|------------|---------|---------|
| 9 | Lightbox swipe velocity threshold may be too sensitive on mobile | Low | Medium | PWF-R2-08 | lightbox.tsx:219 |
| 10 | No topic-level sort order control | Low | Medium | PWF-R2-09 | data.ts, schema.ts |
| 11 | `bulkUpdateImages` alt text per-row UPDATE in loop | Low | Medium | CR-R2-05 | images.ts:906-917 |

### PREVIOUSLY IDENTIFIED (Still Valid, Not Re-listed)

These findings from the prior cycle fresh aggregate remain valid and unaddressed:
- No original-format download for admin
- Sequential file upload bottleneck
- No EXIF-based search/filter (range queries)
- Upload processing has no progress visibility
- No manual photo ordering within topics
- No bulk download/export

### SECURITY

No new security findings. The codebase maintains strong security posture.

---

## CROSS-AGENT AGREEMENT

- **EXIF metadata gaps**: Photographer workflow and code reviewer both identified missing Artist/Copyright fields and metadata stripping during processing.
- **Revalidation overuse**: Both code reviewer and perf reviewer flagged `revalidateAllAppData()` in tag actions.
- **Search gaps**: Photographer workflow identified lens_model as a missing search field.

---

## AGENT FAILURES

No agent failures. All reviewers completed successfully.