'use client';

import { Histogram } from '@/components/histogram';
import { ImageDetail } from '@/lib/image-types';
import { imageUrl } from '@/lib/image-url';
import { Info, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    humanizeColorPrimaries,
    humanizeColorPrimariesOrLabel,
    humanizeTransferFunction,
    humanizeColorPipelineDecision,
} from '@/components/color-details-section';
import { COLOR_PIPELINE_DECISIONS, type ColorPipelineDecision, isP3Pipeline } from '@/lib/color-pipeline-decisions';
import { findNearestImageSize, DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';

interface LightboxColorPipProps {
    image: ImageDetail;
    t: (key: string, values?: Record<string, string | number>) => string;
    open: boolean;
    onToggle: () => void;
    imageSizes?: number[];
    cycleModeRef?: React.RefObject<(() => void) | null>;
    /** R10-L20: replicate delivered bit depth + format chips. */
    isAdmin?: boolean;
    forceSrgbDerivatives?: boolean;
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
export function LightboxColorPip({ image, t, open, onToggle, imageSizes = DEFAULT_IMAGE_SIZES, cycleModeRef, isAdmin = false, forceSrgbDerivatives = false }: LightboxColorPipProps) {
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

    // R9-LOW: copy a JSON snapshot of the audit-grade color metadata to the
    // clipboard from the lightbox expanded panel, same as the sidebar
    // ColorDetailsSection copy button.
    async function copyColorMetadata() {
        // R10-L16: pipeline_version is internal deploy metadata; omit it from
        // the user-facing clipboard JSON. See color-details-section.tsx for
        // the matching change in the sidebar copy button.
        const data = {
            iccProfileName: image.icc_profile_name ?? null,
            primaries: image.color_primaries ?? null,
            transfer: image.transfer_function ?? null,
            matrix: image.matrix_coefficients ?? null,
            decision: image.color_pipeline_decision ?? null,
            isHdr: image.is_hdr ?? null,
            hasGainMap: image.has_gain_map ?? null,
            sourceBitDepth: image.bit_depth ?? null,
        };
        try {
            const text = JSON.stringify(data, null, 2);
            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                throw new Error('clipboard unavailable');
            }
            await navigator.clipboard.writeText(text);
            toast.success(t('viewer.colorMetadataCopied'));
        } catch {
            toast.error(t('imageManager.copyFailed'));
        }
    }

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
    // R7-M8: base JPEG fallback for legacy photos missing sized derivatives.
    const histogramFallbackUrl = baseJpeg
        ? imageUrl(`/uploads/jpeg/${baseJpeg}.jpg`)
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
                            <span className="font-medium">{humanizeColorPrimariesOrLabel(image.color_primaries, t)}</span>
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
                            <span className="font-medium flex items-center gap-1">
                                {pipeline || t('viewer.colorUnknown')}
                                {/* R9-M8: replicate the Bradford D50→D65 tooltip
                                    from color-details-section in the lightbox pip
                                    expanded panel so photographers auditing DCI-P3
                                    sources get the same white-point-adaptation note. */}
                                {image.color_pipeline_decision === 'p3-from-dcip3' && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                // R16-L2: lift the tooltip-trigger hit zone to the 44 px floor
                                                // (WCAG 2.5.5 / Apple HIG / Google) — icon stays compact at
                                                // h-3 w-3, only the tappable region grows.
                                                className="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
                                                aria-label={t('viewer.colorPipelineP3FromDcip3Tooltip')}
                                            >
                                                <Info className="h-3 w-3" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('viewer.colorPipelineP3FromDcip3Tooltip')}
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                            </span>
                        </div>
                    )}
                    {/* R10-L20: delivered bit depth — same logic as
                        color-details-section.tsx delivered row. */}
                    {(image.color_pipeline_decision || image.color_primaries) && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.deliveredBitDepth')}</span>
                            <span className="font-medium">
                                {(() => {
                                    const decision = image.color_pipeline_decision
                                        ?? (image.color_primaries !== 'bt709' && image.color_primaries !== 'unknown'
                                            ? 'p3-from-displayp3'
                                            : 'srgb');
                                    if (!isP3Pipeline(decision)) {
                                        return t('viewer.deliveredBitDepthSrgb');
                                    }
                                    const webpJpegGamut = forceSrgbDerivatives ? 'sRGB' : 'P3';
                                    if (image.avif_10bit === true) {
                                        return t('viewer.deliveredBitDepthP3', { webpJpegGamut });
                                    }
                                    return t('viewer.deliveredBitDepthP3Fallback', { webpJpegGamut });
                                })()}
                            </span>
                        </div>
                    )}
                    {/* R10-L20: delivered formats — same logic as
                        color-details-section.tsx formats row. */}
                    {(image.filename_webp || image.filename_avif || image.filename_jpeg) && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.deliveredFormats')}</span>
                            <span className="font-medium flex gap-1">
                                {[
                                    image.filename_webp ? { name: 'WebP', gamut: (isAdmin && forceSrgbDerivatives) ? 'sRGB' : undefined } : null,
                                    image.filename_avif ? { name: 'AVIF', gamut: (isAdmin && image.color_pipeline_decision && isP3Pipeline(image.color_pipeline_decision)) ? 'P3' : undefined } : null,
                                    image.filename_jpeg ? { name: 'JPEG', gamut: (isAdmin && forceSrgbDerivatives) ? 'sRGB' : undefined } : null,
                                ].filter((x): x is { name: string; gamut: string | undefined } => x !== null).map((fmt) => (
                                    <span key={fmt.name} className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-white/10 rounded">
                                        {fmt.name}
                                        {fmt.gamut && (
                                            <span className="ml-0.5 text-white/50">({fmt.gamut})</span>
                                        )}
                                    </span>
                                ))}
                            </span>
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
                                fallbackImageUrl={histogramFallbackUrl}
                                colorPrimaries={image.color_primaries}
                                className="w-full max-w-[200px]"
                                cycleModeRef={cycleModeRef}
                            />
                        </div>
                    )}
                    {/* R9-LOW: copy-to-clipboard button in expanded panel so
                        photographers auditing in the lightbox can capture the
                        full color metadata without switching to the sidebar. */}
                    <div className="pt-1 border-t border-white/10">
                        <button
                            type="button"
                            onClick={copyColorMetadata}
                            // R16-L2: 44 px touch-target floor for the copy button as well.
                            className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-white/60 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50 rounded px-1 py-1"
                            aria-label={t('viewer.copyColorMetadata')}
                            title={t('viewer.copyColorMetadata')}
                        >
                            <Copy className="h-3 w-3" />
                            <span className="opacity-80">{t('viewer.copyColorMetadata')}</span>
                        </button>
                    </div>
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
