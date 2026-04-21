# Cycle 6 Debugger Notes

## Findings

### C6-01 — Early `mysql` exit can surface as an unhandled child-stdin error
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:362-416`
- **Failure mode:** `readStream.pipe(restore.stdin)` keeps writing unless the destination handles errors. If `mysql` exits early, Node can raise `EPIPE` / destroyed-stream errors on `restore.stdin` before the existing `close` handler resolves the action.
- **Suggested fix:** register `restore.stdin.on('error', ...)` before piping, ignore broken-pipe style errors that simply reflect the child exiting, and fail cleanly for everything else.
