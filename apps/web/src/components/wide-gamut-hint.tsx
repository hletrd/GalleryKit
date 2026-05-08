'use client';

import { isWideGamutPrimary } from '@/lib/color-primaries';
import { useDisplayCapability } from '@/lib/use-display-capability';

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string) => string;
}

// P4-B1 / R4-M1: replaced the inline `(color-gamut: p3)` MQ subscription
// with the unified `useDisplayCapability` hook. The hook covers the same
// browsers via the same MQ + adds `screen.colorGamut` (Chromium 121+,
// Safari 18+ TP) for the most accurate signal, plus a canvas-P3 probe so
// Firefox 124+ on macOS internal-P3 displays no longer falsely flags
// 'sRGB' (no MQ support in Firefox today).
export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    const { colorGamut } = useDisplayCapability();
    const isSrgbDisplay = colorGamut === 'srgb';

    if (!isWideGamut || !isSrgbDisplay) return null;

    return (
        <div className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40">
            {t('viewer.wideGamutHint')}
        </div>
    );
}
