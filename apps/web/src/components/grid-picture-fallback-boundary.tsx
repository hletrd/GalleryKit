'use client';

import type { ReactNode } from 'react';

type GridPictureFallbackBoundaryProps = {
    children: ReactNode;
    className?: string;
};

export function GridPictureFallbackBoundary({ children, className }: GridPictureFallbackBoundaryProps) {
    return (
        <div
            className={className}
            onErrorCapture={(event) => {
                const target = event.target;
                if (!(target instanceof HTMLImageElement)) return;

                const picture = target.closest<HTMLPictureElement>('picture[data-grid-picture]');
                const fallbackSrc = picture?.dataset.fallbackSrc;
                if (!picture || !fallbackSrc || target.dataset.fallbackApplied === 'true') return;

                picture.querySelectorAll('source').forEach((source) => source.remove());
                target.dataset.fallbackApplied = 'true';
                if (target.src !== fallbackSrc) {
                    target.src = fallbackSrc;
                }
            }}
        >
            {children}
        </div>
    );
}
