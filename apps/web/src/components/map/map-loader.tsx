'use client';

// This thin client wrapper owns the `dynamic` + `ssr:false` import of MapClient.
// Next.js 16 requires `ssr:false` to live in a Client Component, not a Server Component.
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import type { MapMarker } from './map-client';

const MapClientDynamic = dynamic(
    () => import('@/components/map/map-client').then(m => m.MapClient),
    { ssr: false }
);

interface MapLoaderProps {
    markers: MapMarker[];
    locale: string;
    noPhotosLabel: string;
    openPhotoLabel: string;
    loadingLabel: string;
    /** PERF-R4C15-02: configured image_sizes for sized popup thumbnails. */
    imageSizes: number[];
}

function MapLoadingFallback({ label }: { label: string }) {
    return (
        <div
            className="flex min-h-[520px] w-full items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
        >
            <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-current animate-pulse" aria-hidden="true" />
                {label}
            </span>
        </div>
    );
}

export function MapLoader(props: MapLoaderProps) {
    return (
        <Suspense fallback={<MapLoadingFallback label={props.loadingLabel} />}>
            <MapClientDynamic {...props} />
        </Suspense>
    );
}
