'use client';

// Leaflet CSS is imported here (inside the dynamic-imported component) so it
// ships ONLY in the /map route chunk and never inflates other pages' bundles.
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import 'leaflet-defaulticon-compatibility';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useRouter } from 'next/navigation';
import { localizePath } from '@/lib/locale-path';
import { imageUrl, sizedImageUrl } from '@/lib/image-url';

export interface MapMarker {
    id: number;
    latitude: number;
    longitude: number;
    title: string | null;
    filename_jpeg: string;
    topic: string;
}

interface MapClientProps {
    markers: MapMarker[];
    locale: string;
    noPhotosLabel: string;
    openPhotoLabel: string;
    /**
     * PERF-R4C15-02: the admin-configured `image_sizes` list, passed from
     * the map page's getGalleryConfig(). Deliberately required — a
     * DEFAULT_IMAGE_SIZES shortcut here would silently 404 every popup
     * thumb into the full-resolution fallback whenever an admin
     * reconfigures `image_sizes`.
     */
    imageSizes: number[];
}

/**
 * PERF-R4C15-02: popup thumbnail following the R23-M1 sized-derivative
 * contract (mirrors SearchResultItem in components/search.tsx, which in
 * turn mirrors the R21-M1 lightbox / R22-M1 viewer idiom): request the
 * nearest configured derivative for the ~120 px rendered size instead
 * of the full-resolution base JPEG (multi-MB for a 120×80 thumb), and
 * swap one-shot to the base filename if the sized derivative 404s
 * (legacy photos mid-backfill — the encoder atomic-rename contract
 * guarantees the base file exists). Routing through
 * imageUrl()/sizedImageUrl() also honors IMAGE_BASE_URL on CDN-fronted
 * deployments; the previous raw `/uploads/jpeg/${…}` interpolation was
 * the only image surface in src/ bypassing it.
 */
function MarkerThumb({ marker, imageSizes }: { marker: MapMarker; imageSizes: number[] }) {
    const sizedSrc = sizedImageUrl('/uploads/jpeg', marker.filename_jpeg, 128, imageSizes);
    const baseSrc = imageUrl(`/uploads/jpeg/${marker.filename_jpeg}`);
    const [imgSrc, setImgSrc] = useState<string>(sizedSrc);
    const fallbackTriedRef = useRef(false);
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={imgSrc}
            alt={marker.title ?? String(marker.id)}
            width={120}
            height={80}
            style={{ objectFit: 'cover', borderRadius: '4px' }}
            onError={() => {
                if (fallbackTriedRef.current) return;
                fallbackTriedRef.current = true;
                if (imgSrc !== baseSrc) {
                    setImgSrc(baseSrc);
                }
            }}
        />
    );
}

// Fits the map view to contain all markers after mount.
function FitBounds({ markers }: { markers: MapMarker[] }) {
    const map = useMap();
    const fitted = useRef(false);
    useEffect(() => {
        if (fitted.current || markers.length === 0) return;
        fitted.current = true;
        if (markers.length === 1) {
            map.setView([markers[0].latitude, markers[0].longitude], 12);
        } else {
            const lats = markers.map(m => m.latitude);
            const lngs = markers.map(m => m.longitude);
            map.fitBounds(
                [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
                { padding: [40, 40] }
            );
        }
    }, [map, markers]);
    return null;
}

export function MapClient({ markers, locale, openPhotoLabel, imageSizes }: MapClientProps) {
    const router = useRouter();

    function handleMarkerClick(id: number) {
        try {
            sessionStorage.setItem('gallery_auto_lightbox', 'true');
        } catch { /* sessionStorage may be blocked */ }
        router.push(localizePath(locale, `/p/${id}`));
    }

    return (
        <MapContainer
            center={[20, 0]}
            zoom={2}
            style={{ height: '70vh', width: '100%', borderRadius: '0.5rem' }}
            className="z-0"
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds markers={markers} />
            {markers.map(marker => (
                <Marker
                    key={marker.id}
                    position={[marker.latitude, marker.longitude]}
                    eventHandlers={{
                        click: () => handleMarkerClick(marker.id),
                    }}
                >
                    <Popup>
                        <button
                            type="button"
                            onClick={() => handleMarkerClick(marker.id)}
                            className="flex flex-col items-center gap-1 min-h-[44px] min-w-[44px] cursor-pointer text-left"
                            aria-label={`${openPhotoLabel}: ${marker.title ?? marker.id}`}
                        >
                            <MarkerThumb marker={marker} imageSizes={imageSizes} />
                            {marker.title && (
                                <span className="text-xs font-medium text-center max-w-[120px] truncate">
                                    {marker.title}
                                </span>
                            )}
                        </button>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}
