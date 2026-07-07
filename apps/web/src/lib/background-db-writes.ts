import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

const backgroundDbWrites = new Set<Promise<void>>();
const analyticsDbWrites = new Set<Promise<unknown>>();
const analyticsQueue: Array<() => void> = [];
let activeAnalyticsWrites = 0;

export const ANALYTICS_DB_WRITE_CONCURRENCY = 2;
export const ANALYTICS_DB_WRITE_MAX_PENDING = 1000;

export function trackBackgroundDbWrite<T>(write: () => Promise<T>): Promise<T | undefined> {
    if (isRestoreMaintenanceActive()) {
        return Promise.resolve(undefined);
    }

    const promise = (async () => {
        if (isRestoreMaintenanceActive()) {
            return undefined;
        }
        return write();
    })();

    const tracked = promise.then(
        () => undefined,
        () => undefined,
    ).finally(() => {
        backgroundDbWrites.delete(tracked);
    });
    backgroundDbWrites.add(tracked);

    return promise;
}

function pumpAnalyticsQueue(): void {
    while (activeAnalyticsWrites < ANALYTICS_DB_WRITE_CONCURRENCY) {
        const run = analyticsQueue.shift();
        if (!run) return;
        run();
    }
}

export function trackAnalyticsDbWrite<T>(write: () => Promise<T>): Promise<T | undefined> {
    if (isRestoreMaintenanceActive()) {
        return Promise.resolve(undefined);
    }

    if (activeAnalyticsWrites + analyticsQueue.length >= ANALYTICS_DB_WRITE_MAX_PENDING) {
        return Promise.resolve(undefined);
    }

    const promise: Promise<T | undefined> = new Promise<T | undefined>((resolve, reject) => {
        analyticsQueue.push(() => {
            activeAnalyticsWrites++;
            (async () => {
                if (isRestoreMaintenanceActive()) {
                    return undefined;
                }
                return write();
            })().then(resolve, reject).finally(() => {
                activeAnalyticsWrites--;
                pumpAnalyticsQueue();
            });
        });
        pumpAnalyticsQueue();
    });
    const tracked = promise.then(
        () => undefined,
        () => undefined,
    ).finally(() => {
        analyticsDbWrites.delete(tracked);
    });
    analyticsDbWrites.add(tracked);

    return promise;
}

export async function drainBackgroundDbWrites() {
    while (backgroundDbWrites.size > 0 || analyticsDbWrites.size > 0 || analyticsQueue.length > 0) {
        pumpAnalyticsQueue();
        await Promise.allSettled([...backgroundDbWrites, ...analyticsDbWrites]);
    }
}

// C6-03 (run-10 cycle-6): the restore path drains this queue BEFORE importing a
// backup, while holding four advisory locks + the durable maintenance marker.
// `drainBackgroundDbWrites` loops until every tracked promise settles; a single
// stuck analytics write (metadata-lock wait, network partition to a remote DB)
// would otherwise hang the restore indefinitely and wedge uploads/processing/
// admin mutations site-wide with no operator signal. This bounded wrapper races
// the drain against a timeout (matching the 15 s budget the graceful-shutdown
// path already applies to the SAME drain) and returns false on timeout so the
// restore caller ABORTS — identical to its sibling maintenance/mutation drains.
export const RESTORE_BACKGROUND_DRAIN_TIMEOUT_MS = 15_000;

export async function drainBackgroundDbWritesForRestore(
    timeoutMs: number = RESTORE_BACKGROUND_DRAIN_TIMEOUT_MS,
): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        // Do not keep the event loop alive solely for this drain timer.
        timer.unref?.();
    });
    try {
        return await Promise.race([
            drainBackgroundDbWrites().then(() => true as const),
            timeout,
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function getBackgroundDbWriteCountForTests() {
    return backgroundDbWrites.size;
}

export function getAnalyticsDbWriteStateForTests() {
    return {
        active: activeAnalyticsWrites,
        queued: analyticsQueue.length,
        tracked: analyticsDbWrites.size,
    };
}
