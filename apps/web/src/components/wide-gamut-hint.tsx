'use client';

import { useState, useEffect } from 'react';

const WIDE_GAMUT_PRIMARIES = new Set(['p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3']);

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string) => string;
}

export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const isWideGamut = Boolean(colorPrimaries && WIDE_GAMUT_PRIMARIES.has(colorPrimaries));
    const [isSrgbDisplay, setIsSrgbDisplay] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(color-gamut: p3)');
        setIsSrgbDisplay(!mq.matches);

        const handler = (e: MediaQueryListEvent) => {
            setIsSrgbDisplay(!e.matches);
        };

        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    if (!isWideGamut || !isSrgbDisplay) return null;

    return (
        <div className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40">
            {t('viewer.wideGamutHint')}
        </div>
    );
}
