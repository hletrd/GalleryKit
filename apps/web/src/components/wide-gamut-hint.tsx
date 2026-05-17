'use client';

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import { useDisplayCapability } from '@/lib/use-display-capability';
import { humanizeColorPrimaries } from '@/components/color-details-section';

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string, values?: Record<string, string | number>) => string;
}

const DISMISS_STORAGE_KEY = 'wgh-dismissed';

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
//
// R10-H4 partial / R12-M1: the hint is now dismissible per session via
// an `×` close button. Dismiss state is persisted in `sessionStorage`
// keyed by the photo's `colorPrimaries` value, so navigating to a photo
// with a DIFFERENT gamut still surfaces the educational hint. The
// per-session scope (not localStorage) means visitors revisiting next
// week — possibly on a different display — see the hint again rather
// than having it permanently suppressed across all sessions.
export default function WideGamutHint({ colorPrimaries, t }: WideGamutHintProps) {
    const [mounted, setMounted] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        // R5-H1: delay hint until after hydration to prevent SSR→client CLS.
        // The SERVER_DEFAULT in useDisplayCapability is 'p3', so on SSR the
        // hint is suppressed; after hydration on an sRGB display it would
        // suddenly appear and shift layout. This effect defers the render
        // until the client-side display capability has resolved.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot mount flag for SSR/hydration boundary
        setMounted(true);
    }, []);

    useEffect(() => {
        // R10-H4 / R12-M1: re-check sessionStorage whenever the photo's
        // gamut changes. A prior dismiss for `bt2020` should NOT suppress
        // the hint when the visitor opens a `p3-d65` photo (and vice
        // versa); the dismiss key includes the primaries value so each
        // gamut decision is independent.
        try {
            const stored = sessionStorage.getItem(DISMISS_STORAGE_KEY);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional dismiss-state hydration from sessionStorage
            setDismissed(stored === (colorPrimaries ?? ''));
        } catch {
            // sessionStorage can throw in privacy-restricted contexts
            // (Safari "Block All Cookies"). Default to "not dismissed."
            setDismissed(false);
        }
    }, [colorPrimaries]);

    const handleDismiss = useCallback(() => {
        try {
            sessionStorage.setItem(DISMISS_STORAGE_KEY, colorPrimaries ?? '');
        } catch {
            // Storage write failed (private browsing, quota). Fall through:
            // the in-memory dismiss still hides the banner for this render.
        }
        setDismissed(true);
    }, [colorPrimaries]);

    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    const { colorGamut } = useDisplayCapability();
    const isSrgbDisplay = colorGamut === 'srgb';

    if (!mounted || !isWideGamut || !isSrgbDisplay || dismissed) return null;

    const gamutName = humanizeColorPrimaries(colorPrimaries) || t('viewer.colorUnknown');

    return (
        <div
            role="status"
            className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40 flex items-start gap-2"
        >
            <span className="flex-1">
                {t('viewer.wideGamutHint', { gamut: gamutName })}
            </span>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('viewer.wideGamutHintDismiss')}
                className="shrink-0 -mr-1 -my-1 min-h-11 min-w-11 inline-flex items-center justify-center rounded text-amber-800/70 hover:text-amber-800 dark:text-amber-200/70 dark:hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            >
                <X className="h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    );
}
