'use client';

import { useState } from 'react';
import { PhotoViewerLoading } from '@/components/photo-viewer-loading';

function readLightboxFlag(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return sessionStorage.getItem('gallery_auto_lightbox') === 'true';
    } catch {
        return false;
    }
}

export default function PhotoLoading() {
    const [isLightbox] = useState(readLightboxFlag);

    if (isLightbox) {
        return (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black"
                role="status"
                aria-live="polite"
            >
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/80 border-t-transparent" aria-hidden="true" />
            </div>
        );
    }

    return <PhotoViewerLoading />;
}
