'use client';

import { useState, useEffect } from 'react';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import { useDisplayCapability } from '@/lib/use-display-capability';
import { humanizeColorPrimaries } from '@/components/color-details-section';

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string, values?: Record<string, string | number>) => string;
}

// P4-B1 / R4-M1: replaced the inline `(color-gamut: p3)` MQ subscription
// with the unified `useDisplayCapability` hook. The hook covers the same
// browsers via the same MQ + adds `screen.colorGamut` (Chromium 121+,
// Safari 18+ TP) for the most accurate signal, plus a canvas-P3 probe so
// Firefox 124+ on macOS internal-P3 displays no longer falsely flags
// 'sRGB' (no MQ support in Firefox today).
//
// R5-H1: suppress rendering until after client-side hydration to avoid
// SSR→client mismatch + CLS. The SERVER_DEFAULT in useDisplayCapability
// is 'p3', so on SSR the hint is suppressed; after hydration on an sRGB
// display it would suddenly appear and shift layout. The mounted gate
// prevents the post-hydration flash.
export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        // R5-H1: delay hint until after hydration to prevent SSR→client CLS.
        // The SERVER_DEFAULT in useDisplayCapability is 'p3', so on SSR the
        // hint is suppressed; after hydration on an sRGB display it would
        // suddenly appear and shift layout. This effect defers the render
        // until the client-side display capability has resolved.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot mount flag for SSR/hydration boundary
        setMounted(true);
    }, []);

    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    const { colorGamut } = useDisplayCapability();
    const isSrgbDisplay = colorGamut === 'srgb';

    if (!mounted || !isWideGamut || !isSrgbDisplay) return null;

    const gamutName = humanizeColorPrimaries(colorPrimaries) || t('viewer.colorUnknown');

    return (
        <div className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40">
            {t('viewer.wideGamutHint', { gamut: gamutName })}
        </div>
    );
}
