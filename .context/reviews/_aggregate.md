# Aggregate Review — Cycle 2 / 100

Date: 2026-04-29 (Asia/Seoul)
Repo: `/Users/hletrd/flash-shared/gallery`

## Review roster and provenance

Prompt 1 attempted to fan out across the required reviewer roster plus registered reviewer-style local agents. The native Agent tool accepted two reviewer lanes before hitting the environment thread ceiling; shell-based Codex retry lanes were then launched once for the remaining roles but exited without producing updated review artifacts. Successful current-cycle artifacts are:

- `code-reviewer` → `.context/reviews/code-reviewer.md` (6 findings)
- `security-reviewer` → `.context/reviews/security-reviewer.md` (6 findings)
- `perf-reviewer` → `.context/reviews/perf-reviewer.md` (8 findings)

Current-cycle raw findings produced: **20**. After deduping overlapping body-limit, dotenv-shell, storage-normalization, and already-known performance-debt issues, this aggregate tracks **17 actionable finding groups**.

## Cross-agent high-signal agreement

- **Large body handling:** `code-reviewer` and `security-reviewer` both found that the new global Server Action transport cap is simultaneously still too large for pre-auth/invalid action requests and too small for the documented 250 MB DB restore path.
- **Dotenv shell sourcing:** both successful agents independently found `playwright.config.ts` treats dotenv files as shell scripts, creating correctness and local/CI command-injection risk.
- **Storage abstraction:** both successful agents found `LocalStorageBackend.getUrl()` does not share the strict key validation used by filesystem reads/writes.
- **Unfinished cycle-1 safety work:** the security review confirmed that upload/restore concurrency and PostCSS audit drift are still live in the current worktree.
- **Performance debt:** `perf-reviewer` re-confirmed several Cycle 1 deferred performance issues (counts/search/shared-group/upload-preview/CPU/CSV) and added one new cursor-input validation problem on the keyset path.

## Merged actionable finding groups

| Aggregate ID | Source IDs | Highest severity / confidence | Disposition for Prompt 2 |
| --- | --- | --- | --- |
| C2-AGG-01 | CR2-CQ-01 | High / High | Schedule: memoize/primitive-key the initial load-more cursor so successful page appends do not reset pagination back to page 1. |
| C2-AGG-02 | CR2-CQ-02 | High / High | Schedule: repair the `GalleryImage`/cursor type contract so typecheck catches required cursor fields instead of failing or encouraging casts. |
| C2-AGG-03 | CR2-CQ-03, SEC2-01 | High / Medium-High | Schedule: split or align large body limits; resolve 216 MiB Server Action cap vs 250 MiB restore promise and avoid process-wide near-upload pre-auth parsing. |
| C2-AGG-04 | CR2-CQ-04, SEC2-03 | Medium / High | Schedule: stop shell-sourcing dotenv files in Playwright webServer commands; load env as data and spawn commands safely. |
| C2-AGG-05 | CR2-CQ-05 | Medium / High | Schedule: add syntax/type coverage for critical JS/MJS scripts, especially `prepare-next-typegen.mjs` on the typecheck path. |
| C2-AGG-06 | CR2-CQ-06, SEC2-05 | Low / High | Schedule: centralize storage key normalization so `getUrl()` rejects the same traversal/malformed keys as read/write paths. |
| C2-AGG-07 | SEC2-02 | High / High | Schedule: finish the restore/upload single-writer critical-section fix from Plan 250; restore must coordinate with upload insertion/enqueue boundaries. |
| C2-AGG-08 | SEC2-04 | Medium / High | Defer/record owner action: move ignored live `.env.deploy` out of the repo checkout and rotate if ever exposed; code agents must not print secrets. |
| C2-AGG-09 | SEC2-06 | Medium / High | Schedule: fix PostCSS lockfile/install drift or record a time-bound advisory deferral if upstream prevents full remediation. |
| C2-AGG-10 | PERF2-01 | Medium / High | Schedule: bound and canonicalize cursor date strings at the public action/data boundary. |
| C2-AGG-11 | PERF2-02 | Medium / High | Deferred: public first-page exact counts and duplicate grouped metadata query remain performance debt. |
| C2-AGG-12 | PERF2-03 | Medium / High | Deferred: public search needs indexed/tokenized strategy beyond LIKE scans. |
| C2-AGG-13 | PERF2-04 | Medium / High | Deferred: shared selected-photo pages need smaller data shapes. |
| C2-AGG-14 | PERF2-05 | High / High | Deferred: upload preview virtualization/thumbnailing is a broader frontend performance project. |
| C2-AGG-15 | PERF2-06 | Medium / High | Deferred: image processing CPU isolation/concurrency tuning needs benchmark/deploy design. |
| C2-AGG-16 | PERF2-07 | Medium-Low / Medium | Deferred: optional PhotoViewer chunk splitting needs bundle-analysis-guided frontend work. |
| C2-AGG-17 | PERF2-08 | Medium / High | Deferred: CSV export should become an authenticated streaming route for large galleries. |

## AGENT FAILURES

The following reviewer lanes were attempted in the initial fan-out/retry path but did not produce current-cycle artifacts because the environment hit the native Agent thread limit and the fallback `codex exec` retry processes exited after session startup without writing their requested files. Existing historical files with the same names were not treated as current-cycle reports:

- `critic`
- `verifier`
- `test-engineer`
- `debugger`
- `tracer`
- `debugger-tracer`
- `architect`
- `document-specialist`
- `designer`
- `product-marketer-reviewer`
- `ui-ux-designer-reviewer`

## Prompt 2 handoff

Prompt 2 must schedule or explicitly defer every merged group above. Security/correctness/data-loss items are not deferrable unless a repo rule explicitly permits it. Cycle 1's uncommitted implementation plans and code remain part of the input state; Prompt 2/3 should reconcile them rather than discard them.
