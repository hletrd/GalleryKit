'use client';

// Leaflet CSS is imported here (inside the dynamic-imported component) so it
// ships ONLY in the /map route chunk and never inflates other pages' bundles.
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import 'leaflet-defaulticon-compatibility';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useRouter } from 'next/navigation';
import { localizePath } from '@/lib/locale-path';

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

export function MapClient({ markers, locale, openPhotoLabel }: MapClientProps) {
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
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={`/uploads/jpeg/${marker.filename_jpeg}`}
                                alt={marker.title ?? String(marker.id)}
                                width={120}
                                height={80}
                                style={{ objectFit: 'cover', borderRadius: '4px' }}
                            />
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
