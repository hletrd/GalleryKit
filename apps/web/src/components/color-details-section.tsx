'use client';

import { useState, useImperativeHandle, useEffect } from 'react';
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
 * R15-L1 / R12-L4: never-null variant for UI surfaces that always need a
 * string to render. Returns the localized `viewer.colorUnknown` literal on
 * any unrecognized value. Callers that want the discriminated branch (e.g.
 * gate the wide-gamut hint on null) keep using `humanizeColorPrimaries`.
 */
export function humanizeColorPrimariesOrLabel(
    value: string | null | undefined,
    t: (key: string) => string,
): string {
    return humanizeColorPrimaries(value) || t('viewer.colorUnknown');
}

/**
 * R9-H1: Strict allowlist for P3 ICC profile names. Substring matching
 * `includes('p3')` falsely matches "ProPhoto" (which is NOT a P3 variant).
 */
const P3_ICC_NAME_ALLOWLIST = ['display p3', 'p3-d65', 'dci-p3'];
export function isP3IccName(name: string): boolean {
    const normalized = name.toLowerCase().trim();
    return P3_ICC_NAME_ALLOWLIST.some(allowed => normalized.includes(allowed));
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
        case 'gamma24': return t('viewer.transferGamma24');
        case 'gamma26': return t('viewer.transferGamma26');
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
/**
 * R9-M6-7: humanize matrix coefficients for the admin audit panel.
 * Covers the NCLX values stored in the images table plus forward-looking
 * bt2020-cl (value 10) so the UI is ready when the NCLX map is extended.
 */
export function humanizeMatrixCoefficients(
    value: string | null | undefined,
    t: (key: string) => string,
): string {
    switch (value) {
        case 'bt709': return 'BT.709';
        case 'bt2020-ncl': return 'BT.2020 NCL';
        case 'bt2020-cl': return 'BT.2020 CL';
        case 'identity': return 'Identity';
        default: return t('viewer.colorUnknown');
    }
}

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
    // R13-L1 / R10-L18: `t` is widened to accept the optional `values`
    // interpolation map used by the dynamic accordion label
    // (`viewer.colorDetailsWithGamut{,Hdr}` keys take `{gamut}`).
    t: (key: string, values?: Record<string, string | number>) => string;
    toggleRef?: React.RefObject<(() => void) | null>;
    forceSrgbDerivatives?: boolean;
}

