# Designer/Critic Review - Cycle 36

## Findings

### C36-DES-01 - Pagination errors are not announced by the component status region

- Severity: Medium
- Confidence: High
- Evidence: `apps/web/src/components/load-more.tsx:49` sets the live status to `home.loadingMore` before the request. Success and end-of-list paths update it at `apps/web/src/components/load-more.tsx:61` and `apps/web/src/components/load-more.tsx:72`, but the `rateLimited`, `maintenance`, `error`, `invalid`, and catch paths only show `toast.error(...)` at `apps/web/src/components/load-more.tsx:81-99`. The component's only persistent assistive status output is the `sr-only` live region at `apps/web/src/components/load-more.tsx:165-167`.
- Failure scenario: A keyboard or screen-reader visitor reaches the bottom of a gallery during maintenance or rate limiting. The load action fails, the button re-enables, but the component-owned live region still contains "Loading more images..." instead of the localized failure text from `apps/web/messages/en.json:263` / `apps/web/messages/en.json:272-273` and `apps/web/messages/ko.json:263` / `apps/web/messages/ko.json:272-273`. If the toast is missed or not exposed reliably by the toast library, the user has no local confirmation that loading failed or when to retry.
- Fix: Set `statusMessage` on every failure branch before/alongside the toast, using the existing localized strings. Prefer also rendering a small inline retry/error status near the load-more button with `role="status"` or `role="alert"` depending on urgency, then clearing/replacing it on the next retry or success.
- Test gap: `apps/web/src/__tests__/load-more-source-contracts.test.ts:18-23` verifies transient backoff and failure classification, but not that failure states update the live region.

### C36-DES-02 - Public semantic-search setup errors expose operator jargon to visitors

- Severity: Medium
- Confidence: High
- Evidence: A 503 from `/api/search/semantic` with `semantic_not_configured` or `semantic_no_embeddings` is mapped directly to `semanticSetupRequired` at `apps/web/src/components/search.tsx:199-212`. The public-facing copy says visitors should ask an admin to "seed model weights, enable production mode, and backfill embeddings" in English at `apps/web/messages/en.json:426`; the Korean copy at `apps/web/messages/ko.json:426` exposes the same terms as "모델 가중치 시드, 프로덕션 모드 활성화, 임베딩 백필".
- Failure scenario: A gallery owner enables the semantic search control before CLIP setup/backfill is complete. Public visitors, including Korean visitors, see internal deployment language instead of a visitor-safe recovery path. That makes the gallery feel broken and leaks implementation details that belong in the admin/operator runbook, not the public search dialog.
- Fix: Replace the public `semanticSetupRequired` copy with visitor-oriented text such as "Semantic search is still being prepared. Try keyword search for now." Keep the detailed model-weight/backfill instructions in the admin settings page or an operator-only diagnostic. Consider automatically falling back to keyword mode after this response so the visible next action is clear.
- Test gap: `apps/web/e2e/public.spec.ts:21-59` covers search focus trapping and successful matches, but not semantic-search 503 copy or the Korean public failure state.

### C36-DES-03 - Upload rejection toasts can bypass localization

- Severity: Low
- Confidence: High
- Evidence: `apps/web/src/components/upload-dropzone.tsx:205-214` takes `fileRejections[0]?.errors[0]?.message` from `react-dropzone` and interpolates it directly into `toast.error(...)`. The dropzone is configured at `apps/web/src/components/upload-dropzone.tsx:217-222`, while the localized upload/API error catalog lives in `apps/web/messages/en.json:550-560` and `apps/web/messages/ko.json:550-560`.
- Failure scenario: A Korean admin drags a non-image or otherwise rejected file into the upload area. The file name is shown with the raw library rejection string, which can be English and may not match the app's upload terminology. This is especially noticeable because nearby upload empty, skipped, and progress states are localized (`apps/web/src/components/upload-dropzone.tsx:456-467`, `apps/web/src/components/upload-dropzone.tsx:469-475`).
- Fix: Map `FileError.code` values such as `file-invalid-type`, `file-too-large`, and `too-many-files` to app-owned `upload.*` translations, with a localized generic fallback. Add a component/source test that simulates or asserts the mapping so future dropzone changes cannot reintroduce raw library messages.
- Test gap: Existing upload-dropzone tests focus on queue wiring, topic behavior, and touch-target/focus contracts; I did not find coverage asserting localized `onDropRejected` messaging.

## Validation

- Reviewed source for public search, pagination, upload, photo navigation, map, lightbox/viewer, modal isolation, touch-target primitives, and related i18n messages.
- Reviewed relevant tests for public search E2E, load-more source contracts, upload-dropzone contracts, focus-visible scans, and touch-target audit coverage.
- Did not run browser automation; the findings above are source/test-grounded and do not depend on screenshot-only evidence.
