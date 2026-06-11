'use client';

import { useState, useTransition, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { updateGallerySettings } from '@/app/actions/settings';
import { getSettingDefaults, normalizeConfiguredImageSizes } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Save, ChevronLeft, ImageIcon, Shield, Loader2, Play, Brain, Search, ShoppingCart, RefreshCcw } from 'lucide-react';
import { SLIDESHOW_INTERVAL_MIN, SLIDESHOW_INTERVAL_MAX } from '@/lib/gallery-config-shared';
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';
import { triggerBackfill } from '@/app/actions/admin-backfill';

interface SettingsClientProps {
    initialSettings: Record<string, string>;
    hasExistingImages: boolean;
}

// R10-M14: settings keys whose change actually requires re-running the
// color-pipeline backfill so existing photo derivatives reflect the new
// encoder behavior. Changing e.g. the slideshow interval or the
// quality settings doesn't change color-pipeline output, so the
// backfill warning should NOT fire on those edits. Without this gate
// admins learn to ignore the amber banner because it shows on every
// edit, and then miss it when it actually matters.
const COLOR_HDR_BACKFILL_KEYS = new Set<string>([
    'force_srgb_derivatives',
    'allow_hdr_ingest',
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'wide_gamut_max_source_pixels',
    // image quality settings DO change the rendered bytes for existing
    // photos, so include them — they're not strictly color but the
    // photographer-visible "this edit needs a backfill to take effect on
    // already-uploaded photos" framing applies the same way.
    'image_quality_webp',
    'image_quality_avif',
    'image_quality_jpeg',
]);

