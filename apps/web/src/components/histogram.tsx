'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

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
    luminance: 'Lum',
    rgb: 'RGB',
    r: 'R',
    g: 'G',
    b: 'B',
};

const MODE_CYCLE: HistogramMode[] = ['luminance', 'rgb', 'r', 'g', 'b'];

function computeHistogram(imageEl: HTMLImageElement): HistogramData {
    const canvas = document.createElement('canvas');
    canvas.width = imageEl.naturalWidth;
    canvas.height = imageEl.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return {
            r: new Array(256).fill(0),
            g: new Array(256).fill(0),
            b: new Array(256).fill(0),
            l: new Array(256).fill(0),
        };
    }
    ctx.drawImage(imageEl, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    const l = new Array(256).fill(0);

    for (let i = 0; i < data.length; i += 4) {
        const rv = data[i];
        const gv = data[i + 1];
        const bv = data[i + 2];
        r[rv]++;
        g[gv]++;
        b[bv]++;
        const lum = Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
        l[lum]++;
    }

    return { r, g, b, l };
}

function drawHistogram(
    canvas: HTMLCanvasElement,
    data: HistogramData,
    mode: HistogramMode
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

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
            if (i === 0) {
                ctx.lineTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    };

    if (mode === 'luminance') {
        drawChannel(data.l, '#d4d4d4', 1.0);
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
    const [histogramData, setHistogramData] = useState<HistogramData | null>(null);
    const [mode, setMode] = useState<HistogramMode>('luminance');
    const [loading, setLoading] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!imageUrl) return;
        setLoading(true);
        setHistogramData(null);

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const data = computeHistogram(img);
                setHistogramData(data);
            } catch {
                // Canvas tainted or other error — silently fail
            } finally {
                setLoading(false);
            }
        };
        img.onerror = () => {
            setLoading(false);
        };
        img.src = imageUrl;
    }, [imageUrl]);

    useEffect(() => {
        if (!histogramData || !canvasRef.current || collapsed) return;
        drawHistogram(canvasRef.current, histogramData, mode);
    }, [histogramData, mode, collapsed]);

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
                    Histogram
                </span>
                <button
                    type="button"
                    onClick={() => setCollapsed((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
                    aria-label={collapsed ? 'Expand histogram' : 'Collapse histogram'}
                >
                    {collapsed ? '▸' : '▾'}
                </button>
            </div>

            {!collapsed && (
                <div className="flex flex-col gap-1">
                    <div className="relative w-[200px] h-[100px] bg-black/20 rounded overflow-hidden">
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] text-muted-foreground">Loading…</span>
                            </div>
                        )}
                        <canvas
                            ref={canvasRef}
                            width={200}
                            height={100}
                            className="w-full h-full"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={cycleMode}
                        className="self-start text-[10px] font-mono px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Cycle histogram mode"
                    >
                        {MODE_LABELS[mode]}
                    </button>
                </div>
            )}
        </div>
    );
}
