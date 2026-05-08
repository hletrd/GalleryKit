'use client';

import { useSyncExternalStore } from 'react';
import { isWideGamutPrimary } from '@/lib/color-detection';

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string) => string;
}

// C1-CRIT-3 (cycle 1 RPF): use useSyncExternalStore for matchMedia
// subscription. The previous useState + useEffect with synchronous setState
// in the effect body triggered the react-hooks/set-state-in-effect lint rule
// (cascading render anti-pattern).
function subscribeToP3Mq(callback: () => void): () => void {
    const mq = window.matchMedia('(color-gamut: p3)');
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
}
function getP3Snapshot(): boolean {
    return window.matchMedia('(color-gamut: p3)').matches;
}
function getServerSnapshot(): boolean {
    // Default to P3-capable at SSR. The hint shows only when isSrgbDisplay=true
    // (i.e. !isP3Display), so SSR HTML never includes the hint — it is the
    // safe default for an SDR-only hint.
    return true;
}

export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    const isP3Display = useSyncExternalStore(subscribeToP3Mq, getP3Snapshot, getServerSnapshot);
    const isSrgbDisplay = !isP3Display;

    if (!isWideGamut || !isSrgbDisplay) return null;

    return (
        <div className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40">
            {t('viewer.wideGamutHint')}
        </div>
    );
}
