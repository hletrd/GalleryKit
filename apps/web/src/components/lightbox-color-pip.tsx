'use client';

import { useState, useRef, useEffect } from 'react';
import { Histogram } from '@/components/histogram';
import { ImageDetail } from '@/lib/image-types';
import { imageUrl } from '@/lib/image-url';
import { Info, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    humanizeColorPrimaries,
    humanizeColorPrimariesOrLabel,
    humanizeTransferFunction,
    humanizeColorPipelineDecision,
} from '@/components/color-details-section';
import { COLOR_PIPELINE_DECISIONS, type ColorPipelineDecision, isP3Pipeline } from '@/lib/color-pipeline-decisions';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import { findNearestImageSize, DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';

interface LightboxColorPipProps {
    image: ImageDetail;
    t: (key: string, values?: Record<string, string | number>) => string;
    open: boolean;
    onToggle: () => void;
    interactive?: boolean;
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
export function LightboxColorPip({ image, t, open, onToggle, interactive = true, imageSizes = DEFAULT_IMAGE_SIZES, cycleModeRef, isAdmin = false, forceSrgbDerivatives = false }: LightboxColorPipProps) {
    // C14-02: gate admin-only `transfer_function`/`color_pipeline_decision` on
    // `isAdmin` to match the AGG-M3 convention in the sibling
    // color-details-section.tsx. No-op for current behavior (both undefined for
    // public viewers; `color_primaries` is public and already drives the pip);
    // closes a defense-in-depth trap for a future call site passing admin-fetched
    // data with `isAdmin={false}`.
    const hasData = Boolean(image.color_primaries || (isAdmin && image.transfer_function) || (isAdmin && image.color_pipeline_decision));
    // R28-UX-LOW-2: transient checkmark feedback on copy. Mirrors the sidebar
    // ColorDetailsSection so both copy buttons feel identical to the
    // photographer regardless of which surface they used.
    const [copied, setCopied] = useState(false);
    // C4-B1: Track the copy-feedback timer so we can clear it on unmount.
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (copyTimerRef.current) {
            clearTimeout(copyTimerRef.current);
        }
    }, []);
    if (!hasData) return null;

    const primaries = humanizeColorPrimaries(image.color_primaries);
    const transfer = isAdmin ? humanizeTransferFunction(image.transfer_function, t) : null;
    const rawDecision = isAdmin ? image.color_pipeline_decision : undefined;
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
    const isHdr = isAdmin && (image.transfer_function === 'pq' || image.transfer_function === 'hlg');

    // R9-LOW: copy a JSON snapshot of the audit-grade color metadata to the
    // clipboard from the lightbox expanded panel, same as the sidebar
    // ColorDetailsSection copy button.
    // NOTE (R19C19 CQ19-03): kept as a plain function declaration, NOT
    // useCallback — this component has a conditional early return above, so a
    // hook here violates react-hooks/rules-of-hooks. The handler is attached to
    // a DOM <button>, so a fresh reference per render carries no re-render cost.
    async function copyColorMetadata() {
        // R10-L16: pipeline_version is internal deploy metadata; omit it from
        // the user-facing clipboard JSON. See color-details-section.tsx for
        // the matching change in the sidebar copy button.
        // R15C15 SEC-15-01: gate admin-only fields on isAdmin so the clipboard
        // payload matches the visible (isAdmin-gated) pip rows. Only
        // color_primaries and avif_10bit are public.
        const data = {
            iccProfileName: isAdmin ? (image.icc_profile_name ?? null) : null,
            primaries: image.color_primaries ?? null,
            transfer: isAdmin ? (image.transfer_function ?? null) : null,
            matrix: isAdmin ? (image.matrix_coefficients ?? null) : null,
            decision: isAdmin ? (image.color_pipeline_decision ?? null) : null,
            isHdr: isAdmin ? (image.is_hdr ?? null) : null,
            hasGainMap: isAdmin ? (image.has_gain_map ?? null) : null,
            sourceBitDepth: isAdmin ? (image.bit_depth ?? null) : null,
            avif10bit: image.avif_10bit ?? null,
        };
        try {
            const text = JSON.stringify(data, null, 2);
            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                // R15C15 CR-15: clipboard API requires a secure context (HTTPS
                // or localhost). Fall back to the legacy execCommand copy so
                // photographers on HTTP LAN installs can export color metadata
                // from the lightbox panel too — matches color-details-section.
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (!ok) throw new Error('execCommand copy failed');
            } else {
                await navigator.clipboard.writeText(text);
            }
            toast.success(t('viewer.colorMetadataCopied'));
            // R28-UX-LOW-2: 1.2 s checkmark flip mirrors color-details-section
            // so both copy entry points behave identically.
            setCopied(true);
            copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
        } catch {
            toast.error(t('viewer.copyFailed'));
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
                tabIndex={interactive ? 0 : -1}
                className="lightbox-color-pip inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 min-h-11 text-xs text-white hover:bg-black/80 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
                aria-expanded={interactive && open}
                aria-label={`${t('aria.toggleColorPip')}: ${[
                    primaries || t('viewer.colorUnknown'),
                    transfer,
                    // AGG-M3 (run-6 cycle-2): gate the HDR badge mention on
                    // isAdmin explicitly (the WI-09 honesty invariant), not on
                    // the indirect transfer_function-nullness coincidence.
                    (isAdmin && isHdr) ? t('viewer.hdrBadge') : null,
                ].filter(Boolean).join(' · ')}`}
                title={`${t('aria.toggleColorPip')} (C)`}
            >
                {primaries ? (
                    <span className="font-medium" aria-hidden="true">{primaries}</span>
                ) : (
                    <span aria-hidden="true">{t('viewer.colorUnknown')}</span>
                )}
                {transfer && <span className="opacity-80" aria-hidden="true">· {transfer}</span>}
                {isAdmin && isHdr && (
                    <span
                        className="hdr-badge ml-1 inline-block px-1.5 py-0.5 text-[10px] font-bold bg-gradient-to-r from-amber-300 to-orange-400 text-amber-950 rounded shadow-sm"
                        aria-hidden="true"
                    >
                        {t('viewer.hdrBadge')}
                    </span>
                )}
            </button>
            {interactive && open && (
                <div className="mt-1.5 rounded-lg bg-black/80 p-3 text-xs text-white backdrop-blur-sm min-w-[180px] space-y-1.5">
                    {image.color_primaries && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.colorPrimaries')}</span>
                            <span className="font-medium">{humanizeColorPrimariesOrLabel(image.color_primaries, t)}</span>
                        </div>
                    )}
                    {isAdmin && image.transfer_function && (
                        <div className="flex justify-between gap-3">
                            <span className="opacity-70">{t('viewer.transferFunction')}</span>
                            <span className="font-medium">{transfer || t('viewer.colorUnknown')}</span>
                        </div>
                    )}
                    {isAdmin && image.color_pipeline_decision && (
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
                                                className="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
                                        ?? (isWideGamutPrimary(image.color_primaries)
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
                            className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-white/60 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded px-1 py-1"
                            aria-label={t('viewer.copyColorMetadata')}
                            title={t('viewer.copyColorMetadata')}
                        >
                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
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