export function SettingsClient({ initialSettings, hasExistingImages }: SettingsClientProps) {
    const { t, locale } = useTranslation();
    const [isPending, startTransition] = useTransition();
    // R27-UX-HIGH-1: backfill trigger state. `isBackfilling` covers both the
    // request-in-flight window AND the small window between the server
    // confirming "queued" and the UI surfacing the toast — buttons stay
    // disabled across both so a double-click cannot fire two triggers.
    const [isBackfilling, startBackfillTransition] = useTransition();
    const defaults = getSettingDefaults();
    const [settings, setSettings] = useState<Record<string, string>>(initialSettings);
    // R10-M14: also keep the last-committed values in component STATE
    // (parallel to the existing `initialRef` snapshot used inside the
    // save callback) so render can compare current vs. baseline without
    // touching a ref during render (react-hooks/refs lint rule). Updated
    // alongside `initialRef.current` on successful save.
    const [baseline, setBaseline] = useState<Record<string, string>>(initialSettings);
    const initialRef = useRef<Record<string, string>>(initialSettings);

    const handleChange = (key: string, value: string) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    // R10-M14: track whether any backfill-relevant field is dirty (current
    // value differs from the last committed baseline snapshot). The
    // amber warning above the image-processing fields surfaces only when
    // at least one such field has been edited.
    const hasDirtyBackfillField = Array.from(COLOR_HDR_BACKFILL_KEYS).some(
        (key) => (settings[key] ?? '') !== (baseline[key] ?? ''),
    );

    // R27-UX-HIGH-1: Path A — fire the in-app backfill server action when
    // the photographer clicks "Re-encode existing photos". The action
    // acquires the `gallerykit_color_pipeline_backfill` advisory lock
    // non-blocking and queues a background runner; the response is
    // synchronous and reports either `queued`, `already_running`, or
    // `unavailable`. No retry on the UI — the photographer reads the toast
    // and decides what to do next.
    const handleBackfill = () => {
        startBackfillTransition(async () => {
            try {
                const result = await triggerBackfill();
                if (result.ok && result.status === 'queued') {
                    if ((result.affectedRows ?? 0) === 0) {
                        toast.info(t('settings.backfillNothingToDo'));
                    } else {
                        toast.success(
                            t('settings.backfillQueued', { count: String(result.affectedRows ?? 0) }),
                        );
                    }
                } else if (result.status === 'already_running') {
                    toast.info(t('settings.backfillAlreadyRunning'));
                } else if (result.status === 'unavailable') {
                    toast.error(result.error || t('settings.backfillUnavailable'));
                } else {
                    toast.error(result.error || t('settings.backfillFailed'));
                }
            } catch {
                toast.error(t('settings.backfillFailed'));
            }
        });
    };

    const handleSave = () => {
        startTransition(async () => {
            try {
                // Only send changed fields to reduce transaction size and conflict window
                const changed = Object.fromEntries(
                    Object.entries(settings)
                        .map(([key, value]) => {
                            if (key === 'image_sizes' && value.trim()) {
                                return [key, normalizeConfiguredImageSizes(value) ?? value] as const;
                            }
                            return [key, value] as const;
                        })
                        .filter(([k, v]) => v !== initialRef.current[k])
                );
                if (Object.keys(changed).length === 0) {
                    toast.info(t('settings.noChanges'));
                    return;
                }
                const result = await updateGallerySettings(changed);
                if (result.success) {
                    // C1R-04: rehydrate from the server-returned normalized
                    // values (including the canonicalized image_sizes string)
                    // so the UI matches what was actually persisted.
                    const persisted = (result.settings ?? changed) as Record<string, string>;
                    const nextSettings = { ...settings, ...persisted };
                    setSettings(nextSettings);
                    initialRef.current = nextSettings;
                    setBaseline(nextSettings);
                    toast.success(t('settings.saveSuccess'));
                } else {
                    toast.error(result.error || t('settings.saveFailed'));
                }
            } catch {
                toast.error(t('settings.saveFailed'));
            }
        });
    };

    const getPlaceholder = (key: string) => defaults[key as GallerySettingKey] || '';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button asChild variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                        <Link href={localizePath(locale, '/admin/dashboard')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
                </div>
                <Button onClick={handleSave} disabled={isPending} className="gap-2">
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isPending ? t('settings.saving') : t('settings.save')}
                </Button>
            </div>

            {/* Image Processing */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ImageIcon className="h-5 w-5" />
                        {t('settings.imageProcessingTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.imageProcessingDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {hasExistingImages && hasDirtyBackfillField && (
                        /* DES-R4C16-05: role="status" (polite live region) — this
                           banner appears dynamically when a color-impacting field
                           goes dirty; without it a screen-reader admin edits
                           avif_effort and never learns existing photos now need a
                           re-encode. Advisory, not blocking → status, not alert. */
                        <div role="status" className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                            <strong>{t('settings.backfillRequired')}</strong>
                            {' '}
                            {t('settings.backfillRequiredHint')}
                        </div>
                    )}
                    {/* R27-UX-HIGH-1: in-app backfill trigger. Visible
                        whenever the gallery has photos so the photographer
                        can re-encode after a manual `IMAGE_PIPELINE_VERSION`
                        bump or after admin-tunable color settings change.
                        The button is independent of `hasDirtyBackfillField`
                        so an admin can also re-run the backfill without
                        first dirtying the form (the canonical scenario:
                        deployed a pipeline version bump, want to apply it
                        on the live host without ssh + sidecar). */}
                    {hasExistingImages && (
                        <div className="rounded-md border border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20 p-3 text-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="space-y-1 text-blue-900 dark:text-blue-200">
                                    <strong>{t('settings.backfillTriggerTitle')}</strong>
                                    <p className="text-xs text-blue-800/80 dark:text-blue-200/80">
                                        {t('settings.backfillTriggerHint')}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleBackfill}
                                    disabled={isBackfilling}
                                    className="gap-2 self-start h-11"
                                >
                                    {isBackfilling
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <RefreshCcw className="h-4 w-4" />}
                                    {isBackfilling
                                        ? t('settings.backfillRunning')
                                        : t('settings.backfillTriggerCta')}
                                </Button>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="image-quality-webp">{t('settings.webpQuality')}</Label>
                            <Input
                                id="image-quality-webp"
                                type="number"
                                min={1}
                                max={100}
                                value={settings.image_quality_webp || ''}
                                onChange={(e) => handleChange('image_quality_webp', e.target.value)}
                                placeholder={getPlaceholder('image_quality_webp')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.qualityHintWebp')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image-quality-avif">{t('settings.avifQuality')}</Label>
                            <Input
                                id="image-quality-avif"
                                type="number"
                                min={1}
                                max={100}
                                value={settings.image_quality_avif || ''}
                                onChange={(e) => handleChange('image_quality_avif', e.target.value)}
                                placeholder={getPlaceholder('image_quality_avif')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.qualityHintAvif')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image-quality-jpeg">{t('settings.jpegQuality')}</Label>
                            <Input
                                id="image-quality-jpeg"
                                type="number"
                                min={1}
                                max={100}
                                value={settings.image_quality_jpeg || ''}
                                onChange={(e) => handleChange('image_quality_jpeg', e.target.value)}
                                placeholder={getPlaceholder('image_quality_jpeg')}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.qualityHintJpeg')}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="image-sizes">{t('settings.imageSizes')}</Label>
                        <Input
                            id="image-sizes"
                            value={settings.image_sizes || ''}
                            onChange={(e) => handleChange('image_sizes', e.target.value)}
                            placeholder={getPlaceholder('image_sizes')}
                            pattern="[0-9]+(\s*,\s*[0-9]+)*"
                            disabled={hasExistingImages}
                            aria-describedby="image-sizes-help"
                        />
                        <p id="image-sizes-help" className="text-xs text-muted-foreground">
                            {hasExistingImages ? t('settings.imageSizesLockedHint') : t('settings.imageSizesHint')}
                        </p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="force-srgb-derivatives">{t('settings.forceSrgbDerivatives')}</Label>
                            <p id="force-srgb-derivatives-help" className="text-xs text-muted-foreground">
                                {t('settings.forceSrgbDerivativesHint')}
                            </p>
                        </div>
                        <Switch
                            id="force-srgb-derivatives"
                            checked={settings.force_srgb_derivatives === 'true'}
                            onCheckedChange={(checked) => handleChange('force_srgb_derivatives', checked ? 'true' : 'false')}
                            aria-describedby="force-srgb-derivatives-help"
                            aria-label={t('settings.forceSrgbDerivatives')}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="allow-hdr-ingest">{t('settings.allowHdrIngest')}</Label>
                            <p id="allow-hdr-ingest-help" className="text-xs text-muted-foreground">
                                {t('settings.allowHdrIngestHint')}
                            </p>
                        </div>
                        <Switch
                            id="allow-hdr-ingest"
                            checked={settings.allow_hdr_ingest === 'true'}
                            onCheckedChange={(checked) => handleChange('allow_hdr_ingest', checked ? 'true' : 'false')}
                            aria-describedby="allow-hdr-ingest-help"
                            aria-label={t('settings.allowHdrIngest')}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="force-show-color-chips">{t('settings.forceShowColorChips')}</Label>
                            <p id="force-show-color-chips-help" className="text-xs text-muted-foreground">
                                {t('settings.forceShowColorChipsHint')}
                            </p>
                        </div>
                        <Switch
                            id="force-show-color-chips"
                            checked={settings.force_show_color_chips === 'true'}
                            onCheckedChange={(checked) => handleChange('force_show_color_chips', checked ? 'true' : 'false')}
                            aria-describedby="force-show-color-chips-help"
                            aria-label={t('settings.forceShowColorChips')}
                        />
                    </div>

                    {/* R10-H4: Firefox display detection gap — informational note for admins */}
                    <div className="rounded-md border border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20 p-3 text-sm text-blue-800 dark:text-blue-300">
                        <strong>{t('settings.firefoxDisplayGapNote')}</strong>
                        {' '}
                        {t('settings.firefoxDisplayGapNoteDetail')}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="wide-gamut-jpeg-chroma">{t('settings.wideGamutJpegChroma')}</Label>
                            <Select
                                value={settings.wide_gamut_jpeg_chroma || ''}
                                onValueChange={(value) => handleChange('wide_gamut_jpeg_chroma', value)}
                            >
                                <SelectTrigger id="wide-gamut-jpeg-chroma">
                                    <SelectValue placeholder={getPlaceholder('wide_gamut_jpeg_chroma')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="4:4:4">{t('settings.chroma444')}</SelectItem>
                                    <SelectItem value="4:2:2">{t('settings.chroma422')}</SelectItem>
                                    <SelectItem value="4:2:0">{t('settings.chroma420')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">{t('settings.wideGamutJpegChromaHint')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="avif-effort">{t('settings.avifEffort')}</Label>
                            <Select
                                value={settings.avif_effort || ''}
                                onValueChange={(value) => handleChange('avif_effort', value)}
                            >
                                <SelectTrigger id="avif-effort">
                                    <SelectValue placeholder={getPlaceholder('avif_effort')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* R28-CP-LOW-1: full 0-9 range matches Sharp's actual
                                        capability. Sharp's native default is 4; we ship 6 as
                                        the product default for ~10% smaller files at the cost
                                        of ~30% extra CPU. Admins on high-volume ingest can
                                        drop to 0-3 for faster encoding. */}
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((effort) => (
                                        <SelectItem key={effort} value={String(effort)}>{effort}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">{t('settings.avifEffortHint')}</p>
                        </div>
                    </div>

                    {/* C2-A5 / C2-COL-MED-2 + C2-A6 / C2-INT-MED-1 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="sdr-jpeg-chroma">{t('settings.sdrJpegChroma')}</Label>
                            <Select
                                value={settings.sdr_jpeg_chroma || ''}
                                onValueChange={(value) => handleChange('sdr_jpeg_chroma', value)}
                            >
                                <SelectTrigger id="sdr-jpeg-chroma">
                                    <SelectValue placeholder={getPlaceholder('sdr_jpeg_chroma')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="4:4:4">{t('settings.chroma444')}</SelectItem>
                                    <SelectItem value="4:2:2">{t('settings.chroma422')}</SelectItem>
                                    <SelectItem value="4:2:0">{t('settings.chroma420')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">{t('settings.sdrJpegChromaHint')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="wide-gamut-max-source-pixels">{t('settings.wideGamutMaxSourcePixels')}</Label>
                            <Input
                                id="wide-gamut-max-source-pixels"
                                type="number"
                                inputMode="numeric"
                                min={10000000}
                                max={200000000}
                                step={1000000}
                                value={settings.wide_gamut_max_source_pixels || ''}
                                placeholder={getPlaceholder('wide_gamut_max_source_pixels')}
                                onChange={(e) => handleChange('wide_gamut_max_source_pixels', e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.wideGamutMaxSourcePixelsHint')}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Privacy */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        {t('settings.privacyTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.privacyDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
	                        <div>
	                            <Label htmlFor="strip-gps">{t('settings.stripGps')}</Label>
	                            <p id="strip-gps-help" className="text-xs text-muted-foreground">
	                                {hasExistingImages ? t('settings.uploadContractLocked') : t('settings.stripGpsHint')}
	                            </p>
	                        </div>
	                        <Switch
	                            id="strip-gps"
	                            checked={settings.strip_gps_on_upload === 'true'}
	                            onCheckedChange={(checked) => handleChange('strip_gps_on_upload', checked ? 'true' : 'false')}
	                            disabled={hasExistingImages}
	                            aria-describedby="strip-gps-help"
	                            aria-label={t('settings.stripGps')}
	                        />
                    </div>
                    {hasExistingImages && (
                        <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                            {t('settings.uploadContractLocked')}
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Slideshow */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Play className="h-5 w-5" />
                        {t('settings.slideshowTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.slideshowDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="slideshow-interval">{t('settings.slideshowInterval')}</Label>
                        <Input
                            id="slideshow-interval"
                            type="number"
                            min={SLIDESHOW_INTERVAL_MIN}
                            max={SLIDESHOW_INTERVAL_MAX}
                            value={settings.slideshow_interval_seconds || ''}
                            onChange={(e) => handleChange('slideshow_interval_seconds', e.target.value)}
                            placeholder={getPlaceholder('slideshow_interval_seconds')}
                            aria-describedby="slideshow-interval-help"
                        />
                        <p id="slideshow-interval-help" className="text-xs text-muted-foreground">{t('settings.slideshowIntervalHint')}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Auto Alt-Text */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5" />
                        {t('settings.autoAltTextTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.autoAltTextDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="auto-alt-text-enabled">{t('settings.autoAltTextEnabled')}</Label>
                            <p id="auto-alt-text-enabled-help" className="text-xs text-muted-foreground">
                                {t('settings.autoAltTextEnabledHint')}
                            </p>
                        </div>
                        <Switch
                            id="auto-alt-text-enabled"
                            checked={settings.auto_alt_text_enabled === 'true'}
                            onCheckedChange={(checked) => handleChange('auto_alt_text_enabled', checked ? 'true' : 'false')}
                            aria-describedby="auto-alt-text-enabled-help"
                            aria-label={t('settings.autoAltTextEnabled')}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Semantic Search */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Search className="h-5 w-5" />
                        {t('settings.semanticSearchTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.semanticSearchDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="semantic-search-mode">{t('settings.semanticSearchMode')}</Label>
                            <p id="semantic-search-mode-help" className="text-xs text-muted-foreground">
                                {t('settings.semanticSearchEnabledHint')}
                            </p>
                        </div>
                        <Select
                            value={settings.semantic_search_mode || 'disabled'}
                            onValueChange={(value) => handleChange('semantic_search_mode', value)}
                        >
                            <SelectTrigger id="semantic-search-mode" className="w-[200px]" aria-describedby="semantic-search-mode-help">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="disabled">{t('settings.semanticSearchModeDisabled')}</SelectItem>
                                <SelectItem value="stub">{t('settings.semanticSearchModeStub')}</SelectItem>
                                {/* CRT-R5C1-01: 'production' hidden until real ONNX encoder ships.
                                    i18n key kept for forward compatibility. */}
                            </SelectContent>
                        </Select>
                    </div>
                    {settings.semantic_search_mode === 'production' && (
                        <p className="text-xs text-amber-600 font-medium">
                            {t('settings.semanticSearchProductionWarning')}
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* License Pricing */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5" />
                        {t('settings.licensePricingTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.licensePricingDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="license-price-editorial">{t('settings.licensePriceEditorial')}</Label>
                            <Input
                                id="license-price-editorial"
                                type="number"
                                min={0}
                                step={1}
                                value={settings.license_price_editorial_cents || ''}
                                onChange={(e) => handleChange('license_price_editorial_cents', e.target.value)}
                                placeholder={getPlaceholder('license_price_editorial_cents')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="license-price-commercial">{t('settings.licensePriceCommercial')}</Label>
                            <Input
                                id="license-price-commercial"
                                type="number"
                                min={0}
                                step={1}
                                value={settings.license_price_commercial_cents || ''}
                                onChange={(e) => handleChange('license_price_commercial_cents', e.target.value)}
                                placeholder={getPlaceholder('license_price_commercial_cents')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="license-price-rm">{t('settings.licensePriceRm')}</Label>
                            <Input
                                id="license-price-rm"
                                type="number"
                                min={0}
                                step={1}
                                value={settings.license_price_rm_cents || ''}
                                onChange={(e) => handleChange('license_price_rm_cents', e.target.value)}
                                placeholder={getPlaceholder('license_price_rm_cents')}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('settings.licensePriceHint')}</p>
                </CardContent>
            </Card>
        </div>
    );
}
