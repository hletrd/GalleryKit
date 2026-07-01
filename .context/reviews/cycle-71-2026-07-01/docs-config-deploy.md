# Cycle 71 Docs / Config / Deploy Review

Reviewer: default native subagent (`019f1c0c-0e64-7ff3-b4ac-ffddc87229e2`)
HEAD: `bf86f7c176ecb1ed542d851bfa0e76e2b9d73cd5`

## Findings

### C71-02 - Disk-recovery runbook hardcodes the deploy SSH target

- Severity/confidence: Medium / High.
- File/line: `CLAUDE.md:469`, `CLAUDE.md:481-483`; policy context `AGENTS.md:18`.
- Evidence: the operational playbook says the deploy target is owned by `.env.deploy` / `$HOME/.gallerykit-secrets/gallery-deploy.env`, but the break-glass disk-full snippet tells an operator to run `ssh ubuntu@atik.kr`.
- Failure scenario: during a disk-full incident, an operator copies the hardcoded command on a deployment where `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY` changed, targets the wrong host or user, and loses recovery time while the configured host remains wedged.
- Suggested fix: replace the concrete host/user with instructions to SSH to the configured `DEPLOY_USER@DEPLOY_HOST` from the deploy env file, using `DEPLOY_KEY` when configured.

### C71-03 - Runtime env template omits `DB_SSL_CA`

- Severity/confidence: Low / High.
- File/line: `apps/web/.env.local.example:9`; supporting docs `README.md:148`, `apps/web/README.md:50`, behavior `apps/web/src/lib/mysql-cli-ssl.ts:18-20`.
- Evidence: the README and app README document that non-local DB hosts require `DB_SSL_CA` for backup/restore CLI TLS unless `DB_SSL=false`, but the copied runtime env template only shows `DB_SSL=false`.
- Failure scenario: an operator copies `.env.local.example`, sets a non-local `DB_HOST`, leaves TLS enabled, and later backup/restore fails closed with `DB_SSL_CA is required...`.
- Suggested fix: add a commented `DB_SSL_CA=/path/to/ca.pem` example adjacent to `DB_SSL`.
