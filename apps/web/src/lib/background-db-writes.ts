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

export const drainBackgroundDbWritesForRestore = drainBackgroundDbWrites;

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
