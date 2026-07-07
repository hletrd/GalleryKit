/**
 * AGG9B-07 / TEST9-01 (loop-B cycle 9b): the restore drain checklist —
 * previously an inline sequence of `if (!xDrained) return` blocks inside
 * `restoreDatabase()` pinned only by source-text scans — extracted into an
 * injectable orchestrator so the safety-critical contract (each stage runs
 * in order; the FIRST failing stage aborts; later stages never run) is
 * provable by behavior tests instead of string slices. Pattern precedent:
 * `computeBackfillExitCode` in backfill-color-pipeline.ts.
 *
 * C6-03 contract carried over verbatim: restore quiescence is a manual
 * drain-checklist — EVERY process-local DB writer MUST be drained before the
 * import replaces the tables, or the writer's in-flight commits corrupt the
 * restored state. When adding a new buffered/queued DB writer (analytics
 * timer, deferred metadata writer, etc.), add its bounded drain as a stage
 * in `restoreDatabase()`'s checklist wiring. Each drain either self-limits
 * or races a timeout and ABORTS the restore on timeout (never imports over
 * concurrent writes).
 */

export interface RestoreDrainStage {
    /** Stable stage identifier surfaced in the failure result. */
    name: string;
    /** Bounded drain; resolves false when the drain budget expired. */
    drain: () => Promise<boolean>;
    /** Operator-facing abort message logged when this stage fails. */
    abortLog: string;
}

export type RestoreDrainResult =
    | { ok: true }
    | { ok: false; stage: string };

/**
 * Run the drain stages strictly in order. The first stage whose drain
 * resolves false logs its abort message and short-circuits — later stages
 * are never invoked. A thrown drain propagates to the caller (matching the
 * previous inline behavior, where the surrounding catch aborts the restore).
 */
export async function runRestoreDrainChecklist(
    stages: RestoreDrainStage[],
    log: (message: string) => void = console.error,
): Promise<RestoreDrainResult> {
    for (const stage of stages) {
        const drained = await stage.drain();
        if (!drained) {
            log(stage.abortLog);
            return { ok: false, stage: stage.name };
        }
    }
    return { ok: true };
}
