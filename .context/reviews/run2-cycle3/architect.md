# Architect — Run-2 Cycle 3 (HEAD 420b7852)

Angle: architectural/design risks, coupling, layering.

## Findings
NONE net-new actionable.

### Observations
- **DEF-01 (unify backfill cores)**: third-drift trigger fired in cycle-2 (AGG2-01) and was addressed with a proportionate targeted fix + contract lock on BOTH paths' detection-failure column set. This cycle: NO new structural/logic change to either backfill file, so the tightened exit criterion ("re-open on the NEXT structural/logic change to either file") has NOT fired. The two implementations (`admin-backfill-runner.ts` runner + `backfill-color-pipeline.ts` sidecar) remain intentionally parallel; the contract tests (`backfill-detection-failure-contract.test.ts`, `admin-backfill-runner-detection-failure.test.ts`, `backfill-color-pipeline.test.ts`) now guard both the success and detection-failure column sets. Continued deferral is correct.
- **Layering**: validation → resolution → queue config flow (`gallery-config-shared.ts` → `gallery-config.ts` → `image-queue.ts`) intact. Client-safe modules (`color-primaries.ts`, `color-pipeline-decisions.ts`) correctly separated from server-only detection.
- **Single-writer topology**: process-local state (restore-maintenance flag, queue, rate-limit fast-path maps, backfill `running` flag) consistent with the documented single web-instance deployment. Advisory-lock scope note (C8R-RPL-06) documents the MySQL-server-wide lock namespace caveat.
- **Coupling**: serve-upload couples to `getGalleryConfig` + `IMAGE_PIPELINE_VERSION` + `settings-hash` for ETag invalidation — intentional and documented (P4-E2). No accidental coupling found.

Confidence: High. No design risk introduced; deferral exit criteria correctly not re-triggered.
