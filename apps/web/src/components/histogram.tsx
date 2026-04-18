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

interface HistogramProps {
    imageUrl: string;
    className?: string;
}

const MODE_LABELS: Record<HistogramMode, string> = {
    luminance: 'Luminance',
    rgb: 'Color',
    r: 'R',
    g: 'G',
    b: 'B',
};

const MODE_CYCLE: HistogramMode[] = ['luminance', 'rgb', 'r', 'g', 'b'];

/**
 * Extract pixel data from an image on the main thread (canvas required),
 * then post the raw buffer to a Web Worker for the O(n) histogram computation.
 */
function computeHistogramAsync(
    imageEl: HTMLImageElement,
    worker: Worker,
): Promise<HistogramData> {
    const canvas = document.createElement('canvas');
    const maxDim = 256;
    const scale = Math.min(maxDim / imageEl.naturalWidth, maxDim / imageEl.naturalHeight, 1);
    const w = Math.round(imageEl.naturalWidth * scale);
    const h = Math.round(imageEl.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
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

    return new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
            worker.removeEventListener('message', handler);
            resolve(e.data as HistogramData);
        };
        worker.addEventListener('message', handler);
        // Transfer the underlying ArrayBuffer so it is zero-copy
        const buffer = imageData.data.buffer;
        worker.postMessage(
            { imageData: buffer, width: w, height: h },
            [buffer],
        );
    });
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
        const max = Math.max(...bins, 1);
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
        const maxAll = Math.max(...data.r, ...data.g, ...data.b, 1);
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

export function Histogram({ imageUrl, className }: HistogramProps) {
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
    const histogramData = histogramState.imageUrl === imageUrl ? histogramState.data : null;
    const loading = Boolean(imageUrl) && histogramState.imageUrl !== imageUrl;

    useEffect(() => {
        workerRef.current = new Worker('/histogram-worker.js?v=1');
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!imageUrl) return;
        let aborted = false;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if (aborted) return;
            const worker = workerRef.current;
            if (!worker) {
                setHistogramState({ imageUrl, data: null });
                return;
            }
            computeHistogramAsync(img, worker)
                .then((data) => {
                    if (!aborted) {
                        setHistogramState({ imageUrl, data });
                    }
                })
                .catch(() => {
                    // Canvas tainted or worker error — silently fail
                    if (!aborted) {
                        setHistogramState({ imageUrl, data: null });
                    }
                });
        };
        img.onerror = () => {
            if (aborted) return;
            setHistogramState({ imageUrl, data: null });
        };
        img.src = imageUrl;
        return () => {
            aborted = true;
            img.onload = null;
            img.onerror = null;
            img.src = '';
        };
    }, [imageUrl]);

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
                </span>
                <button
                    type="button"
                    onClick={() => setCollapsed((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
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
                            aria-label={t('aria.histogramLabel', { mode: MODE_LABELS[mode] })}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={cycleMode}
                        className="self-start text-xs font-mono px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={t('aria.cycleHistogram')}
                    >
                        {MODE_LABELS[mode]}
                    </button>
                </div>
            )}
        </div>
    );
}
