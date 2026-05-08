'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';

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
    postMessage(message: { requestId: number } & HistogramWorkerPayload, transfer: Transferable[]): void;
}

// Minimal 1x1 AVIF data URL for client-side decode support probing.
const AVIF_PROBE_DATA_URL = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAACAAAAAocGJhbHlydXJseXNvcF9jMwAAAAAAAQAAAAAQcGFzcwAAAAABAAAAAQAAAAAccG9zcwAAAAABAAAAAQAAAAAcc3ZjYwAAAAABAAAAAQAAAAAcc2JwcwAAAAABAAAAAQAAAAAccmVsbAAAAA8AAAA6AAAAOHN0ckAAAABzcHRsAAAAAFB0ciBzdGlsbCBwaWN0dXJlAAAAAAABAAAAAAAIc2N2eAAAAA8AAAA6AAAAOHN0Ym0AAAAAUGZiIHN0aWxsIHBpY3R1cmUAAAAAAAEAAAAAAAg=';

const WIDE_GAMUT_PRIMARIES = new Set(['p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3']);

// C1: cache Canvas-P3 + AVIF probe at module scope (singleton, runs once per process).
let _cachedAvifSupported: boolean | null = null;
function getAvifSupported(): boolean {
    if (_cachedAvifSupported !== null) return _cachedAvifSupported;
    const img = new Image();
    img.onload = () => { _cachedAvifSupported = true; };
    img.onerror = () => { _cachedAvifSupported = false; };
    img.src = AVIF_PROBE_DATA_URL;
    // Return false optimistically until the probe resolves; the next render will pick up the cached value.
    return false;
}

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

interface HistogramProps {
    imageUrl: string;
    avifUrl?: string;
    colorPrimaries?: string | null;
    className?: string;
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
    signal?: AbortSignal,
): Promise<HistogramData> {
    const canvas = document.createElement('canvas');
    const maxDim = 256;
    const scale = Math.min(maxDim / imageEl.naturalWidth, maxDim / imageEl.naturalHeight, 1);
    const w = Math.round(imageEl.naturalWidth * scale);
    const h = Math.round(imageEl.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    // CM-MED-6: request a Display-P3 2D context on P3-capable displays so a
    // P3-tagged AVIF/JPEG composites without sRGB clipping. On non-P3
    // displays we fall through to the default sRGB context.
    const supportsP3 = getSupportsCanvasP3();
    const ctxOptions: CanvasRenderingContext2DSettings | undefined = supportsP3
        ? { colorSpace: 'display-p3' as PredefinedColorSpace }
        : undefined;
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

    return requestHistogramFromWorker(worker, {
        imageData: imageData.data.buffer,
        width: w,
        height: h,
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

export function Histogram({ imageUrl, avifUrl, colorPrimaries, className }: HistogramProps) {
    const { t } = useTranslation();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [histogramState, setHistogramState] = useState<{ imageUrl: string | null; data: HistogramData | null }>({
        imageUrl: null,
        data: null,
    });
    const [mode, setMode] = useState<HistogramMode>('luminance');
    const [collapsed, setCollapsed] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);

    const avifSupported = getAvifSupported();

    const isWideGamut = Boolean(colorPrimaries && WIDE_GAMUT_PRIMARIES.has(colorPrimaries));
    const preferAvif = isWideGamut && avifSupported && getSupportsCanvasP3() && Boolean(avifUrl);
    const effectiveUrl = preferAvif ? avifUrl! : imageUrl;
    const isClipped = isWideGamut && !preferAvif;

    const histogramData = histogramState.imageUrl === effectiveUrl ? histogramState.data : null;
    const loading = Boolean(effectiveUrl) && histogramState.imageUrl !== effectiveUrl;
    const modeLabels: Record<HistogramMode, string> = {
        luminance: t('viewer.histogramModes.luminance'),
        rgb: t('viewer.histogramModes.color'),
        r: t('viewer.histogramModes.red'),
        g: t('viewer.histogramModes.green'),
        b: t('viewer.histogramModes.blue'),
    };
    const gamutLabel = getGamutLabel(colorPrimaries, t);

    useEffect(() => {
        workerRef.current = new Worker('/histogram-worker.js?v=1');
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
            computeHistogramAsync(img, worker, abortController.signal)
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
    }, [effectiveUrl]);

    useEffect(() => {
        if (!histogramData || !canvasRef.current || collapsed) return;
        drawHistogram(canvasRef.current, histogramData, mode, isDark);
    }, [histogramData, mode, collapsed, isDark]);

    const cycleMode = useCallback(() => {
        setMode((prev) => {
            const idx = MODE_CYCLE.indexOf(prev);
            return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
        });
    }, []);

    return (
        <div className={cn('flex flex-col gap-1', className)}>
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {t('viewer.histogram')}
                    {gamutLabel && <span className="ml-1 opacity-70">{gamutLabel}</span>}
                    {isClipped && <span className="ml-1 opacity-60">({t('viewer.histogramSrgbClipped')})</span>}
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
                    <div className="relative w-[240px] h-[120px] bg-black/20 rounded overflow-hidden">
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
                            </div>
                        )}
                        <canvas
                            ref={canvasRef}
                            width={240}
                            height={120}
                            className="w-full h-full"
                            role="img"
                            aria-label={t('aria.histogramLabel', { mode: modeLabels[mode] })}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={cycleMode}
	                        className="self-start min-h-11 min-w-11 text-xs font-mono px-2 py-2 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={t('aria.cycleHistogram')}
                    >
                        {modeLabels[mode]}
                    </button>
                </div>
            )}
        </div>
    );
}
