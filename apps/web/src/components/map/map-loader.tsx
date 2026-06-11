'use client';

// This thin client wrapper owns the `dynamic` + `ssr:false` import of MapClient.
// Next.js 16 requires `ssr:false` to live in a Client Component, not a Server Component.
import dynamic from 'next/dynamic';
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
    /** PERF-R4C15-02: configured image_sizes for sized popup thumbnails. */
    imageSizes: number[];
}

export function MapLoader(props: MapLoaderProps) {
    return <MapClientDynamic {...props} />;
}
