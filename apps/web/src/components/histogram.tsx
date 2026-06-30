'use client';

import { useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import { useDisplayCapability } from '@/lib/use-display-capability';
import { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

type HistogramMode = 'luminance' | 'rgb' | 'r' | 'g' | 'b';

interface HistogramData {
    r: number[];
    g: number[];
    b: number[];
    l: number[];
}

interface HistogramWorkerPayload {
    imageData: ArrayBuffer;
    width: number;
    height: number;
    colorSpace?: 'srgb' | 'display-p3';
}

interface HistogramWorkerResponse {
    requestId?: number;
    histogram?: HistogramData;
    r?: number[];
    g?: number[];
    b?: number[];
    l?: number[];
}

interface HistogramWorkerLike {
    addEventListener(type: 'message', listener: (event: MessageEvent<HistogramWorkerResponse>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<HistogramWorkerResponse>) => void): void;
    postMessage(message: { requestId: number } & HistogramWorkerPayload, transfer?: Transferable[]): void;
}

// C3-A4 / C3-COL-LOW-2 / C3-DEBUG-LOW-1: shared module-scope Promise so the
// first-render flicker is removed (the component awaits the resolution and
// renders with the correct probe result on first paint).
// R4C8 COR-R4C8-02: the probe (and its data-URL constant) now live in
// lib/avif-support.ts — the previous in-file constant was structurally
// invalid ISOBMFF and failed to decode in every browser, permanently
// disabling the AVIF histogram path. Re-exported for back-compat with
// existing imports.
export { getAvifSupportPromise } from '@/lib/avif-support';
import { getAvifSupportPromise } from '@/lib/avif-support';

// C1: cache Canvas-P3 probe at module scope (singleton, runs once per process).
// Note: the prior synchronous getAvifSupported() helper has been replaced by
// the Promise-singleton getAvifSupportPromise() above (C3-A4).

let _cachedSupportsCanvasP3: boolean | null = null;

function getSupportsCanvasP3(): boolean {
    if (_cachedSupportsCanvasP3 !== null) return _cachedSupportsCanvasP3;
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' as PredefinedColorSpace });
        _cachedSupportsCanvasP3 = ctx !== null && ctx.getContextAttributes().colorSpace === 'display-p3';
    } catch {
        _cachedSupportsCanvasP3 = false;
    }
    return _cachedSupportsCanvasP3;
}

// R15-L3 / R11-L2: hoist the P3 context options literal to module scope so
// `computeHistogramAsync` does not re-allocate the object on every call. The
// histogram recomputes on photo-change / format-change / window-resize; the
// allocation cost is trivial, but the bigger win is that the call site now
// reads as a declarative branch between two named configurations rather than
// a runtime literal construction. The corresponding sRGB branch is `undefined`
// (default context) and stays inline since there's no allocation to hoist.
const P3_CTX_OPTIONS: CanvasRenderingContext2DSettings = {
    colorSpace: 'display-p3' as PredefinedColorSpace,
};

interface HistogramProps {
    /**
     * R7-M7: callers MUST pass a sized variant URL (e.g. `_640.jpg`) not the
     * base/full-resolution filename. The component loads the image into an
     * `<img>` before drawing to a 256-px canvas; a base-size URL would decode
     * the full-resolution source into GPU texture memory and could OOM on
     * mobile. The priority chain (AVIF → sized JPEG → fallback) is documented
     * on the `fallbackImageUrl` prop below.
     */
    imageUrl: string;
    /**
     * R7-M7: sized AVIF variant for wide-gamut sources on P3-capable browsers.
     * Same sized-variant contract as `imageUrl`.
     */
    avifUrl?: string;
    /**
     * Optional last-resort URL when the sized derivative (640 px JPEG / AVIF)
     * 404s — typically the base filename (largest configured size, the only
     * variant the encoder guarantees via the atomic-rename pattern in
     * `process-image.ts`). Photos uploaded before the current `imageSizes`
     * config may be missing the 640 px sized variant; the fallback ensures
     * the histogram still renders (at the cost of a slightly larger
     * download — the histogram canvas down-scales to 256 px regardless).
     */
    fallbackImageUrl?: string;
    colorPrimaries?: string | null;
    className?: string;
    cycleModeRef?: React.RefObject<(() => void) | null>;
}

const MODE_CYCLE: HistogramMode[] = ['luminance', 'rgb', 'r', 'g', 'b'];
let nextHistogramRequestId = 0;

function toHistogramData(eventData: HistogramWorkerResponse): HistogramData {
    if (eventData.histogram) {
        return eventData.histogram;
    }

    return {
        r: eventData.r ?? new Array(256).fill(0),
        g: eventData.g ?? new Array(256).fill(0),
        b: eventData.b ?? new Array(256).fill(0),
        l: eventData.l ?? new Array(256).fill(0),
    };
}

export function requestHistogramFromWorker(
    worker: HistogramWorkerLike,
    payload: HistogramWorkerPayload,
    signal?: AbortSignal,
): Promise<HistogramData> {
    const requestId = ++nextHistogramRequestId;

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            worker.removeEventListener('message', handleMessage);
            signal?.removeEventListener('abort', handleAbort);
        };

        const handleMessage = (e: MessageEvent<HistogramWorkerResponse>) => {
            if (e.data?.requestId !== requestId) {
                return;
            }

            cleanup();
            resolve(toHistogramData(e.data));
        };

        const handleAbort = () => {
            cleanup();
            reject(new DOMException('Histogram request aborted', 'AbortError'));
        };

        worker.addEventListener('message', handleMessage);
        if (signal) {
            if (signal.aborted) {
                handleAbort();
                return;
            }
            signal.addEventListener('abort', handleAbort, { once: true });
        }

        worker.postMessage({ requestId, ...payload }, [payload.imageData]);
    });
}

