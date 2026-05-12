'use client';

import { Histogram } from '@/components/histogram';
import { ImageDetail } from '@/lib/image-types';
import { imageUrl } from '@/lib/image-url';
import {
    humanizeColorPrimaries,
    humanizeTransferFunction,
    humanizeColorPipelineDecision,
} from '@/components/color-details-section';
import { COLOR_PIPELINE_DECISIONS, type ColorPipelineDecision } from '@/lib/color-pipeline-decisions';
import { findNearestImageSize, DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';

interface LightboxColorPipProps {
    image: ImageDetail;
    t: (key: string, values?: Record<string, string | number>) => string;
    open: boolean;
    onToggle: () => void;
    imageSizes?: number[];
    cycleModeRef?: React.RefObject<(() => void) | null>;
}

/**
 * Standalone lightbox color pip (P4-C4 / R4-L1 extraction from lightbox.tsx).
 *
 * Renders a chip in the lightbox bottom-left corner showing the image's
 * primaries / transfer / HDR signal, and (when toggled open) a panel with
 * the full breakdown plus a compact histogram (P4-C1) for in-place gamut
 * audit while reviewing.
 *
 * P4-C5 / R4-L2 / UX-L2: chip uses `min-h-11` so the touch-target floor
 * (≥ 44 px per WCAG 2.5.5 / Apple HIG) is met without padding inflation.
 */
export function LightboxColorPip({ image, t, open, onToggle, imageSizes = DEFAULT_IMAGE_SIZES, cycleModeRef }: LightboxColorPipProps) {
    const hasData = Boolean(image.color_primaries || image.transfer_function || image.color_pipeline_decision);
    if (!hasData) return null;

    const primaries = humanizeColorPrimaries(image.color_primaries);
    const transfer = humanizeTransferFunction(image.transfer_function, t);
    const rawDecision = image.color_pipeline_decision;
    const pipeline = humanizeColorPipelineDecision(
        rawDecision && COLOR_PIPELINE_DECISIONS.includes(rawDecision as typeof COLOR_PIPELINE_DECISIONS[number])
            ? (rawDecision as ColorPipelineDecision)
            : undefined,
        t,
    );
    // C3-A3 / C3-UX-MED-2: surface the HDR flag in the lightbox color pip.
    // C4-A3 / C4-HDR-MED-2: gate on transfer_function — same convention as the
    // sidebar Color Details accordion (color-details-section.tsx :88). The
    // schema invariant is_hdr === (transfer_function === 'pq' || 'hlg') holds,
    // so behavior is unchanged for current rows; harmonizing the gate
    // future-proofs against new transfer values (HDR10+ / Dolby Vision) and
    // keeps the audit logic consistent across both entry points. Both
    // image.transfer_function and image.is_hdr are admin-only via privacy
    // field separation in data.ts, so this row stays hidden for public
    // viewers either way.
    const isHdr = image.transfer_function === 'pq' || image.transfer_function === 'hlg';

    // P4-C1 / R4-M2: lightbox histogram. Mounted only when the panel is
    // open so the worker spawn / pixel decode does not happen for the
    // 99% case where the user opens the lightbox without expanding the
    // pip. The `Histogram` component already lazy-mounts its Worker
    // inside its own effect — gating the React mount here is one extra
    // step of laziness so the panel-open animation stays jank-free.
    const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
    const baseJpeg = image.filename_jpeg?.replace(/\.jpg$/i, '');
    const histogramSize = findNearestImageSize(imageSizes, 640);
    const histogramJpegUrl = baseJpeg
        ? imageUrl(`/uploads/jpeg/${baseJpeg}_${histogramSize}.jpg`)
        : undefined;
    const histogramAvifUrl = baseAvif
        ? imageUrl(`/uploads/avif/${baseAvif}_${histogramSize}.avif`)
        : undefined;

    return (
        <div className="pointer-events-auto absolute bottom-4 left-4 z-10">
            <button
                type="button"
                onClick={onToggle}
                className="lightbox-color-pip inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 min-h-11 text-xs text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400 transition-colors"
                aria-expanded={open}
                aria-label={t('aria.toggleColorPip')}
                title={`${t('aria.toggleColorPip')} (C)`}
            >
                {primaries ? (
                    <span className="font-medium">{primaries}</span>
                ) : (
                    <span>{t('viewer.colorUnknown')}</span>
                )}
                {transfer && <span className="opacity-80">· {transfer}</span>}
                {isHdr && (
                    <span
                        className="hdr-badge ml-1 inline-block px-1.5 py-0.5 text-[10px] font-bold bg-gradient-to-r from-amber-300 to-orange-400 text-white rounded shadow-sm"
                        aria-label={t('viewer.hdrBadgeAriaLabel')}
                        role="img"
                    >
                        {t('viewer.hdrBadge')}
                    </span>
                )}
            </button>
            {open && (
                <div className="mt-1.5 rounded-lg bg-black/80 p-3 text-xs text-white backdrop-blur-sm min-w-[180px] space-y-1.5">
                    {image.color_primaries && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.colorPrimaries')}</span>
                            <span className="font-medium">{primaries || t('viewer.colorUnknown')}</span>
                        </div>
                    )}
                    {image.transfer_function && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.transferFunction')}</span>
                            <span className="font-medium">{transfer || t('viewer.colorUnknown')}</span>
                        </div>
                    )}
                    {image.color_pipeline_decision && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.colorPipelineDecision')}</span>
                            <span className="font-medium">{pipeline || t('viewer.colorUnknown')}</span>
                        </div>
                    )}
                    {/* P4-C1 / R4-M2: compact histogram in the slide-up panel.
                        The fixture-style HDR-badge single-render lock
                        (`__tests__/lightbox-color-pip-hdr.test.ts`) prevents
                        regressions here. */}
                    {histogramJpegUrl && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                            <Histogram
                                imageUrl={histogramJpegUrl}
                                avifUrl={histogramAvifUrl}
                                colorPrimaries={image.color_primaries}
                                className="w-full max-w-[200px]"
                                cycleModeRef={cycleModeRef}
                            />
                        </div>
                    )}
                    {/* C5-A1 / C5-COL-MED-1 / C5-HDR-MED-1 / C5-UX-MED-1
                        (3-way cross-angle): the HDR pill rendered in the
                        closed-pip button row above already conveys the HDR
                        signal; duplicating it here as a label/value row
                        added redundancy with no information gain. */}
                </div>
            )}
        </div>
    );
}
