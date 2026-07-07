'use client';

import { useState, useTransition, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';
import { updateGallerySettings } from '@/app/actions/settings';
import { getSettingDefaults, normalizeConfiguredImageSizes, SLIDESHOW_INTERVAL_MIN, SLIDESHOW_INTERVAL_MAX } from '@/lib/gallery-config-shared';
import type { GallerySettingKey, SemanticSearchMode } from '@/lib/gallery-config-shared';
import { buildChangedGallerySettingsPayload } from '@/lib/settings-submit-payload';
import { SETTINGS_BACKFILL_WARNING_KEY_SET, hasBackfillRelevantDifference, resolveSavedBackfillPendingTransition } from '@/lib/settings-backfill-warning';
import { useRestoreFocusAfterPending } from '@/lib/use-restore-focus-after-pending';
import { Switch } from '@/components/ui/switch';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Save, ChevronLeft, ImageIcon, Shield, Loader2, Play, Brain, Search, RefreshCcw } from 'lucide-react';
import { getSemanticSearchSelectValue, getWritableSemanticSearchModeFromSelect, STORED_SEMANTIC_PRODUCTION_INACTIVE } from '@/lib/semantic-search-settings-ui';
import Link from 'next/link';
import { localizePath } from '@/lib/locale-path';
import { triggerBackfill, getBackfillStatus, type BackfillStatusResult } from '@/app/actions/admin-backfill';

interface SettingsClientProps {
    initialSettings: Record<string, string>;
    hasExistingImages: boolean;
    resolvedSemanticSearchMode: SemanticSearchMode;
}

const SETTINGS_FIELD_IDS: Record<string, string> = {
    image_quality_webp: 'image-quality-webp',
    image_quality_avif: 'image-quality-avif',
    image_quality_jpeg: 'image-quality-jpeg',
    image_sizes: 'image-sizes',
    wide_gamut_max_source_pixels: 'wide-gamut-max-source-pixels',
    slideshow_interval_seconds: 'slideshow-interval',
};

