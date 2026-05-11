'use client';

import { useState, useImperativeHandle } from 'react';
import { Info, ChevronDown, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { isP3Pipeline, type ColorPipelineDecision } from '@/lib/color-pipeline-decisions';
import { ImageDetail } from '@/lib/image-types';

/**
 * humanizeColorPrimaries: returns Latinate names (BT.709, Display P3, DCI-P3,
 * Rec. 2020, Adobe RGB, ProPhoto RGB) that are universally recognizable
 * across locales. Convention (per cycle-3 RPF C3-D2): primaries names stay
 * un-translated; only transfer functions get translated via
 * humanizeTransferFunction(value, t). Photographers across en/ko locales
 * read the same Latinate technical names that match camera vendor docs and
 * browser CSS spec.
 */
export function humanizeColorPrimaries(value: string | null | undefined): string | null {
    switch (value) {
        case 'bt709': return 'BT.709';
        case 'p3-d65': return 'Display P3';
        case 'dci-p3': return 'DCI-P3';
        case 'bt2020': return 'Rec. 2020';
        case 'adobergb': return 'Adobe RGB';
        case 'prophoto': return 'ProPhoto RGB';
        default: return null;
    }
}

/**
 * C3-A2 / C3-COL-MED-1 / C3-UX-MED-3: route transfer-function names through
 * the i18n callback so the lightbox color pip and Color Details accordion
 * display Korean transfer text on Korean locales (e.g. "감마 2.2" instead of
 * "Gamma 2.2") rather than mixing English humanizer output with localized
 * panel labels.
 *
 * Latinate technical names (sRGB, PQ, HLG) stay identical across locales —
 * they match SMPTE / ITU-T spec wording and camera-vendor docs. Descriptive
 * names (Gamma 2.2, Gamma 1.8, Linear) are translated.
 */
export function humanizeTransferFunction(
    value: string | null | undefined,
    t: (key: string) => string,
): string {
    switch (value) {
        case 'srgb': return t('viewer.transferSrgb');
        case 'gamma22': return t('viewer.transferGamma22');
        case 'gamma18': return t('viewer.transferGamma18');
        case 'pq': return t('viewer.transferPq');
        case 'hlg': return t('viewer.transferHlg');
        case 'linear': return t('viewer.transferLinear');
        default: return '';
    }
}

/**
 * P4-E3 / LATENT-L2 / cycle-8 deferred C8-D15: parameter type tightened
 * from `string | null | undefined` to `ColorPipelineDecision | null |
 * undefined`. The function itself still accepts unknown strings (the
 * `default` arm returns the empty fallback), so the runtime contract is
 * unchanged — but the type signature now documents the intended caller
 * surface and lets TypeScript catch a future caller that passes a raw
 * unrelated string.
 */
export function humanizeColorPipelineDecision(
    value: ColorPipelineDecision | null | undefined,
    t: (key: string) => string,
): string {
    switch (value) {
        case 'srgb': return t('viewer.colorPipelineSrgb');
        case 'p3-from-displayp3': return t('viewer.colorPipelineP3FromDisplayP3');
        case 'p3-from-dcip3': return t('viewer.colorPipelineP3FromDcip3');
        case 'p3-from-adobergb': return t('viewer.colorPipelineP3FromAdobergb');
        case 'p3-from-prophoto': return t('viewer.colorPipelineP3FromProphoto');
        case 'p3-from-rec2020': return t('viewer.colorPipelineP3FromRec2020');
        case 'srgb-from-unknown': return t('viewer.colorPipelineSrgbFromUnknown');
        default: return '';
    }
}

/**
 * P3-30 / C4-A6: lower-cases, strips trailing parenthesized suffix
 * (e.g. "Display P3 (ACES)") plus trailing "ICC profile" / "profile" words,
 * then trims. Used by `primariesMatchIcc` to deduplicate the ICC profile
 * row vs. the primaries row when both denote the same gamut.
 *
 * Exported for fixture-style testing in
 * `__tests__/color-details-primaries-match-icc.test.ts`.
 */
export function normalizeForCompare(name: string): string {
    return name
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*$/g, '')
        .replace(/\s*icc\s*profile\s*$/g, '')
        .replace(/\s*profile\s*$/g, '')
        .trim();
}

