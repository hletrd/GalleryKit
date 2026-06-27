'use client';

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { isWideGamutPrimary, getGamutFamily } from '@/lib/color-primaries';
import { useDisplayCapability } from '@/lib/use-display-capability';
import { humanizeColorPrimariesOrLabel } from '@/lib/color-label';

interface WideGamutHintProps {
    colorPrimaries?: string | null;
    t: (key: string, values?: Record<string, string | number>) => string;
    /**
     * R28-HD-LOW-1: when true, dismiss state persists across browser
     * sessions via localStorage (30-day TTL) instead of sessionStorage.
     * Share-route recipients (/s/[key], /g/[key]) typically view the link
     * once, dismiss the hint, and don't return for weeks — sessionStorage
     * forgets between sessions and re-nags. The main /p/[id] route still
     * uses sessionStorage so a returning visitor who may have switched
     * displays week-over-week sees the hint fresh.
     */
    persistDismissal?: boolean;
}

const DISMISS_STORAGE_KEY = 'wgh-dismissed';
// R28-HD-LOW-1: localStorage key for share-route persistence. JSON-encoded
// record { gamut: string, expiresAt: number } so the dismiss expires
// automatically after the TTL window even if the visitor never returns.
const DISMISS_LOCAL_KEY = 'wgh-dismissed-v1';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface PersistedDismiss {
    gamut: string;
    expiresAt: number;
}