export function SettingsClient({ initialSettings, hasExistingImages, resolvedSemanticSearchMode }: SettingsClientProps) {
    const { t, locale } = useTranslation();
    const [isPending, startTransition] = useTransition();
    // R27-UX-HIGH-1: backfill trigger state. `isBackfilling` covers both the
    // request-in-flight window AND the small window between the server
    // confirming "queued" and the UI surfacing the toast — buttons stay
    // disabled across both so a double-click cannot fire two triggers.
    const [isBackfilling, startBackfillTransition] = useTransition();
    const defaults = getSettingDefaults();
    const [settings, setSettings] = useState<Record<string, string>>(initialSettings);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [showBackfillConfirm, setShowBackfillConfirm] = useState(false);
    const [hasSavedBackfillPending, setHasSavedBackfillPending] = useState(false);
    const backfillPendingBaselineRef = useRef<Record<string, string> | null>(null);
    // R10-M14: also keep the last-committed values in component STATE
    // (parallel to the existing `initialRef` snapshot used inside the
    // save callback) so render can compare current vs. baseline without
    // touching a ref during render (react-hooks/refs lint rule). Updated
    // alongside `initialRef.current` on successful save.
    const [baseline, setBaseline] = useState<Record<string, string>>(initialSettings);
    const initialRef = useRef<Record<string, string>>(initialSettings);
    const saveButtonRef = useRef<HTMLButtonElement>(null);
    useRestoreFocusAfterPending(saveButtonRef, isPending);

    // AGG-R5C3-04: surface the last backfill run's outcome to the admin. The
    // runner already computed encode/detection-failure counters but nothing
    // read them, so a run where every row encode-failed looked identical to a
    // clean run. Fetch the status on mount and after each trigger settles.
    const [backfillStatus, setBackfillStatus] = useState<BackfillStatusResult | null>(null);
    // AGG-R7-02 (run-7 c1): the post-trigger status polls below are scheduled
    // via setTimeout; hold their ids here so the unmount effect can clearTimeout
    // them. Without this, leaving Settings within ~10s of a backfill trigger
    // fired setBackfillStatus on an unmounted tree (the AGG-15 timer-cleanup
    // half that was prescribed but never implemented alongside the mount fix).
    const backfillPollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
    // AGG-R7-02: mounted flag so a refresh whose getBackfillStatus() promise is
    // mid-flight when the admin navigates away does not setState on a dead tree
    // (clearTimeout stops un-fired timers; this catches an already-fired one).
    const backfillMountedRef = useRef(true);
    // Imperative refresh used after a trigger settles (event-handler context, so
    // a direct setState is fine here). The mount fetch lives in the effect below
    // with its own mounted-guard so the setState is gated behind the await
    // (react-hooks/set-state-in-effect).
    const refreshBackfillStatus = useCallback(async () => {
        if (!hasExistingImages) return;
        try {
            const s = await getBackfillStatus();
            if (backfillMountedRef.current && s.ok) setBackfillStatus(s);
        } catch {
            // Non-fatal — the summary line just stays absent.
        }
    }, [hasExistingImages]);
    useEffect(() => {
        if (!hasExistingImages) return;
        let cancelled = false;
        (async () => {
            try {
                const s = await getBackfillStatus();
                if (!cancelled && s.ok) setBackfillStatus(s);
            } catch {
                // Non-fatal — the summary line just stays absent.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [hasExistingImages]);

    // AGG-R7-02 (run-7 c1): dedicated unmount cleanup for the post-trigger
    // status polls. Kept independent of the hasExistingImages-gated mount
    // effect above so the timers are ALWAYS cleared on unmount regardless of
    // that guard — a late setTimeout must never setBackfillStatus on a dead
    // tree. Empty deps → registers once, runs the cleanup only on unmount.
    useEffect(() => {
        const timers = backfillPollTimers;
        const mounted = backfillMountedRef;
        mounted.current = true;
        return () => {
            mounted.current = false;
            timers.current.forEach(clearTimeout);
            timers.current = [];
        };
    }, []);

    const handleChange = (key: string, value: string) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        setFieldErrors(prev => {
            if (!prev[key]) return prev;
            const { [key]: _cleared, ...rest } = prev;
            return rest;
        });
    };

    const validateSettings = useCallback(() => {
        const nextErrors: Record<string, string> = {};
        const addRangeError = (key: string, value: string | undefined, min: number, max: number) => {
            if (!value?.trim()) return;
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
                nextErrors[key] = t('settings.numberRangeError', { min, max });
            }
        };

        addRangeError('image_quality_webp', settings.image_quality_webp, 1, 100);
        addRangeError('image_quality_avif', settings.image_quality_avif, 1, 100);
        addRangeError('image_quality_jpeg', settings.image_quality_jpeg, 1, 100);
        addRangeError('wide_gamut_max_source_pixels', settings.wide_gamut_max_source_pixels, 10000000, 200000000);
        addRangeError('slideshow_interval_seconds', settings.slideshow_interval_seconds, SLIDESHOW_INTERVAL_MIN, SLIDESHOW_INTERVAL_MAX);
        if (!hasExistingImages && settings.image_sizes?.trim() && normalizeConfiguredImageSizes(settings.image_sizes) === null) {
            nextErrors.image_sizes = t('settings.imageSizesError');
        }
        setFieldErrors(nextErrors);
        return nextErrors;
    }, [hasExistingImages, settings.image_quality_avif, settings.image_quality_jpeg, settings.image_quality_webp, settings.image_sizes, settings.slideshow_interval_seconds, settings.wide_gamut_max_source_pixels, t]);

    const focusFirstInvalidSetting = (validationErrors: Record<string, string>) => {
        const firstKey = Object.keys(validationErrors)[0];
        const id = firstKey ? SETTINGS_FIELD_IDS[firstKey] : undefined;
        if (!id) return;
        requestAnimationFrame(() => {
            const field = document.getElementById(id);
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            field?.scrollIntoView({
                block: 'center',
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
            });
            if (field instanceof HTMLElement) {
                field.focus({ preventScroll: true });
            }
        });
    };

    // R10-M14: track whether any backfill-relevant field is dirty (current
    // value differs from the last committed baseline snapshot). The
    // amber warning above the image-processing fields surfaces only when
    // at least one such field has been edited.
    const hasDirtyBackfillField = hasBackfillRelevantDifference(settings, baseline, defaults);
    // C2-02 (run-10 c2): hasSavedBackfillPending can now also be confirmed by
    // the server's fresh DB read (see handleSave), which survives a stale
    // hasExistingImages prop — e.g. the page loaded before the gallery's
    // first photo was processed in another tab. The live/unsaved-dirty case
    // still relies on the page-load prop since there is no fresher signal
    // without a round trip on every keystroke.
    const showBackfillRequired = hasSavedBackfillPending || (hasExistingImages && hasDirtyBackfillField);

    // R27-UX-HIGH-1: Path A — fire the in-app backfill server action when
    // the photographer clicks "Re-encode existing photos". The action
    // acquires the `gallerykit_color_pipeline_backfill` advisory lock
    // non-blocking and queues a background runner; the response is
    // synchronous and reports either `queued`, `already_running`, or
    // `unavailable`. No retry on the UI — the photographer reads the toast
    // and decides what to do next.
    const runBackfill = () => {
        setShowBackfillConfirm(false);
        startBackfillTransition(async () => {
            try {
                const result = await triggerBackfill();
                if (result.ok && result.status === 'queued') {
                    if ((result.affectedRows ?? 0) === 0) {
                        toast.info(hasSavedBackfillPending
                            ? t('settings.backfillNoPipelineCandidatesSettingsOnly')
                            : t('settings.backfillNothingToDo'));
                    } else {
                        toast.success(
                            t('settings.backfillQueued', { count: String(result.affectedRows ?? 0) }),
                        );
                    }
                    // AGG-R5C3-04: the run is fire-and-forget; poll the status a
                    // few times so the last-run summary reflects the new run's
                    // outcome without a manual page reload. AGG-R7-02: track the
                    // timer ids so the unmount effect can clear them.
                    void refreshBackfillStatus();
                    backfillPollTimers.current.push(
                        setTimeout(() => void refreshBackfillStatus(), 3000),
                        setTimeout(() => void refreshBackfillStatus(), 10000),
                    );
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

    const handleBackfill = () => {
        setShowBackfillConfirm(true);
    };

    const handleSave = () => {
        const validationErrors = validateSettings();
        if (Object.keys(validationErrors).length > 0) {
            toast.error(t('settings.validationFailed'));
            focusFirstInvalidSetting(validationErrors);
            return;
        }
        startTransition(async () => {
            try {
                // Only send changed fields to reduce transaction size and conflict window
                const changed = buildChangedGallerySettingsPayload(settings, initialRef.current);
                if (Object.keys(changed).length === 0) {
                    toast.info(t('settings.noChanges'));
                    return;
                }
                const savedBackfillRelevantChange = Object.keys(changed).some((key) => SETTINGS_BACKFILL_WARNING_KEY_SET.has(key));
                const result = await updateGallerySettings(changed);
                if (result.success) {
                    const previousBaseline = initialRef.current;
                    // C1R-04: rehydrate from the server-returned normalized
                    // values (including the canonicalized image_sizes string)
                    // so the UI matches what was actually persisted.
                    const persisted = (result.settings ?? changed) as Record<string, string>;
                    const nextSettings = { ...settings, ...persisted };
                    setSettings(nextSettings);
                    initialRef.current = nextSettings;
                    setBaseline(nextSettings);
                    const backfillPending = resolveSavedBackfillPendingTransition({
                        hasExistingImages,
                        savedBackfillRelevantChange,
                        previousBaseline,
                        nextSettings,
                        pendingBaseline: backfillPendingBaselineRef.current,
                        defaults,
                    });
                    // C2-02 (run-10 c2): the action independently re-checks the
                    // byte-impacting diff against a fresh DB read and confirms at
                    // least one processed image exists, so `result.requiresBackfill`
                    // survives a stale `hasExistingImages` prop (page loaded before
                    // the gallery's first photo finished processing in another
                    // tab/session). Fold it into the same pending flag rather than
                    // re-gating it behind that prop.
                    const hasSavedBackfillPendingNext = backfillPending.hasSavedBackfillPending || result.requiresBackfill === true;
                    backfillPendingBaselineRef.current = hasSavedBackfillPendingNext
                        ? (backfillPending.pendingBaseline ?? previousBaseline)
                        : null;
                    setHasSavedBackfillPending(hasSavedBackfillPendingNext);
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
    const hasStoredSemanticProduction = settings.semantic_search_mode === 'production';
    const isSemanticProductionActive = hasStoredSemanticProduction && resolvedSemanticSearchMode === 'production';
    const semanticSearchSelectValue = getSemanticSearchSelectValue(settings.semantic_search_mode, resolvedSemanticSearchMode);
    const semanticSearchModeDescribedBy = [
        'semantic-search-mode-help',
        isSemanticProductionActive
            ? 'semantic-search-production-active'
            : hasStoredSemanticProduction ? 'semantic-search-production-warning' : null,
    ].filter(Boolean).join(' ');

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                    <Button asChild variant="ghost" size="icon" aria-label={t('aria.goBack')}>
                        <Link href={localizePath(locale, '/admin/dashboard')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <h1 className="min-w-0 text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
                </div>
                <Button ref={saveButtonRef} onClick={handleSave} disabled={isPending} className="min-h-11 gap-2 self-start sm:self-auto">
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
                    {showBackfillRequired && (
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
                            {/* AGG-R5C3-04: last-run summary. completedRuns > 0 means
                                at least one run has finished; render its outcome so a
                                fully-failed run is no longer indistinguishable from a
                                clean one. */}
                            {backfillStatus && (backfillStatus.completedRuns ?? 0) > 0 && (
                                <div role="status" className="mt-3 border-t border-blue-200/60 dark:border-blue-900/40 pt-2 text-xs text-blue-900/90 dark:text-blue-200/90 space-y-1">
                                    <strong className="block">{t('settings.backfillLastRunTitle')}</strong>
                                    {backfillStatus.lastRunNoCandidates ? (
                                        <p>
                                            {t('settings.backfillLastRunNoCandidates')}
                                        </p>
                                    ) : backfillStatus.lastRunHadFailures ? (
                                        <p className="text-amber-700 dark:text-amber-400">
                                            {/* AGG-1 (run-6 c1): render the REAL successfully-re-encoded
                                                count from the runner's mirrored `processed` counter, and
                                                surface fatal `errors` (per-row UPDATE failures). The prior
                                                code reconstructed processed by subtracting failures/skips
                                                from the pre-run candidate snapshot, which dropped `errors`
                                                entirely — a fatal-only run then read "N re-encoded, 0
                                                failures" with no error line. */}
                                            {t('settings.backfillLastRunWithFailures', {
                                                processed: String(backfillStatus.processed ?? 0),
                                                errors: String(backfillStatus.errors ?? 0),
                                                encodeFailures: String(backfillStatus.encodeFailures ?? 0),
                                                detectionFailures: String(backfillStatus.detectionFailures ?? 0),
                                            })}
                                        </p>
                                    ) : (
                                        <p>
                                            {t('settings.backfillLastRunClean', {
                                                processed: String(backfillStatus.processed ?? 0),
                                            })}
                                        </p>
                                    )}
                                    {((backfillStatus.skippedMissingOriginal ?? 0) > 0 ||
                                        (backfillStatus.skippedLocked ?? 0) > 0) && (
                                        <p>
                                            {t('settings.backfillLastRunSkips', {
                                                skippedMissingOriginal: String(backfillStatus.skippedMissingOriginal ?? 0),
                                                skippedLocked: String(backfillStatus.skippedLocked ?? 0),
                                            })}
                                        </p>
                                    )}
                                    {backfillStatus.lastRunHadFailures && backfillStatus.lastError && (
                                        <p className="text-amber-700 dark:text-amber-400 break-words">
                                            {t('settings.backfillLastRunError', { error: backfillStatus.lastError })}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <AlertDialog open={showBackfillConfirm} onOpenChange={(open) => { if (!isBackfilling) setShowBackfillConfirm(open); }}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t('settings.backfillConfirmTitle')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t('settings.backfillConfirmDesc')}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel className="min-h-11" disabled={isBackfilling}>
                                    {t('common.cancel')}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    className="min-h-11 gap-2"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        runBackfill();
                                    }}
                                    disabled={isBackfilling}
                                >
                                    {isBackfilling && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {t('settings.backfillConfirmCta')}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
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
                                aria-invalid={!!fieldErrors.image_quality_webp}
                                aria-describedby={fieldErrors.image_quality_webp ? 'image-quality-webp-error image-quality-webp-help' : 'image-quality-webp-help'}
                            />
                            {fieldErrors.image_quality_webp && (
                                <p id="image-quality-webp-error" className="text-sm text-destructive-text" role="alert">
                                    {fieldErrors.image_quality_webp}
                                </p>
                            )}
                            <p id="image-quality-webp-help" className="text-xs text-muted-foreground">{t('settings.qualityHintWebp')}</p>
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
                                aria-invalid={!!fieldErrors.image_quality_avif}
                                aria-describedby={fieldErrors.image_quality_avif ? 'image-quality-avif-error image-quality-avif-help' : 'image-quality-avif-help'}
                            />
                            {fieldErrors.image_quality_avif && (
                                <p id="image-quality-avif-error" className="text-sm text-destructive-text" role="alert">
                                    {fieldErrors.image_quality_avif}
                                </p>
                            )}
                            <p id="image-quality-avif-help" className="text-xs text-muted-foreground">{t('settings.qualityHintAvif')}</p>
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
                                aria-invalid={!!fieldErrors.image_quality_jpeg}
                                aria-describedby={fieldErrors.image_quality_jpeg ? 'image-quality-jpeg-error image-quality-jpeg-help' : 'image-quality-jpeg-help'}
                            />
                            {fieldErrors.image_quality_jpeg && (
                                <p id="image-quality-jpeg-error" className="text-sm text-destructive-text" role="alert">
                                    {fieldErrors.image_quality_jpeg}
                                </p>
                            )}
                            <p id="image-quality-jpeg-help" className="text-xs text-muted-foreground">{t('settings.qualityHintJpeg')}</p>
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
                            aria-invalid={!!fieldErrors.image_sizes}
                            aria-describedby={fieldErrors.image_sizes ? 'image-sizes-error image-sizes-help' : 'image-sizes-help'}
                        />
                        {fieldErrors.image_sizes && (
                            <p id="image-sizes-error" className="text-sm text-destructive-text" role="alert">
                                {fieldErrors.image_sizes}
                            </p>
                        )}
                        <p id="image-sizes-help" className="text-xs text-muted-foreground">
                            {hasExistingImages ? t('settings.imageSizesLockedHint') : t('settings.imageSizesHint')}
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <Label htmlFor="force-srgb-derivatives">{t('settings.forceSrgbDerivatives')}</Label>
                            <p id="force-srgb-derivatives-help" className="text-xs text-muted-foreground">
                                {t('settings.forceSrgbDerivativesHint')}
                            </p>
                        </div>
                        <Switch
                            id="force-srgb-derivatives"
                            className="shrink-0"
                            checked={settings.force_srgb_derivatives === 'true'}
                            onCheckedChange={(checked) => handleChange('force_srgb_derivatives', checked ? 'true' : 'false')}
                            aria-describedby="force-srgb-derivatives-help"
                            aria-label={t('settings.forceSrgbDerivatives')}
                        />
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <Label htmlFor="allow-hdr-ingest">{t('settings.allowHdrIngest')}</Label>
                            <p id="allow-hdr-ingest-help" className="text-xs text-muted-foreground">
                                {t('settings.allowHdrIngestHint')}
                            </p>
                        </div>
                        <Switch
                            id="allow-hdr-ingest"
                            className="shrink-0"
                            checked={settings.allow_hdr_ingest === 'true'}
                            onCheckedChange={(checked) => handleChange('allow_hdr_ingest', checked ? 'true' : 'false')}
                            aria-describedby="allow-hdr-ingest-help"
                            aria-label={t('settings.allowHdrIngest')}
                        />
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <Label htmlFor="force-show-color-chips">{t('settings.forceShowColorChips')}</Label>
                            <p id="force-show-color-chips-help" className="text-xs text-muted-foreground">
                                {t('settings.forceShowColorChipsHint')}
                            </p>
                        </div>
                        <Switch
                            id="force-show-color-chips"
                            className="shrink-0"
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
                                <SelectTrigger id="wide-gamut-jpeg-chroma" aria-describedby="wide-gamut-jpeg-chroma-help">
                                    <SelectValue placeholder={getPlaceholder('wide_gamut_jpeg_chroma')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="4:4:4">{t('settings.chroma444')}</SelectItem>
                                    <SelectItem value="4:2:2">{t('settings.chroma422')}</SelectItem>
                                    <SelectItem value="4:2:0">{t('settings.chroma420')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <p id="wide-gamut-jpeg-chroma-help" className="text-xs text-muted-foreground">{t('settings.wideGamutJpegChromaHint')}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="avif-effort">{t('settings.avifEffort')}</Label>
                            <Select
                                value={settings.avif_effort || ''}
                                onValueChange={(value) => handleChange('avif_effort', value)}
                            >
                                <SelectTrigger id="avif-effort" aria-describedby="avif-effort-help">
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
                            <p id="avif-effort-help" className="text-xs text-muted-foreground">{t('settings.avifEffortHint')}</p>
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
                                <SelectTrigger id="sdr-jpeg-chroma" aria-describedby="sdr-jpeg-chroma-help">
                                    <SelectValue placeholder={getPlaceholder('sdr_jpeg_chroma')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="4:4:4">{t('settings.chroma444')}</SelectItem>
                                    <SelectItem value="4:2:2">{t('settings.chroma422')}</SelectItem>
                                    <SelectItem value="4:2:0">{t('settings.chroma420')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <p id="sdr-jpeg-chroma-help" className="text-xs text-muted-foreground">{t('settings.sdrJpegChromaHint')}</p>
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
                                aria-invalid={!!fieldErrors.wide_gamut_max_source_pixels}
                                aria-describedby={fieldErrors.wide_gamut_max_source_pixels ? 'wide-gamut-max-source-pixels-error wide-gamut-max-source-pixels-help' : 'wide-gamut-max-source-pixels-help'}
                            />
                            {fieldErrors.wide_gamut_max_source_pixels && (
                                <p id="wide-gamut-max-source-pixels-error" className="text-sm text-destructive-text" role="alert">
                                    {fieldErrors.wide_gamut_max_source_pixels}
                                </p>
                            )}
                            <p id="wide-gamut-max-source-pixels-help" className="text-xs text-muted-foreground">{t('settings.wideGamutMaxSourcePixelsHint')}</p>
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	                        <div className="min-w-0">
	                            <Label htmlFor="strip-gps">{t('settings.stripGps')}</Label>
	                            <p id="strip-gps-help" className="text-xs text-muted-foreground">
	                                {hasExistingImages ? t('settings.uploadContractLocked') : t('settings.stripGpsHint')}
	                            </p>
	                        </div>
	                        <Switch
	                            id="strip-gps"
	                            className="shrink-0"
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
                            aria-invalid={!!fieldErrors.slideshow_interval_seconds}
                            aria-describedby={fieldErrors.slideshow_interval_seconds ? 'slideshow-interval-error slideshow-interval-help' : 'slideshow-interval-help'}
                        />
                        {fieldErrors.slideshow_interval_seconds && (
                            <p id="slideshow-interval-error" className="text-sm text-destructive-text" role="alert">
                                {fieldErrors.slideshow_interval_seconds}
                            </p>
                        )}
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <Label htmlFor="auto-alt-text-enabled">{t('settings.autoAltTextEnabled')}</Label>
                            <p id="auto-alt-text-enabled-help" className="text-xs text-muted-foreground">
                                {t('settings.autoAltTextEnabledHint')}
                            </p>
                        </div>
                        <Switch
                            id="auto-alt-text-enabled"
                            className="shrink-0"
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <Label htmlFor="semantic-search-mode">{t('settings.semanticSearchMode')}</Label>
                            <p id="semantic-search-mode-help" className="text-xs text-muted-foreground">
                                {t('settings.semanticSearchEnabledHint')}
                            </p>
                        </div>
                        <Select
                            // AGG-R5C3-13 (COR-R5C3-04): coerce the controlled value to a
                            // valid SelectItem. Operator-owned production rows render as disabled
                            // read-only states. A healed production row gets its own sentinel value
                            // so choosing real Disabled/Stub changes the raw value and persists it.
                            value={semanticSearchSelectValue}
                            onValueChange={(value) => {
                                const writableMode = getWritableSemanticSearchModeFromSelect(value);
                                if (writableMode) handleChange('semantic_search_mode', writableMode);
                            }}
                        >
                            <SelectTrigger id="semantic-search-mode" className="w-full sm:w-[240px]" aria-describedby={semanticSearchModeDescribedBy}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="disabled">{t('settings.semanticSearchModeDisabled')}</SelectItem>
                                <SelectItem value="stub">{t('settings.semanticSearchModeStub')}</SelectItem>
                                {/* AGG-C10-02 / AGG-C9-05: no user-selectable production
                                    item BY DESIGN. The real ONNX encoder is live only when
                                    OPERATOR-GATED — activatable only by an operator
                                    (SEMANTIC_SEARCH_ALLOW_PRODUCTION=true env + DB row + weights +
                                    backfill), never via this UI. The resolver heals a stored
                                    'production' to 'disabled' unless that env flag is set. */}
                                {isSemanticProductionActive && (
                                    <SelectItem value="production" disabled>
                                        {t('settings.semanticSearchModeProductionActive')}
                                    </SelectItem>
                                )}
                                {hasStoredSemanticProduction && !isSemanticProductionActive && (
                                    <SelectItem value={STORED_SEMANTIC_PRODUCTION_INACTIVE} disabled>
                                        {t('settings.semanticSearchModeProductionInactive')}
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    {isSemanticProductionActive ? (
                        <p id="semantic-search-production-active" className="text-xs text-emerald-700 dark:text-emerald-400 font-medium" role="status">
                            {t('settings.semanticSearchProductionActive')}
                        </p>
                    ) : hasStoredSemanticProduction && (
                        <p id="semantic-search-production-warning" className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                            {t('settings.semanticSearchProductionWarning')}
                        </p>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-end border-t pt-4">
                <Button type="button" onClick={handleSave} disabled={isPending} className="min-h-11 gap-2">
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isPending ? t('settings.saving') : t('settings.save')}
                </Button>
            </div>
        </div>
    );
}
