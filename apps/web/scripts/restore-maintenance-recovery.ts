import {
    clearDurableRestoreMaintenanceForRecovery,
    getDurableRestoreMaintenanceMarkerPath,
    isDurableRestoreMaintenanceMarked,
} from '../src/lib/restore-maintenance-durable';

const CLEAR_CONFIRM_FLAG = '--confirm-clear-restore-maintenance';

function usage() {
    console.error([
        'Usage:',
        '  npm run restore:maintenance -- status',
        `  npm run restore:maintenance -- clear ${CLEAR_CONFIRM_FLAG}`,
    ].join('\n'));
}

function printStatus() {
    console.log(JSON.stringify({
        markerPath: getDurableRestoreMaintenanceMarkerPath(),
        active: isDurableRestoreMaintenanceMarked(),
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

        clearDurableRestoreMaintenanceForRecovery();
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
