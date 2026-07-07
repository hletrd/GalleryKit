import fs from 'node:fs';

import {
    beginRestoreMaintenance,
    endRestoreMaintenance,
    isRestoreMaintenanceActive,
    setRestoreMaintenanceActiveForProcess,
} from '@/lib/restore-maintenance';

const RESTORE_MAINTENANCE_MARKER_FILENAME = 'restore-maintenance.json';

function dirname(filePath: string) {
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (slash === 0) return filePath.slice(0, 1);
    return slash > 0 ? filePath.slice(0, slash) : '.';
}

function getRestoreMaintenanceMarkerLocation() {
    if (process.env.NODE_ENV === 'test' && process.env.RESTORE_MAINTENANCE_MARKER_PATH) {
        return {
            dir: dirname(process.env.RESTORE_MAINTENANCE_MARKER_PATH),
            path: process.env.RESTORE_MAINTENANCE_MARKER_PATH,
        };
    }

    const configuredDir = process.env.RESTORE_MAINTENANCE_DIR?.trim();
    const dir = configuredDir || (process.env.NODE_ENV === 'production' ? '/app/data' : 'data');
    return {
        dir,
        path: `${dir}/${RESTORE_MAINTENANCE_MARKER_FILENAME}`,
    };
}

export function getDurableRestoreMaintenanceMarkerPath() {
    return getRestoreMaintenanceMarkerLocation().path;
}

function readDurableRestoreMaintenance() {
    const markerPath = getRestoreMaintenanceMarkerLocation().path;
    try {
        fs.statSync(/* turbopackIgnore: true */ markerPath);
        return true;
    } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err
            ? (err as { code?: unknown }).code
            : null;
        if (code === 'ENOENT') {
            return false;
        }
        console.error('[restore] Failed to read restore maintenance marker; failing closed:', err);
        return true;
    }
}

export function isDurableRestoreMaintenanceMarked() {
    return readDurableRestoreMaintenance();
}

export function assertNoDurableRestoreMaintenanceForScript(scriptName: string) {
    if (!isDurableRestoreMaintenanceMarked()) return;

    throw new Error(
        `[${scriptName}] Restore maintenance is active. Refusing sidecar writes until the restore marker is cleared with the documented recovery command.`,
    );
}

function writeDurableRestoreMaintenance() {
    const markerLocation = getRestoreMaintenanceMarkerLocation();
    fs.mkdirSync(/* turbopackIgnore: true */ markerLocation.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(/* turbopackIgnore: true */ markerLocation.path, JSON.stringify({
        active: true,
        startedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
}

function clearDurableRestoreMaintenance() {
    const markerPath = getRestoreMaintenanceMarkerLocation().path;
    try {
        fs.unlinkSync(/* turbopackIgnore: true */ markerPath);
    } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err
            ? (err as { code?: unknown }).code
            : null;
        if (code !== 'ENOENT') {
            throw err;
        }
    }
}

export function syncRestoreMaintenanceFromDurable() {
    if (readDurableRestoreMaintenance()) {
        setRestoreMaintenanceActiveForProcess(true);
        return true;
    }
    return false;
}

export function beginDurableRestoreMaintenance(options: { allowExisting?: boolean } = {}) {
    // AGG9B-21 (loop-B cycle 9b): remember whether maintenance was ALREADY
    // active before this call. With `allowExisting: true`,
    // beginRestoreMaintenance() returns true for a window someone else owns
    // (e.g. recovered from the durable marker at boot); a marker-write
    // failure must then NOT clear the process-local flag out from under the
    // actual owner — that would let uploads/mutations proceed while the
    // on-disk marker still claims maintenance.
    const wasActive = isRestoreMaintenanceActive();
    const started = beginRestoreMaintenance(options);
    if (started) {
        try {
            writeDurableRestoreMaintenance();
        } catch (err) {
            if (!wasActive) {
                endRestoreMaintenance();
            }
            throw err;
        }
    }
    return started;
}

export function endDurableRestoreMaintenance() {
    try {
        clearDurableRestoreMaintenance();
    } finally {
        endRestoreMaintenance();
    }
}

export function clearDurableRestoreMaintenanceForRecovery() {
    endDurableRestoreMaintenance();
}
