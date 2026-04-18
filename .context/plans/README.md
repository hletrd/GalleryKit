# Implementation Plans Index

## Active Plans (R8 — 2026-04-18)

No tracked `.context/plans` items are currently open. Plans 27-29 were completed during the current Ralph run and verified with lint, tests, TypeScript, build, and architect sign-off.

## Completed Plans

- Plans 00-26 remain complete as previously recorded.
- 27 — Routing, Metadata, and View-State Consistency — DONE (2026-04-18)
- 28 — Upload, Restore, and Sharing Safety — DONE (2026-04-18)
- 29 — Admin Refresh, Proxy Semantics, and Docs/Deploy Alignment — DONE (2026-04-18)

---

## Reviews Cross-Referenced

| Review | Date | Total Findings | Planned | Deferred/Manual |
|--------|------|---------------|---------|-----------------|
| **Comprehensive Code Review (full audit)** | 2026-04-18 | 15 confirmed + 3 likely/risk | 15 confirmed + 2 low-risk likely fixes complete | 1 manual-validation risk (`/api/og` throttle architecture) |
| UI/UX Deep Review R7 | 2026-04-18 | 11 (6H/3M/2L) | Complete via Plan 26 | 0 |
| Comprehensive Review R6 | 2026-04-18 | 40 (2C/9H/18M/11L) | Complete | 0 |

---

## R8 Findings → Plan Mapping

### Plan 27
- Audit #1 locale URL generation inconsistency
- Audit #8 shared-group URL drift
- Audit #9 nested main / skip-link mismatch
- Audit #10 search stale-result race
- Audit #11 manifest icon mismatch
- Audit #12 tag-filter double refresh
- Audit #13 topic page heading mismatch

### Plan 28
- Audit #2 filename-based implicit replacement
- Audit #3 replacement deletes old original too early
- Audit #4 unprocessed images can be shared
- Audit #5 restore scanner false positives on quoted SQL data
- Risk C buffered shared-group view counts lost on shutdown

### Plan 29
- Audit #6 categories page stale after mutations
- Audit #7 admin users page stale after mutations
- Audit #14 Docker/deploy docs mismatch
- Audit #15 CLAUDE testing mismatch
- Likely issue A trusted proxy / X-Forwarded-For semantics

---

## Notes
- The `/api/og` architectural rate-limiting risk remains a separate manual-validation item unless a clean app-level design emerges during execution.