/**
 * C4-A6: shared dedup helper exposed for fixture-style testing. Returns true
 * when the human-readable primaries label and the ICC profile name normalize
 * to the same string (e.g. both reduce to "display p3").
 */
export function primariesMatchIccName(
    primariesHuman: string | null | undefined,
    iccName: string | null | undefined,
): boolean {
    if (!primariesHuman || !iccName) return false;
    return normalizeForCompare(primariesHuman) === normalizeForCompare(iccName);
}

interface ColorDetailsSectionProps {
    image: ImageDetail;
    isAdmin?: boolean;
    t: (key: string) => string;
    toggleRef?: React.RefObject<(() => void) | null>;
}

export default function ColorDetailsSection({ image, isAdmin = false, t, toggleRef }: ColorDetailsSectionProps) {
    const isHdr = image.transfer_function === 'pq' || image.transfer_function === 'hlg';
    const isNonTrivialColor = Boolean(
        (image.color_primaries && image.color_primaries !== 'bt709') ||
        (isAdmin && isHdr) ||
        (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb'),
    );
    const [showColorDetails, setShowColorDetails] = useState(isNonTrivialColor);

    // C1-CRIT-1 (cycle 1 RPF): use useImperativeHandle to expose the toggle to
    // the parent's keyboard handler. Direct ref.current = ... mutation during
    // render violates React 19's react-hooks/refs rule and breaks under
    // concurrent rendering / StrictMode mount-unmount-mount.
    useImperativeHandle(toggleRef, () => () => setShowColorDetails((prev) => !prev), []);

    const hasColorDetails = Boolean(
        image.color_primaries || image.transfer_function || image.is_hdr || (isAdmin && image.color_pipeline_decision),
    );
    if (!hasColorDetails) return null;

    const primariesHuman = humanizeColorPrimaries(image.color_primaries);
    const iccName = image.icc_profile_name || '';
    const primariesMatchIcc = primariesMatchIccName(primariesHuman, iccName);

    const colorDetailsId = `color-details-${image.id}`;

    // P4-C6 / R4-UX-L6: copy a JSON snapshot of the audit-grade color
    // metadata to the clipboard. Useful for paste-into-forum / paste-into-
    // support-ticket workflows where the photographer wants to share the
    // full pipeline decision + ICC + transfer + decision in a machine-
    // parseable form.
    async function copyColorMetadata() {
        const data = {
            iccProfileName: image.icc_profile_name ?? null,
            primaries: image.color_primaries ?? null,
            transfer: image.transfer_function ?? null,
            matrix: image.matrix_coefficients ?? null,
            decision: image.color_pipeline_decision ?? null,
            isHdr: image.is_hdr ?? null,
            hasGainMap: image.has_gain_map ?? null,
            sourceBitDepth: image.bit_depth ?? null,
            pipelineVersion: image.pipeline_version ?? null,
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

    return (
        <div className="mt-3">
            {/* B2: tooltip trigger is sibling button, not nested inside accordion button */}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setShowColorDetails(!showColorDetails)}
                    aria-expanded={showColorDetails}
                    aria-controls={colorDetailsId}
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
                    <ChevronDown className={`h-4 w-4 transition-transform ${showColorDetails ? 'rotate-180' : ''}`} />
                    {t('viewer.colorDetails')}
                </button>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={t('viewer.calibrationTooltip')}
                        >
                            <Info className="h-4 w-4" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('viewer.calibrationTooltip')}
                    </TooltipContent>
                </Tooltip>
                {/* P4-C6: clipboard copy. JSON-stringified so the receiving
                    side (forum, support ticket, etc.) can re-parse the
                    structured fields rather than re-extracting from prose. */}
                <button
                    type="button"
                    onClick={copyColorMetadata}
                    aria-label={t('viewer.copyColorMetadata')}
                    title={t('viewer.copyColorMetadata')}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    <Copy className="h-4 w-4" />
                </button>
            </div>
            {showColorDetails && (
                <div id={colorDetailsId} className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-2 transition-all">
                    {/* B3: deduplicate ICC profile + primaries */}
                    {primariesMatchIcc ? (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                            <p className="font-medium">
                                {iccName}
                                {iccName.toLowerCase().includes('p3') && (
                                    <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[11px] font-bold bg-purple-200 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200 rounded gamut-p3-badge">
                                        P3
                                    </span>
                                )}
                            </p>
                        </div>
                    ) : (
                        <>
                            {iccName && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                                    <p className="font-medium">
                                        {iccName}
                                        {iccName.toLowerCase().includes('p3') && (
                                            <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[11px] font-bold bg-purple-200 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200 rounded gamut-p3-badge">
                                                P3
                                            </span>
                                        )}
                                    </p>
                                </div>
                            )}
                            {image.color_primaries && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.colorPrimaries')}</p>
                                    <p className="font-medium">{primariesHuman || t('viewer.colorUnknown')}</p>
                                </div>
                            )}
                        </>
                    )}
                    {image.transfer_function && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.transferFunction')}</p>
                            <p className="font-medium">{humanizeTransferFunction(image.transfer_function, t) || t('viewer.colorUnknown')}</p>
                        </div>
                    )}
                    {(isAdmin && image.color_pipeline_decision) && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.colorPipelineDecision')}</p>
                            <p className="font-medium flex items-center gap-1">
                                {humanizeColorPipelineDecision(image.color_pipeline_decision as ColorPipelineDecision | null | undefined, t) || t('viewer.colorUnknown')}
                                {/* P4-C2 / R4-M3 / UX-M2: shorten the DCI-P3 label
                                    (now "Display P3 (from DCI-P3)") and surface the
                                    Bradford D50→D65 white-point-adaptation rationale
                                    in a tooltip. The label was previously inline
                                    (and noisy); the tooltip keeps the audit-grade
                                    detail one focus / hover away. */}
                                {image.color_pipeline_decision === 'p3-from-dcip3' && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                            </p>
                        </div>
                    )}
                    {/* C4-A2: source bit depth co-located with the delivered row so
                        the source-vs-delivered comparison is instant in the audit
                        panel. The EXIF grid still shows source bit depth for the
                        camera-capture audit lens; here it sits beside the delivered
                        ceiling. */}
                    {image.bit_depth != null && image.bit_depth > 0 && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.sourceBitDepth')}</p>
                            <p className="font-medium">{image.bit_depth}-bit</p>
                        </div>
                    )}
                    {/* P3-5: delivered bit depth per format */}
                    {image.color_pipeline_decision && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.deliveredBitDepth')}</p>
                            <p className="font-medium">
                                {isP3Pipeline(image.color_pipeline_decision)
                                    ? t('viewer.deliveredBitDepthP3')
                                    : t('viewer.deliveredBitDepthSrgb')}
                            </p>
                        </div>
                    )}
                    {/* P3-22: delivered formats */}
                    {(image.filename_webp || image.filename_avif || image.filename_jpeg) && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.deliveredFormats')}</p>
                            <p className="font-medium flex gap-1">
                                {[
                                    image.filename_webp && 'WebP',
                                    image.filename_avif && 'AVIF',
                                    image.filename_jpeg && 'JPEG',
                                ].filter(Boolean).map((fmt) => (
                                    <span key={fmt} className="inline-block px-1.5 py-0.5 text-[11px] font-medium bg-muted rounded">
                                        {fmt}
                                    </span>
                                ))}
                            </p>
                        </div>
                    )}
                    {isHdr && (
                        <div className="col-span-2">
                            <span
                                className="hdr-badge px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-amber-300 to-orange-400 text-white shadow-sm rounded"
                                aria-label={t('viewer.hdrBadgeAriaLabel')}
                                title={t('viewer.hdrBadgeAriaLabel')}
                                role="img"
                            >
                                {t('viewer.hdrBadge')}
                            </span>
                        </div>
                    )}
                    {/* P4-A1 / R4-H1: admin-only Apple HDR gain map audit row.
                        The SDR base + gain map shape ships an HDR scene authored
                        by the photographer; GalleryKit currently delivers the
                        SDR base only. Surfacing the row honestly tells the
                        admin that the source has an HDR layer the pipeline
                        is not yet passing through (WI-09). */}
                    {isAdmin && image.has_gain_map && (
                        <div className="col-span-2">
                            <p className="text-muted-foreground text-xs">{t('viewer.gainMap')}</p>
                            <p className="font-medium">
                                {t('viewer.gainMapPresent')}
                                <span className="ml-2 text-xs italic text-amber-700 dark:text-amber-300">
                                    {t('viewer.gainMapDeliveredAsSdr')}
                                </span>
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
