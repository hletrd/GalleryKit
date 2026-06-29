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
            className="min-h-[520px] w-full rounded-lg border bg-muted/20"
            role="status"
            aria-live="polite"
            aria-label={label}
        />
    );
}

export function MapLoader(props: MapLoaderProps) {
    return (
        <Suspense fallback={<MapLoadingFallback label={props.loadingLabel} />}>
            <MapClientDynamic {...props} />
        </Suspense>
    );
}
