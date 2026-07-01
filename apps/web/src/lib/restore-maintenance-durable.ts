import fs from 'node:fs';

import {
    beginRestoreMaintenance,
    endRestoreMaintenance,
    setRestoreMaintenanceActiveForProcess,
} from '@/lib/restore-maintenance';

const RESTORE_MAINTENANCE_MARKER_FILENAME = 'restore-maintenance.json';

function dirname(filePath: string) {
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
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
        return fs.existsSync(/* turbopackIgnore: true */ markerPath);
    } catch (err) {
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
    const started = beginRestoreMaintenance(options);
    if (started) {
        try {
            writeDurableRestoreMaintenance();
        } catch (err) {
            endRestoreMaintenance();
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
