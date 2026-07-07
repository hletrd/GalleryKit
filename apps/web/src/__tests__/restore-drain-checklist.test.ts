import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runRestoreDrainChecklist, type RestoreDrainStage } from '@/lib/restore-drain-checklist';

// AGG9B-07 / TEST9-01 (loop-B cycle 9b): the restore drain-checklist
// orchestration was previously pinned only by source-text scans — no test
// ever executed the ordering / stop-at-first-failure contract that keeps a
// DB restore from importing over an in-flight process-local writer. These
// behavior tests drive the extracted orchestrator with injected stages.

function makeStages(outcomes: boolean[], calls: string[]): RestoreDrainStage[] {
    const names = ['shared-group-view-counts', 'image-queue', 'background-db-writes', 'maintenance-sweeps', 'admin-mutations'];
    return outcomes.map((outcome, i) => ({
        name: names[i],
        drain: vi.fn(async () => {
            calls.push(names[i]);
            return outcome;
        }),
        abortLog: `Restore aborted: ${names[i]} did not settle within the drain budget`,
    }));
}

describe('runRestoreDrainChecklist', () => {
    it('runs all stages in order and reports ok when every drain settles', async () => {
        const calls: string[] = [];
        const log = vi.fn();

        const result = await runRestoreDrainChecklist(makeStages([true, true, true, true, true], calls), log);

        expect(result).toEqual({ ok: true });
        expect(calls).toEqual(['shared-group-view-counts', 'image-queue', 'background-db-writes', 'maintenance-sweeps', 'admin-mutations']);
        expect(log).not.toHaveBeenCalled();
    });

    it.each([
        [0, 'shared-group-view-counts', ['shared-group-view-counts']],
        [1, 'image-queue', ['shared-group-view-counts', 'image-queue']],
        [2, 'background-db-writes', ['shared-group-view-counts', 'image-queue', 'background-db-writes']],
        [3, 'maintenance-sweeps', ['shared-group-view-counts', 'image-queue', 'background-db-writes', 'maintenance-sweeps']],
        [4, 'admin-mutations', ['shared-group-view-counts', 'image-queue', 'background-db-writes', 'maintenance-sweeps', 'admin-mutations']],
    ])('stops at failing stage %i (%s): later stages never run and the abort is logged', async (failIndex, stageName, expectedCalls) => {
        const calls: string[] = [];
        const outcomes = [true, true, true, true, true];
        outcomes[failIndex as number] = false;
        const log = vi.fn();

        const result = await runRestoreDrainChecklist(makeStages(outcomes, calls), log);

        expect(result).toEqual({ ok: false, stage: stageName });
        // The failing stage is the LAST drain invoked — nothing after it runs.
        expect(calls).toEqual(expectedCalls);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(expect.stringContaining(String(stageName)));
    });

    it('propagates a thrown drain to the caller (the restore catch aborts)', async () => {
        const calls: string[] = [];
        const stages = makeStages([true, true, true, true, true], calls);
        stages[2] = {
            ...stages[2],
            drain: vi.fn(async () => {
                calls.push('background-db-writes');
                throw new Error('drain exploded');
            }),
        };
        const log = vi.fn();

        await expect(runRestoreDrainChecklist(stages, log)).rejects.toThrow('drain exploded');
        expect(calls).toEqual(['shared-group-view-counts', 'image-queue', 'background-db-writes']);
        expect(log).not.toHaveBeenCalled();
    });
});

describe('restoreDatabase drain-checklist wiring (source contract)', () => {
    // The orchestrator's behavior is executed above; this thin pin only
    // proves restoreDatabase actually delegates to it with all five stages
    // in the documented order and aborts on a failed result.
    it('wires the five documented stages through runRestoreDrainChecklist in order', () => {
        const source = readFileSync(
            path.join(process.cwd(), 'src/app/[locale]/admin/db-actions.ts'),
            'utf8',
        );
        const fnStart = source.indexOf('export async function restoreDatabase');
        expect(fnStart).toBeGreaterThan(-1);
        const body = source.slice(fnStart);

        const checklistIdx = body.indexOf('await runRestoreDrainChecklist([');
        expect(checklistIdx).toBeGreaterThan(-1);

        const flushIdx = body.indexOf('await flushBufferedSharedGroupViewCounts()');
        expect(flushIdx).toBe(-1);

        const stageOrder = [
            'drainSharedGroupViewCountsForRestore',
            'quiesceImageProcessingQueueForRestore',
            'drainBackgroundDbWritesForRestore',
            'drainMaintenanceSweepsForRestore',
            'drainAdminMutationsForRestore',
        ];
        let cursor = checklistIdx;
        for (const stage of stageOrder) {
            const idx = body.indexOf(stage, cursor);
            expect(idx, `${stage} must appear inside the checklist after the previous stage`).toBeGreaterThan(cursor);
            cursor = idx;
        }

        const abortIdx = body.indexOf('if (!drainResult.ok) {', checklistIdx);
        expect(abortIdx).toBeGreaterThan(checklistIdx);
        const abortWindow = body.slice(abortIdx, abortIdx + 200);
        expect(abortWindow).toContain("t('restoreFailed')");

        // The import must run strictly AFTER the checklist gate.
        const runRestoreIdx = body.indexOf('await runRestore(formData, t)');
        expect(runRestoreIdx).toBeGreaterThan(abortIdx);
    });
});
