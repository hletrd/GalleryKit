const restoreMaintenanceKey = Symbol.for('gallerykit.restoreMaintenance');

type RestoreMaintenanceState = {
    active: boolean;
};

function getRestoreMaintenanceState(): RestoreMaintenanceState {
    const globalWithState = globalThis as typeof globalThis & {
        [restoreMaintenanceKey]?: RestoreMaintenanceState;
    };

    if (!globalWithState[restoreMaintenanceKey]) {
        globalWithState[restoreMaintenanceKey] = {
            active: false,
        };
    }

    return globalWithState[restoreMaintenanceKey]!;
}

export function isRestoreMaintenanceActive() {
    return getRestoreMaintenanceState().active;
}

export function beginRestoreMaintenance() {
    const state = getRestoreMaintenanceState();
    if (state.active) {
        return false;
    }

    state.active = true;
    return true;
}

export function endRestoreMaintenance() {
    getRestoreMaintenanceState().active = false;
}