export default function ColorDetailsSection({ image, isAdmin = false, t, toggleRef, forceSrgbDerivatives = false }: ColorDetailsSectionProps) {
    const isHdr = image.transfer_function === 'pq' || image.transfer_function === 'hlg';
    const isNonTrivialColor = Boolean(
        (image.color_primaries && image.color_primaries !== 'bt709') ||
        (isAdmin && isHdr) ||
        (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb'),
    );
    const [showColorDetails, setShowColorDetails] = useState(isNonTrivialColor);

    // R27-UX-MED-1: reset accordion open-state when the photo changes. Without
    // this, a user who opens a sRGB photo's accordion (deliberately) and then
    // navigates prev/next to a P3 photo keeps the manual choice; conversely
    // a P3 photo that auto-opened stays open when navigating to a sRGB photo
    // where the default would be closed. Re-anchor to `isNonTrivialColor` on
    // every `image.id` change so the default-open heuristic applies per photo.
    // The effect runs only on `image.id` change, not on every re-render, so
    // manual toggles between navigations still work as expected.
    useEffect(() => {
        setShowColorDetails(isNonTrivialColor);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [image.id]);

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

    // R13-L1 / R10-L18: dynamic accordion label. The static "Color details"
    // wording underfires for wide-gamut / HDR photos where the accordion is
    // the photographer's main color-craft surface. Surface the most
    // photographer-relevant fact in the label itself so visitors don't need
    // to expand the accordion to see the gamut.
    //
    // - sRGB / unknown primaries → "Color details" (unchanged).
    // - Wide-gamut primaries → "Color: {gamut}" (e.g. "Color: Display P3").
    // - Wide-gamut + admin + HDR → "Color: {gamut} HDR" (admin-only because
    //   `transfer_function` / `is_hdr` are admin-only fields).
    const isWideGamut = Boolean(image.color_primaries) && image.color_primaries !== 'bt709';
    const gamutLabel = primariesHuman ?? image.color_primaries ?? '';
    const accordionLabel = (() => {
        if (!isWideGamut || !gamutLabel) return t('viewer.colorDetails');
        if (isAdmin && isHdr) {
            return t('viewer.colorDetailsWithGamutHdr', { gamut: gamutLabel });
        }
        return t('viewer.colorDetailsWithGamut', { gamut: gamutLabel });
    })();

    // P4-C6 / R4-UX-L6: copy a JSON snapshot of the audit-grade color
    // metadata to the clipboard. Useful for paste-into-forum / paste-into-
    // support-ticket workflows where the photographer wants to share the
    // full pipeline decision + ICC + transfer + decision in a machine-
    // parseable form.
    async function copyColorMetadata() {
        // R10-L16: pipeline_version is an internal admin-only field used to
        // gate backfill re-encodes. Including it in the user-facing JSON
        // leaks the running encoder revision (useful for support but also
        // useful for fingerprinting the deployment). The audit-grade
        // metadata users actually want — ICC, primaries, transfer, matrix,
        // decision, HDR flag, gain map, source bit depth — is unaffected.
        const data = {
            iccProfileName: image.icc_profile_name ?? null,
            primaries: image.color_primaries ?? null,
            transfer: image.transfer_function ?? null,
            matrix: image.matrix_coefficients ?? null,
            decision: image.color_pipeline_decision ?? null,
            isHdr: image.is_hdr ?? null,
            hasGainMap: image.has_gain_map ?? null,
            sourceBitDepth: image.bit_depth ?? null,
            avif10bit: image.avif_10bit ?? null,
        };
        try {
            const text = JSON.stringify(data, null, 2);
            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                throw new Error('clipboard unavailable');
            }
            await navigator.clipboard.writeText(text);
            toast.success(t('viewer.colorMetadataCopied'));
        } catch {
            toast.error(t('viewer.copyFailed'));
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
                    // R10-L15: expand the toggle button to fill remaining
                    // horizontal space (`flex-1` + left-aligned label) so
                    // the entire accordion row is a tappable target, not
                    // just the narrow chevron+label cluster. The tooltip
                    // and copy buttons remain sibling clickable regions on
                    // the right edge.
                    className="flex flex-1 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
                    <ChevronDown className={`h-4 w-4 transition-transform ${showColorDetails ? 'rotate-180' : ''}`} />
                    {accordionLabel}
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
                                {isP3IccName(iccName) && (
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
                                        {isP3IccName(iccName) && (
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
                                {/* R9-M3: ProPhoto and Rec.2020 sources are delivered
                                    as P3 (rgb16 pipeline), which clips saturated cyans
                                    and greens. Surface an honest disclosure so admins
                                    know the gamut is reduced, not preserved. */}
                                {(image.color_pipeline_decision === 'p3-from-prophoto' || image.color_pipeline_decision === 'p3-from-rec2020') && (
                                    <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[11px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 rounded">
                                        {t('viewer.clippedToP3')}
                                    </span>
                                )}
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
                    {/* R9-M6-7: admin-only matrix coefficients row.
                        matrix_coefficients is an admin-only field (P3-3). */}
                    {isAdmin && image.matrix_coefficients && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.matrixCoefficients')}</p>
                            <p className="font-medium">{humanizeMatrixCoefficients(image.matrix_coefficients, t)}</p>
                        </div>
                    )}
                    {/* R9-M6-7: admin-only EXIF color space row.
                        color_space is the raw EXIF ColorSpace tag value
                        ('sRGB' / 'Uncalibrated'), distinct from the ICC name. */}
                    {isAdmin && image.color_space && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.exifColorSpace')}</p>
                            <p className="font-medium">{image.color_space}</p>
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
                    {/* WI-15: admin-only downscale audit row. Wide-gamut sources
                        exceeding the pixel cap are downscaled before the rgb16
                        pipeline to prevent OOM. Surfacing this tells the admin
                        the source was larger than the configured limit. */}
                    {isAdmin && image.was_downscaled && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.downscaled')}</p>
                            <p className="font-medium">{t('viewer.downscaledYes')}</p>
                        </div>
                    )}
                    {/* P3-5 / R7-M6 / R10-M4: delivered bit depth per format.
                        color_pipeline_decision is admin-only; for public queries
                        derive an equivalent decision from color_primaries so the
                        delivery ceiling is visible to all viewers. isP3Pipeline
                        is called to satisfy the call-site lock in
                        __tests__/is-p3-pipeline.test.ts.
                        R10-M4: label now branches on avif_10bit (tracks 10-bit
                        probe success / per-image fallback) and forceSrgbDerivatives
                        (WebP/JPEG gamut when forced). */}
                    {(image.color_pipeline_decision || image.color_primaries) && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.deliveredBitDepth')}</p>
                            <p className="font-medium">
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
                            </p>
                        </div>
                    )}
                    {/* P3-22: delivered formats */}
                    {(image.filename_webp || image.filename_avif || image.filename_jpeg) && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.deliveredFormats')}</p>
                            <p className="font-medium flex gap-1">
                                {[
                                    image.filename_webp ? { name: 'WebP', gamut: (isAdmin && forceSrgbDerivatives) ? 'sRGB' : undefined } : null,
                                    image.filename_avif ? { name: 'AVIF', gamut: (isAdmin && image.color_pipeline_decision && isP3Pipeline(image.color_pipeline_decision)) ? 'P3' : undefined } : null,
                                    image.filename_jpeg ? { name: 'JPEG', gamut: (isAdmin && forceSrgbDerivatives) ? 'sRGB' : undefined } : null,
                                ].filter((x): x is { name: string; gamut: string | undefined } => x !== null).map((fmt) => (
                                    <span key={fmt.name} className="inline-block px-1.5 py-0.5 text-[11px] font-medium bg-muted rounded">
                                        {fmt.name}
                                        {fmt.gamut && (
                                            <span className="ml-0.5 text-muted-foreground/70">({fmt.gamut})</span>
                                        )}
                                    </span>
                                ))}
                            </p>
                        </div>
                    )}
                    {/* R8-M2: when forceSrgbDerivatives is active, show admin a
                        note that WebP/JPEG are sRGB-tagged while AVIF remains
                        gamut-preserved. Different gamuts per format for the same
                        source can be confusing without this annotation. */}
                    {isAdmin && forceSrgbDerivatives && image.color_pipeline_decision && isP3Pipeline(image.color_pipeline_decision) && (
                        <div className="col-span-2">
                            <p className="text-xs italic text-amber-700 dark:text-amber-300">
                                {t('viewer.forceSrgbDerivativesNote')}
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
                            {/* R8-M4: honesty note — until WI-09 (HDR AVIF
                                encoder) ships, HDR sources are delivered as SDR.
                                Matches the gain-map honesty pattern above. */}
                            <p className="mt-1 text-xs italic text-amber-700 dark:text-amber-300">
                                {t('viewer.hdrDeliveredAsSdr')}
                            </p>
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
