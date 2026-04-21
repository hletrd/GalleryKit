# Cycle 6 Architect Notes

## Findings

### C6-02 — The root layout does not currently hand off live branding to the client-only fatal shell
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/layout.tsx:15-48,75-109`, `apps/web/src/app/global-error.tsx:45-52`
- **Risk:** the current architecture has a server-only SEO source and a client-only fatal shell with no shared bridge, so failure-mode UI drifts from the configured application identity.
- **Suggested fix:** embed live brand values in the root HTML attributes so the fatal shell can reuse them without adding a new runtime fetch.

## Deferred / carry-forward
- Multi-instance restore coordination still needs a durable/shared maintenance authority if deployment topology changes beyond the current single-instance model.
