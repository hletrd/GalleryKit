import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

const backgroundDbWrites = new Set<Promise<void>>();

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

export async function drainBackgroundDbWritesForRestore() {
    while (backgroundDbWrites.size > 0) {
        await Promise.allSettled([...backgroundDbWrites]);
    }
}

export function getBackgroundDbWriteCountForTests() {
    return backgroundDbWrites.size;
}
