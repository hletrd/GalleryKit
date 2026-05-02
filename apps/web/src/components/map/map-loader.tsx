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
}

export function MapLoader(props: MapLoaderProps) {
    return <MapClientDynamic {...props} />;
}
