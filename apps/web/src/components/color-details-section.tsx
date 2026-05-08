'use client';

import { useState } from 'react';
import { Info, ChevronDown } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ImageDetail } from '@/lib/image-types';

export function humanizeColorPrimaries(value: string | null | undefined): string {
    switch (value) {
        case 'bt709': return 'BT.709';
        case 'p3-d65': return 'Display P3';
        case 'dci-p3': return 'DCI-P3';
        case 'bt2020': return 'Rec. 2020';
        case 'adobergb': return 'Adobe RGB';
        case 'prophoto': return 'ProPhoto RGB';
        default: return '';
    }
}

export function humanizeTransferFunction(value: string | null | undefined): string {
    switch (value) {
        case 'srgb': return 'sRGB';
        case 'gamma22': return 'Gamma 2.2';
        case 'gamma18': return 'Gamma 1.8';
        case 'pq': return 'PQ (ST 2084)';
        case 'hlg': return 'HLG';
        case 'linear': return 'Linear';
        default: return '';
    }
}

export function humanizeColorPipelineDecision(
    value: string | null | undefined,
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

interface ColorDetailsSectionProps {
    image: ImageDetail;
    isAdmin?: boolean;
    t: (key: string) => string;
}

export default function ColorDetailsSection({ image, isAdmin = false, t }: ColorDetailsSectionProps) {
    const isNonTrivialColor = Boolean(
        (image.color_primaries && image.color_primaries !== 'bt709') ||
        (isAdmin && image.is_hdr) ||
        (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb'),
    );
    const [showColorDetails, setShowColorDetails] = useState(isNonTrivialColor);

    const hasColorDetails = Boolean(
        image.color_primaries || image.transfer_function || image.is_hdr || (isAdmin && image.color_pipeline_decision),
    );
    if (!hasColorDetails) return null;

    const primariesHuman = humanizeColorPrimaries(image.color_primaries);
    const iccName = image.icc_profile_name || '';
    const primariesMatchIcc = primariesHuman && iccName && primariesHuman.toLowerCase() === iccName.toLowerCase();

    const colorDetailsId = `color-details-${image.id}`;

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
            </div>
            {showColorDetails && (
                <div id={colorDetailsId} className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-2 pl-6">
                    {/* B3: deduplicate ICC profile + primaries */}
                    {primariesMatchIcc ? (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                            <p className="font-medium">{iccName}</p>
                        </div>
                    ) : (
                        <>
                            {iccName && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                                    <p className="font-medium">{iccName}</p>
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
                            <p className="font-medium">{humanizeTransferFunction(image.transfer_function) || t('viewer.colorUnknown')}</p>
                        </div>
                    )}
                    {(isAdmin && image.color_pipeline_decision) && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.colorPipelineDecision')}</p>
                            <p className="font-medium">{humanizeColorPipelineDecision(image.color_pipeline_decision, t) || t('viewer.colorUnknown')}</p>
                        </div>
                    )}
                    {/* P3-5: delivered bit depth per format */}
                    {image.color_pipeline_decision && (
                        <div>
                            <p className="text-muted-foreground text-xs">{t('viewer.deliveredBitDepth')}</p>
                            <p className="font-medium">
                                {image.color_pipeline_decision.startsWith('p3')
                                    ? t('viewer.deliveredBitDepthP3')
                                    : t('viewer.deliveredBitDepthSrgb')}
                            </p>
                        </div>
                    )}
                    {image.is_hdr && (
                        <div className="col-span-2">
                            <span
                                className="hdr-badge items-center gap-1 px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-amber-300 to-orange-400 text-white shadow-sm rounded"
                                aria-label={t('viewer.hdrBadgeAriaLabel')}
                                title={t('viewer.hdrBadgeAriaLabel')}
                                role="img"
                            >
                                {t('viewer.hdrBadge')}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