function readLocalDismiss(): PersistedDismiss | null {
    try {
        const raw = localStorage.getItem(DISMISS_LOCAL_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedDismiss;
        if (
            typeof parsed?.gamut !== 'string' ||
            typeof parsed?.expiresAt !== 'number' ||
            !Number.isFinite(parsed.expiresAt)
        ) {
            return null;
        }
        if (parsed.expiresAt < Date.now()) {
            try { localStorage.removeItem(DISMISS_LOCAL_KEY); } catch { /* noop */ }
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function writeLocalDismiss(gamut: string): void {
    try {
        const record: PersistedDismiss = { gamut, expiresAt: Date.now() + DISMISS_TTL_MS };
        localStorage.setItem(DISMISS_LOCAL_KEY, JSON.stringify(record));
    } catch {
        // localStorage write can throw under privacy-restricted modes or
        // quota; the in-memory dismiss still hides the banner this render.
    }
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
//
// R10-H4 partial / R12-M1: the hint is now dismissible per session via
// an `×` close button. Dismiss state is persisted in `sessionStorage`
// keyed by the photo's `colorPrimaries` value, so navigating to a photo
// with a DIFFERENT gamut still surfaces the educational hint. The
// per-session scope (not localStorage) means visitors revisiting next
// week — possibly on a different display — see the hint again rather
// than having it permanently suppressed across all sessions.
export default function WideGamutHint({ colorPrimaries, t, persistDismissal = false }: WideGamutHintProps) {
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

    // R13-M2: dismiss key is canonicalised by gamut FAMILY rather than the
    // raw `colorPrimaries` string. Functionally-equivalent primaries values
    // (e.g. `p3-d65` and `dci-p3` both deliver as Display P3) should not
    // re-nag the visitor as if they were a fresh gamut. The family enum
    // (`srgb` / `p3` / `rec2020` / `adobergb` / `prophoto` / `unknown`) is
    // the right granularity for "did the visitor already see this hint for
    // this gamut class in this session."
    const gamutFamily = getGamutFamily(colorPrimaries);

    useEffect(() => {
        // R10-H4 / R12-M1 / R13-M2 / R28-HD-LOW-1: re-check the appropriate
        // storage whenever the photo's gamut family changes. A prior dismiss
        // for the `rec2020` family should NOT suppress the hint when the
        // visitor opens a `p3` photo (and vice versa). For share-route
        // recipients (persistDismissal=true) we use localStorage with a
        // 30-day TTL; for the main /p/[id] route we keep the per-session
        // sessionStorage behavior.
        if (persistDismissal) {
            const persisted = readLocalDismiss();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional dismiss-state hydration from localStorage
            setDismissed(persisted?.gamut === gamutFamily);
            return;
        }
        try {
            const stored = sessionStorage.getItem(DISMISS_STORAGE_KEY);
            setDismissed(stored === gamutFamily);
        } catch {
            // sessionStorage can throw in privacy-restricted contexts
            // (Safari "Block All Cookies"). Default to "not dismissed."
            setDismissed(false);
        }
    }, [gamutFamily, persistDismissal]);

    const handleDismiss = useCallback(() => {
        if (persistDismissal) {
            writeLocalDismiss(gamutFamily);
        } else {
            try {
                sessionStorage.setItem(DISMISS_STORAGE_KEY, gamutFamily);
            } catch {
                // Storage write failed (private browsing, quota). Fall through:
                // the in-memory dismiss still hides the banner for this render.
            }
        }
        setDismissed(true);
    }, [gamutFamily, persistDismissal]);

    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    const { colorGamut } = useDisplayCapability();
    const isSrgbDisplay = colorGamut === 'srgb';

    if (!mounted || !isWideGamut || !isSrgbDisplay || dismissed) return null;

    // R10-M8 / R14-M1: the encoder's delivery ceiling for every wide-gamut
    // source is Display P3 (see process-image.ts decision matrix — Adobe
    // RGB / ProPhoto / Rec.2020 all encode to P3-10bit AVIF + P3-8bit
    // WebP/JPEG). Naming the SOURCE gamut as the "available on X screens"
    // target is misleading: a Display P3 monitor already shows every
    // pixel the visitor will ever receive, regardless of whether the
    // source was Rec.2020 or Adobe RGB. The honest framing is:
    //   - delivered gamut = Display P3 (always)
    //   - source gamut    = context-only annotation (when source was
    //                       wider than P3, so the visitor understands
    //                       what they're missing on a P3 display vs the
    //                       photographer's master).
    // For P3 sources we keep the old single-gamut copy; for wider sources
    // we use the more informative "wideGamutHintWithSource" variant.
    const deliveryGamutName = 'Display P3';
    // R15-L1 / R12-L4: use the never-null helper so the fallback can't drift.
    const sourceGamutName = humanizeColorPrimariesOrLabel(colorPrimaries, t);
    const sourceIsWiderThanP3 = gamutFamily === 'rec2020' || gamutFamily === 'adobergb' || gamutFamily === 'prophoto';
    const hintText = sourceIsWiderThanP3
        ? t('viewer.wideGamutHintWithSource', { gamut: deliveryGamutName, source: sourceGamutName })
        : t('viewer.wideGamutHint', { gamut: deliveryGamutName });

    return (
        <div
            role="status"
            // R16-L4: explicit `aria-live="polite"` + `aria-atomic="true"`.
            // role="status" implies polite live-region semantics, but the hint
            // mounts asynchronously (after the `setMounted(true)` effect) and
            // some NVDA configurations don't auto-announce `role=status` on
            // initial mount when the region was previously hidden. Declaring
            // the live-region behavior explicitly gives a consistent
            // announcement across NVDA / VoiceOver / TalkBack without
            // changing visual behavior on browsers that already infer it.
            aria-live="polite"
            aria-atomic="true"
            // R13-L2 / R10-L21: dark-mode contrast lift. The previous combo
            // (`dark:bg-amber-900/20 dark:text-amber-200`) measured ≈ 3.2:1
            // against the composite dark background — below WCAG AA 4.5:1
            // for small text. Lifting the background opacity to /40 and the
            // foreground to amber-100 brings the ratio to ≈ 4.6:1.
            className="mt-2 px-3 py-2 text-xs rounded bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700/60 flex items-start gap-2"
        >
            <span className="flex-1">
                {hintText}
            </span>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('viewer.wideGamutHintDismiss')}
                className="shrink-0 -mr-1 -my-1 min-h-11 min-w-11 inline-flex items-center justify-center rounded text-amber-800/70 hover:text-amber-800 dark:text-amber-100/80 dark:hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
                <X className="h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    );
}
