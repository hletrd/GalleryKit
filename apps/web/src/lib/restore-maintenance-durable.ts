import fs from 'node:fs';
import path from 'node:path';

import {
    beginRestoreMaintenance,
    endRestoreMaintenance,
    setRestoreMaintenanceActiveForProcess,
} from '@/lib/restore-maintenance';

const RESTORE_MAINTENANCE_MARKER_FILENAME = 'restore-maintenance.json';

function getRestoreMaintenanceMarkerLocation() {
    if (process.env.NODE_ENV === 'test' && process.env.RESTORE_MAINTENANCE_MARKER_PATH) {
        return {
            dir: path.dirname(process.env.RESTORE_MAINTENANCE_MARKER_PATH),
            path: process.env.RESTORE_MAINTENANCE_MARKER_PATH,
        };
    }

    const dir = path.join(process.cwd(), 'data');
    return {
        dir,
        path: path.join(dir, RESTORE_MAINTENANCE_MARKER_FILENAME),
    };
}

function readDurableRestoreMaintenance() {
    const markerPath = getRestoreMaintenanceMarkerLocation().path;
    try {
        return fs.existsSync(markerPath);
    } catch (err) {
        console.error('[restore] Failed to read restore maintenance marker; failing closed:', err);
        return true;
    }
}

function writeDurableRestoreMaintenance() {
    const markerLocation = getRestoreMaintenanceMarkerLocation();
    fs.mkdirSync(markerLocation.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(markerLocation.path, JSON.stringify({
        active: true,
        startedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
}

function clearDurableRestoreMaintenance() {
    const markerPath = getRestoreMaintenanceMarkerLocation().path;
    try {
        fs.unlinkSync(markerPath);
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
        writeDurableRestoreMaintenance();
    }
    return started;
}

export function endDurableRestoreMaintenance() {
    clearDurableRestoreMaintenance();
    endRestoreMaintenance();
}
