#!/usr/bin/env node

import fs from 'node:fs';

const CLEAR_CONFIRM_FLAG = '--confirm-clear-restore-maintenance';
const MARKER_FILENAME = 'restore-maintenance.json';

function dirname(filePath) {
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return slash > 0 ? filePath.slice(0, slash) : '.';
}

function getMarkerLocation() {
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
        path: `${dir}/${MARKER_FILENAME}`,
    };
}

function markerExists() {
    try {
        fs.statSync(getMarkerLocation().path);
        return true;
    } catch (err) {
        if (err && typeof err === 'object' && err.code === 'ENOENT') {
            return false;
        }
        console.error('[restore] Failed to read restore maintenance marker; failing closed:', err);
        return true;
    }
}

function clearMarker() {
    try {
        fs.unlinkSync(getMarkerLocation().path);
    } catch (err) {
        if (!err || typeof err !== 'object' || err.code !== 'ENOENT') {
            throw err;
        }
    }
}

function usage() {
    console.error([
        'Usage:',
        '  npm run restore:maintenance -- status',
        `  npm run restore:maintenance -- clear ${CLEAR_CONFIRM_FLAG}`,
    ].join('\n'));
}

function printStatus() {
    const markerLocation = getMarkerLocation();
    console.log(JSON.stringify({
        markerPath: markerLocation.path,
        active: markerExists(),
    }, null, 2));
}

async function main() {
    const [command, ...flags] = process.argv.slice(2);

    if (!command || command === 'status') {
        printStatus();
        return;
    }

    if (command === 'clear') {
        if (!flags.includes(CLEAR_CONFIRM_FLAG)) {
            console.error(`Refusing to clear restore maintenance without ${CLEAR_CONFIRM_FLAG}.`);
            usage();
            process.exitCode = 2;
            return;
        }

        clearMarker();
        printStatus();
        return;
    }

    usage();
    process.exitCode = 2;
}

void main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