/**
 * Extract pixel data from an image on the main thread (canvas required),
 * then post the raw buffer to a Web Worker for the O(n) histogram computation.
 */
function computeHistogramAsync(
    imageEl: HTMLImageElement,
    worker: Worker,
    colorPrimaries: string | null | undefined,
    signal?: AbortSignal,
): Promise<HistogramData> {
    const canvas = document.createElement('canvas');
    const maxDim = 256;
    const scale = Math.min(maxDim / imageEl.naturalWidth, maxDim / imageEl.naturalHeight, 1);
    const w = Math.round(imageEl.naturalWidth * scale);
    const h = Math.round(imageEl.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    // R6-M2: only request a Display-P3 2D context when the image itself is
    // wide-gamut AND the display supports P3. For sRGB images, the default
    // sRGB context preserves true source data and keeps BT.709 luminance
    // coefficients correct in the worker.
    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    // R29-MED-1: this DOM read is non-reactive on purpose. The
    // `force_show_color_chips` admin toggle is a demo-mode escape hatch,
    // not a runtime-tunable knob, so we sample it at canvas-build time
    // rather than wiring a MutationObserver onto `<html>` for the
    // attribute. Concretely: if the admin flips the setting while a photo
    // viewer is open, this histogram will keep using the OLD `supportsP3`
    // decision (sRGB vs P3 canvas context) until the component remounts —
    // which happens on the next photo navigation. Documented so a future
    // reader doesn't "fix" this by adding subscription machinery for a
    // toggle that's flipped once-per-session at most.
    const forceShowColorChips =
        typeof document !== 'undefined' &&
        document.documentElement.getAttribute('data-force-show-color-chips') === 'true';
    const supportsP3 = forceShowColorChips || getSupportsCanvasP3();
    // R15-L3 / R11-L2: reuse the module-scope P3_CTX_OPTIONS constant rather
    // than allocating a fresh `{ colorSpace: 'display-p3' }` literal per call.
    const ctxOptions: CanvasRenderingContext2DSettings | undefined =
        isWideGamut && supportsP3 ? P3_CTX_OPTIONS : undefined;
    const ctx = canvas.getContext('2d', ctxOptions);
    if (!ctx) {
        return Promise.resolve({
            r: new Array(256).fill(0),
            g: new Array(256).fill(0),
            b: new Array(256).fill(0),
            l: new Array(256).fill(0),
        });
    }
    ctx.drawImage(imageEl, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const canvasColorSpace = ctx.getContextAttributes().colorSpace as 'srgb' | 'display-p3';

    return requestHistogramFromWorker(worker, {
        imageData: imageData.data.buffer,
        width: w,
        height: h,
        colorSpace: canvasColorSpace,
    }, signal);
}

function drawHistogram(
    canvas: HTMLCanvasElement,
    data: HistogramData,
    mode: HistogramMode,
    isDark: boolean
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    const gridColor = isDark ? '#404040' : '#d4d4d4';

    const drawChannel = (
        bins: number[],
        color: string,
        alpha: number
    ) => {
        const max = bins.reduce((m, v) => v > m ? v : m, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * W;
            const y = H - (bins[i] / max) * H;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    };

    if (mode === 'luminance') {
        drawChannel(data.l, gridColor, 1.0);
    } else if (mode === 'rgb') {
        // Normalize all three channels to their shared maximum for overlay
        const maxAll = [...data.r, ...data.g, ...data.b].reduce((m, v) => v > m ? v : m, 1);
        const drawChannelNormalized = (bins: number[], color: string) => {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (let i = 0; i < 256; i++) {
                const x = (i / 255) * W;
                const y = H - (bins[i] / maxAll) * H;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        };
        drawChannelNormalized(data.r, '#ef4444');
        drawChannelNormalized(data.g, '#22c55e');
        drawChannelNormalized(data.b, '#3b82f6');
    } else if (mode === 'r') {
        drawChannel(data.r, '#ef4444', 1.0);
    } else if (mode === 'g') {
        drawChannel(data.g, '#22c55e', 1.0);
    } else if (mode === 'b') {
        drawChannel(data.b, '#3b82f6', 1.0);
    }

    // P3-9: grid lines at 0/64/128/192/255
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    const gridPositions = [0, 64, 128, 192, 255];
    for (const pos of gridPositions) {
        const x = (pos / 255) * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }
    ctx.restore();

    // P3-9: red clip blink strips when shadow/highlight bins exceed 0.5%
    // R5-H3: RGB mode checks the worst-case channel (max of r/g/b at 0
    // and 255) so per-channel clipping is visible, not just luminance.
    const CLIP_THRESHOLD = 0.005;
    let clipBins: number[];
    let belowBlack = 0;
    let aboveWhite = 0;
    let total = 0;
    if (mode === 'rgb') {
        const totals = [data.r, data.g, data.b].map((ch) => ch.reduce((s, v) => s + v, 0));
        total = totals[0];
        belowBlack = Math.max(data.r[0], data.g[0], data.b[0]);
        aboveWhite = Math.max(data.r[255], data.g[255], data.b[255]);
        if (total > 0) {
            belowBlack /= total;
            aboveWhite /= total;
        }
    } else {
        clipBins = mode === 'luminance' ? data.l : mode === 'r' ? data.r : mode === 'g' ? data.g : mode === 'b' ? data.b : data.l;
        total = clipBins.reduce((sum, v) => sum + v, 0);
        if (total > 0) {
            belowBlack = clipBins[0] / total;
            aboveWhite = clipBins[255] / total;
        }
    }
    if (total > 0 && (belowBlack > CLIP_THRESHOLD || aboveWhite > CLIP_THRESHOLD)) {
        ctx.save();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'; // red-500 at 35% opacity
        if (belowBlack > CLIP_THRESHOLD) {
            ctx.fillRect(0, 0, 3, H);
        }
        if (aboveWhite > CLIP_THRESHOLD) {
            ctx.fillRect(W - 3, 0, 3, H);
        }
        ctx.restore();
    }
}

function percentileFromHistogram(bins: number[], p: number): number {
    const total = bins.reduce((sum, v) => sum + v, 0);
    if (total === 0) return 128;
    const target = (total * p) / 100;
    let cumsum = 0;
    for (let i = 0; i < bins.length; i++) {
        cumsum += bins[i];
        if (cumsum >= target) return i;
    }
    return bins.length - 1;
}

/**
 * R27-HD-MED-1: derive the histogram source label from the URL the worker
 * actually loaded, not the priority intent. When the AVIF candidate 404s
 * and the resolver falls back to a sized/base JPEG, the label must read
 * "JPEG" so a photographer auditing the histogram doesn't misread the
 * source-of-truth.
 *
 * Returns 'AVIF' when effectiveUrl matches the AVIF candidate, 'JPEG' for
 * any other non-null URL (sized JPEG or base fallback), or null when there
 * is no URL to load from.
 */
export function resolveHistogramSourceLabel(
    effectiveUrl: string | null,
    avifUrl: string | undefined,
): 'AVIF' | 'JPEG' | null {
    if (!effectiveUrl) return null;
    if (avifUrl && effectiveUrl === avifUrl) return 'AVIF';
    return 'JPEG';
}

/**
 * R27-HD-MED-1: derive the "(sRGB clipped)" hint. Fires when the photo is
 * wide-gamut AND either (a) the visitor's display is sRGB, OR (b) the AVIF
 * source was preferred but the candidate fell through to the sized/base
 * JPEG — those JPEGs are sRGB-clipped on a P3 display.
 */
export function resolveIsClipped(opts: {
    isWideGamut: boolean;
    colorGamut: 'srgb' | 'p3' | 'rec2020' | 'unknown' | string;
    preferAvif: boolean;
    effectiveUrl: string | null;
    avifUrl: string | undefined;
}): boolean {
    if (!opts.isWideGamut) return false;
    if (opts.colorGamut === 'srgb') return true;
    if (opts.preferAvif && opts.effectiveUrl !== opts.avifUrl) return true;
    return false;
}

export function estimateKeyType(data: HistogramData): 'high-key' | 'low-key' | 'balanced' {
    const total = data.l.reduce((sum, v) => sum + v, 0);
    if (total === 0) return 'balanced';
    // R10-M4: percentile-based classification replaces naive average.
    // high-key: brightest 10% of pixels are very bright AND darkest 10%
    // are also bright (no deep shadows). low-key: darkest 10% are very
    // dark AND brightest 10% are not blown out. Everything else = balanced.
    const p10 = percentileFromHistogram(data.l, 10);
    const p90 = percentileFromHistogram(data.l, 90);
    if (p90 > 220 && p10 > 100) return 'high-key';
    if (p10 < 40 && p90 < 180) return 'low-key';
    return 'balanced';
}

function getGamutLabel(primaries: string | null | undefined, t: (key: string) => string): string {
    switch (primaries) {
        case 'p3-d65': return t('viewer.histogramGamutP3');
        case 'dci-p3': return t('viewer.histogramGamutDciP3');
        case 'bt2020': return t('viewer.histogramGamutRec2020');
        case 'adobergb': return t('viewer.histogramGamutAdobeRgb');
        case 'prophoto': return t('viewer.histogramGamutProPhoto');
        case 'bt709': return t('viewer.histogramGamutSrgb');
        default: return '';
    }
}

export function Histogram({ imageUrl, avifUrl, fallbackImageUrl, colorPrimaries, className, cycleModeRef }: HistogramProps) {
    const { t } = useTranslation();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [histogramState, setHistogramState] = useState<{ imageUrl: string | null; data: HistogramData | null }>({
        imageUrl: null,
        data: null,
    });
    const [mode, setMode] = useState<HistogramMode>('luminance');
    const [collapsed, setCollapsed] = useState(false);
    // R9-M9: higher-resolution histogram on desktop viewports.
    const [canvasDims, setCanvasDims] = useState({ width: 240, height: 120 });
    useEffect(() => {
        // R15C15 PERF-15-02: rAF-debounce the resize handler and only commit a
        // new dims object when the breakpoint actually crosses. The previous
        // version called setCanvasDims with a fresh object literal on every
        // resize pixel, so React's Object.is check saw a change each event and
        // forced a full canvas redraw per pixel while the panel was open.
        // Mirrors the rAF-debounced useColumnCount in home-client.tsx.
        let rafId: number | null = null;
        function applyDims() {
            const isDesktop = window.innerWidth >= 768;
            const next = isDesktop ? { width: 320, height: 160 } : { width: 240, height: 120 };
            setCanvasDims((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
        }
        function onResize() {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = null;
                applyDims();
            });
        }
        applyDims();
        window.addEventListener('resize', onResize);
        return () => {
            if (rafId !== null) window.cancelAnimationFrame(rafId);
            window.removeEventListener('resize', onResize);
        };
    }, []);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);
    // Tracks URLs whose <img> load failed (404 / decode error). The URL
    // resolver below skips failed URLs and falls through to the next
    // candidate in priority order: AVIF → sized JPEG → fallback (base).
    const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
    const markFailed = useCallback((url: string) => {
        setFailedUrls((prev) => {
            if (prev.has(url)) return prev;
            const next = new Set(prev);
            next.add(url);
            return next;
        });
    }, []);

    // C3-A4: avifSupported flips from null → true|false when the probe
    // Promise resolves. Render is null-aware: while the probe is pending
    // we skip the AVIF preference (preferAvif=false) but ALSO skip the
    // (sRGB clipped) hint to avoid the prior flicker where the hint
    // appeared briefly on first render then disappeared.
    const [avifSupported, setAvifSupported] = useState<boolean | null>(null);
    useEffect(() => {
        let cancelled = false;
        getAvifSupportPromise().then((supported) => {
            if (!cancelled) setAvifSupported(supported);
        });
        return () => { cancelled = true; };
    }, []);

    const isWideGamut = isWideGamutPrimary(colorPrimaries);
    // P4-B1 / R4-M1: route the P3-display decision through the unified
    // `useDisplayCapability` hook. It checks `screen.colorGamut`, then
    // color-gamut media queries, then falls back conservatively to sRGB.
    // Canvas-P3 support remains a separate rendering-capability gate below.
    const { colorGamut } = useDisplayCapability();
    const isP3Display = colorGamut !== 'srgb';
    const preferAvif = isWideGamut && avifSupported === true && isP3Display && getSupportsCanvasP3() && Boolean(avifUrl);
    // Priority chain: AVIF (if preferred) → sized JPEG → fallback base JPEG.
    // We skip any URL that has already failed an <img> load so older photos
    // missing a sized derivative (legacy `imageSizes` config) cleanly fall
    // through to the base filename instead of leaving the histogram blank.
    const candidateUrls: (string | undefined)[] = preferAvif
        ? [avifUrl, imageUrl, fallbackImageUrl]
        : [imageUrl, fallbackImageUrl];
    const effectiveUrl = candidateUrls.find((u): u is string => Boolean(u) && !failedUrls.has(u as string)) ?? null;
    // C3-A4: only show "(sRGB clipped)" when the AVIF probe has actually
    // resolved AND came back as `false`. While avifSupported === null
    // (probe pending), suppress the hint to avoid the first-render flicker
    // where the hint briefly appeared before the probe settled.
    // R6-L1: the clipping warning is about display gamut, not AVIF support.
    // An sRGB-display visitor viewing a wide-gamut photo sees clipped colors
    // regardless of whether their browser can decode AVIF.
    // R27-HD-MED-1: also fire the clipped hint when the AVIF source has
    // fallen back to the sized/base JPEG on a P3 display — the bytes the
    // histogram canvas reads are sRGB at that point, regardless of intent.
    const isClipped = resolveIsClipped({ isWideGamut, colorGamut, preferAvif, effectiveUrl, avifUrl });

    const histogramData = histogramState.imageUrl === effectiveUrl ? histogramState.data : null;
    const loading = Boolean(effectiveUrl) && histogramState.imageUrl !== effectiveUrl;
    // R9-LOW: surface which derivative the histogram computed from so
    // photographers auditing know whether they're looking at AVIF or JPEG data.
    // R27-HD-MED-1: label follows the URL the worker actually fetched, not
    // the priority intent — if the AVIF candidate 404s and we fall back to
    // a sized JPEG, the label must say JPEG so the audit is truthful.
    const histogramSource = resolveHistogramSourceLabel(effectiveUrl, avifUrl);
    const modeLabels: Record<HistogramMode, string> = {
        luminance: t('viewer.histogramModes.luminance'),
        rgb: t('viewer.histogramModes.color'),
        r: t('viewer.histogramModes.red'),
        g: t('viewer.histogramModes.green'),
        b: t('viewer.histogramModes.blue'),
    };
    const gamutLabel = getGamutLabel(colorPrimaries, t);

    useEffect(() => {
        workerRef.current = new Worker(`/histogram-worker.js?v=${IMAGE_PIPELINE_VERSION}`);
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!effectiveUrl) return;
        let aborted = false;
        const abortController = new AbortController();

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if (aborted) return;
            const worker = workerRef.current;
            if (!worker) {
                setHistogramState({ imageUrl: effectiveUrl, data: null });
                return;
            }
            computeHistogramAsync(img, worker, colorPrimaries, abortController.signal)
                .then((data) => {
                    if (!aborted) {
                        setHistogramState({ imageUrl: effectiveUrl, data });
                    }
                })
                .catch(() => {
                    // Canvas tainted or worker error — silently fail
                    if (!aborted && !abortController.signal.aborted) {
                        setHistogramState({ imageUrl: effectiveUrl, data: null });
                    }
                });
        };
        img.onerror = () => {
            if (aborted) return;
            // Mark this URL as failed so the next render falls through to
            // the next candidate (AVIF → sized JPEG → base fallback). This
            // is the path for legacy photos missing a 640 px derivative.
            markFailed(effectiveUrl);
            setHistogramState({ imageUrl: effectiveUrl, data: null });
        };
        img.src = effectiveUrl;
        return () => {
            aborted = true;
            abortController.abort();
            img.onload = null;
            img.onerror = null;
            img.src = '';
        };
    }, [effectiveUrl, markFailed, colorPrimaries]);

    // R4C8 COR-R4C8-04: `canvasDims` MUST be a dependency. The <canvas>
    // width/height attributes come from canvasDims state, and per the HTML
    // spec assigning either attribute RESETS (clears) the drawing buffer —
    // so when a resize crosses the 768 px breakpoint React re-attributes
    // the canvas and the histogram blanked until the next mode/theme/photo
    // change. Redrawing from the cached histogramData is cheap.
    useEffect(() => {
        if (!histogramData || !canvasRef.current || collapsed) return;
        drawHistogram(canvasRef.current, histogramData, mode, isDark);
    }, [histogramData, mode, collapsed, isDark, canvasDims]);

    const cycleMode = useCallback(() => {
        setMode((prev) => {
            const idx = MODE_CYCLE.indexOf(prev);
            return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
        });
    }, []);

    // C1-CRIT-2 (cycle 1 RPF): use useImperativeHandle to expose the cycle
    // function. Direct ref.current = ... during render violates React 19's
    // react-hooks/refs rule.
    useImperativeHandle(cycleModeRef, () => cycleMode, [cycleMode]);

    return (
        <div className={cn('flex flex-col gap-1', className)}>
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {t('viewer.histogram')}
                    {gamutLabel && <span className="ml-1 opacity-70">{gamutLabel}</span>}
                    {isClipped && <span className="ml-1 text-amber-700 dark:text-amber-300 font-medium">({t('viewer.histogramSrgbPreview')})</span>}
                    {/* R8-LOW: Rec.2020 sources are delivered as P3, so the
                        histogram canvas reflects Display-P3 space even though
                        the source primaries are Rec.2020. */}
                    {colorPrimaries === 'bt2020' && <span className="ml-1 opacity-70">{t('viewer.histogramRenderedInP3')}</span>}
                    {histogramSource && <span className="ml-1 opacity-60">{t('viewer.histogramSource', { format: histogramSource })}</span>}
                </span>
                <button
                    type="button"
                    onClick={() => setCollapsed((v) => !v)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors px-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={collapsed ? t('aria.expandHistogram') : t('aria.collapseHistogram')}
                >
                    {collapsed ? '▸' : '▾'}
                </button>
            </div>

            {!collapsed && (
                <div className="flex flex-col gap-1">
                    <div
                        className="relative bg-black/20 rounded overflow-hidden"
                        style={{ width: canvasDims.width, height: canvasDims.height }}
                    >
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
                            </div>
                        )}
                        <canvas
                            ref={canvasRef}
                            width={canvasDims.width}
                            height={canvasDims.height}
                            className="w-full h-full"
                            role="img"
                            aria-label={t('aria.histogramLabel', { mode: modeLabels[mode] })}
                        />
                    </div>
                    {/* P3-9: clip percentage labels */}
                    {/* R5-H3: RGB mode shows per-channel worst-case clipping. */}
                    {histogramData && (() => {
                        let total = 0;
                        let belowBlack = 0;
                        let aboveWhite = 0;
                        if (mode === 'rgb') {
                            total = histogramData.r.reduce((sum, v) => sum + v, 0);
                            belowBlack = Math.max(histogramData.r[0], histogramData.g[0], histogramData.b[0]);
                            aboveWhite = Math.max(histogramData.r[255], histogramData.g[255], histogramData.b[255]);
                        } else {
                            const clipBins = mode === 'luminance' ? histogramData.l : mode === 'r' ? histogramData.r : mode === 'g' ? histogramData.g : mode === 'b' ? histogramData.b : histogramData.l;
                            total = clipBins.reduce((sum, v) => sum + v, 0);
                            belowBlack = clipBins[0];
                            aboveWhite = clipBins[255];
                        }
                        if (total === 0) return null;
                        belowBlack = (belowBlack / total) * 100;
                        aboveWhite = (aboveWhite / total) * 100;
                        const threshold = 0.5;
                        const showBelow = belowBlack > threshold;
                        const showAbove = aboveWhite > threshold;
                        if (!showBelow && !showAbove) return null;
                        return (
                            <div className="flex gap-2 text-xs">
                                {showBelow && (
                                    <span className="text-destructive-text">{t('viewer.histogramBelowBlack', { pct: belowBlack.toFixed(1) })}</span>
                                )}
                                {showAbove && (
                                    <span className="text-destructive-text">{t('viewer.histogramAboveWhite', { pct: aboveWhite.toFixed(1) })}</span>
                                )}
                            </div>
                        );
                    })()}
                    {/* R9-LOW: key-type estimate from luminance histogram
                        (High-key / Low-key / Balanced).
                        R15-M1 / R10-M15: wrap in tooltip so viewers unfamiliar
                        with the terminology get a one-line plain-language
                        explanation of what the heuristic measures. */}
                    {histogramData && (() => {
                        const keyType = estimateKeyType(histogramData);
                        return (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex min-h-11 min-w-11 items-center rounded px-2 text-xs text-muted-foreground cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    >
                                        {t(`viewer.keyType${keyType}`)}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {t(`viewer.keyType${keyType}Tooltip`)}
                                </TooltipContent>
                            </Tooltip>
                        );
                    })()}
                    <button
                        type="button"
                        onClick={cycleMode}
                        className="self-start min-h-11 min-w-11 text-xs px-2 py-2 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={t('aria.cycleHistogram')}
                    >
                        {modeLabels[mode]}
                    </button>
                </div>
            )}
        </div>
    );
}
