import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import {
    armDbChildProcessWatchdog,
    DB_CHILD_PROCESS_TIMEOUT_MS,
    DB_CHILD_PROCESS_KILL_GRACE_MS,
} from '@/lib/db-child-watchdog';

/**
 * C7-15 (run-10 cycle 7b): the mysqldump/mysql/migrate watchdog control flow
 * shipped (9cd8d3e8 reorder) with only source-pin coverage. These behavioral
 * tests drive the timeout, settle, double-settle, and cleanup paths with fake
 * timers and a fake child process.
 */

function makeFakeChild() {
    const emitter = new EventEmitter();
    const kill = vi.fn();
    const stdin = { destroy: vi.fn() };
    const stdout = { destroy: vi.fn() };
    const stderr = { destroy: vi.fn() };
    const child = Object.assign(emitter, {
        kill,
        stdin,
        stdout,
        stderr,
    }) as unknown as ChildProcessWithoutNullStreams;
    return { child, kill, stdin, stdout, stderr, emitter };
}

describe('armDbChildProcessWatchdog (C7-15 behavioral)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires onTimeout once after the timeout: destroys stdio, SIGTERMs, arms SIGKILL grace', () => {
        const { child, kill, stdin, stdout, stderr } = makeFakeChild();
        const onTimeout = vi.fn();
        armDbChildProcessWatchdog(child, 'test child', onTimeout);

        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS - 1);
        expect(onTimeout).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onTimeout).toHaveBeenCalledTimes(1);
        expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('test child timed out'),
        }));
        expect(stdin.destroy).toHaveBeenCalledTimes(1);
        expect(stdout.destroy).toHaveBeenCalledTimes(1);
        expect(stderr.destroy).toHaveBeenCalledTimes(1);
        expect(kill).toHaveBeenCalledWith('SIGTERM');

        // The un-settled child is force-killed after the grace window.
        vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
        expect(kill).toHaveBeenCalledWith('SIGKILL');
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('a child that settles during the grace window is NOT SIGKILLed', () => {
        const { child, kill, emitter } = makeFakeChild();
        armDbChildProcessWatchdog(child, 'test child', vi.fn());

        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS);
        expect(kill).toHaveBeenCalledWith('SIGTERM');

        emitter.emit('exit', 0);
        vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
        expect(kill).not.toHaveBeenCalledWith('SIGKILL');
    });

    it('a child that exits before the timeout never triggers onTimeout', () => {
        const { child, kill, emitter } = makeFakeChild();
        const onTimeout = vi.fn();
        const cleanup = armDbChildProcessWatchdog(child, 'test child', onTimeout);

        emitter.emit('close', 0);
        cleanup();
        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS + DB_CHILD_PROCESS_KILL_GRACE_MS);
        expect(onTimeout).not.toHaveBeenCalled();
        expect(kill).not.toHaveBeenCalled();
    });

    it('cleanup before the timeout cancels the watchdog', () => {
        const { child, kill } = makeFakeChild();
        const onTimeout = vi.fn();
        const cleanup = armDbChildProcessWatchdog(child, 'test child', onTimeout);

        cleanup();
        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS * 2);
        expect(onTimeout).not.toHaveBeenCalled();
        expect(kill).not.toHaveBeenCalled();
    });

    it('cleanup AFTER the timeout leaves kill-escalation intact (9cd8d3e8 ordering)', () => {
        const { child, kill, emitter } = makeFakeChild();
        const cleanup = armDbChildProcessWatchdog(child, 'test child', vi.fn());

        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS);
        expect(kill).toHaveBeenCalledWith('SIGTERM');

        // A late cleanup (e.g. the promise settled from the timeout path
        // itself) must not cancel the SIGKILL escalation for a hung child —
        // and must not mark the child settled.
        cleanup();
        vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
        expect(kill).toHaveBeenCalledWith('SIGKILL');

        // A very late exit after the grace window is still safe.
        expect(() => emitter.emit('exit', 0)).not.toThrow();
    });

    it('post-timeout cleanup keeps settle listeners: an exit in the grace window still cancels SIGKILL (AGG8b-14)', () => {
        const { child, kill, emitter } = makeFakeChild();
        const cleanup = armDbChildProcessWatchdog(child, 'test child', vi.fn());

        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS);
        expect(kill).toHaveBeenCalledWith('SIGTERM');

        // An unconditional caller runs cleanup right after the timeout fired…
        cleanup();
        // …and the child then exits during the SIGKILL grace window. The
        // settle listeners must still be attached so the grace timer is
        // canceled — no SIGKILL to an already-exited (or PID-reused) process.
        emitter.emit('exit', 0);
        vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
        expect(kill).not.toHaveBeenCalledWith('SIGKILL');
    });

    it('double settle (exit then close) clears the grace timer exactly once without throwing', () => {
        const { child, kill, emitter } = makeFakeChild();
        armDbChildProcessWatchdog(child, 'test child', vi.fn());

        vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS);
        emitter.emit('exit', 0);
        emitter.emit('close', 0);
        vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
        expect(kill).not.toHaveBeenCalledWith('SIGKILL');
    });
});
