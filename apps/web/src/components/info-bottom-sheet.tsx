'use client';

import { useState, useRef, useEffect, useCallback } from "react";
import FocusTrap from '@/components/lazy-focus-trap';
import { Info, MapPin, Calendar, Clock, X, Download, ChevronDown } from "lucide-react";
import { useTranslation } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { ImageDetail, TagInfo, hasExifData, hasAnyCameraExifData, nu, formatShutterSpeed } from '@/lib/image-types';
import { formatStoredExifDate, formatStoredExifTime } from '@/lib/exif-datetime';
import { getPhotoDisplayTitle, humanizeTagLabel } from '@/lib/photo-title';
import { imageUrl } from '@/lib/image-url';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Histogram } from '@/components/histogram';
import ColorDetailsSection from '@/components/color-details-section';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';

interface InfoBottomSheetProps {
    image: ImageDetail;
    isOpen: boolean;
    onClose: () => void;
    isAdmin?: boolean;
    untitledFallbackTitle?: string;
    imageSizes?: number[];
}

type SheetState = 'collapsed' | 'peek' | 'expanded';

const PEEK_HEIGHT = 140;   // px visible in peek state

export default function InfoBottomSheet({ image, isOpen, onClose, isAdmin: isAdminProp = false, untitledFallbackTitle, imageSizes = DEFAULT_IMAGE_SIZES }: InfoBottomSheetProps) {
    const { t, locale } = useTranslation();
    const [sheetState, setSheetState] = useState<SheetState>('peek');
    const [liveTranslateY, setLiveTranslateY] = useState<number | null>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragHandleRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const touchStartY = useRef<number | null>(null);
    const touchStartTime = useRef<number | null>(null);
    const prevIsOpenRef = useRef(isOpen);

    // Reset to 'peek' when transitioning from closed to open.
    // The ref guard prevents unnecessary re-renders when isOpen is already true.
    useEffect(() => {
        if (isOpen && !prevIsOpenRef.current) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop-driven state sync: resetting internal state when the dialog opens is a valid React pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
            setSheetState('peek');
        }
        prevIsOpenRef.current = isOpen;
    }, [isOpen]);

    const getTranslateY = useCallback((state: SheetState): string => {
        switch (state) {
            case 'collapsed':
                return 'calc(100% - 28px)'; // only drag handle visible
            case 'peek':
                return `calc(100% - ${PEEK_HEIGHT}px)`;
            case 'expanded':
                return '0';
        }
    }, []);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
        touchStartTime.current = Date.now();
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (touchStartY.current === null) return;
        e.preventDefault(); // prevent background scroll while dragging the sheet
        const deltaY = e.changedTouches[0].clientY - touchStartY.current;
        setLiveTranslateY(deltaY);
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (touchStartY.current === null || touchStartTime.current === null) return;

        setLiveTranslateY(null); // reset live tracking

        const deltaY = e.changedTouches[0].clientY - touchStartY.current;
        const deltaTime = Date.now() - touchStartTime.current;
        const velocity = Math.abs(deltaY) / deltaTime; // px/ms

        const isSwipeUp = deltaY < -30 || (deltaY < 0 && velocity > 0.3);
        const isSwipeDown = deltaY > 30 || (deltaY > 0 && velocity > 0.3);

        let shouldClose = false;
        setSheetState(prev => {
            if (isSwipeUp) {
                if (prev === 'collapsed') return 'peek';
                if (prev === 'peek') return 'expanded';
                return prev;
            }
            if (isSwipeDown) {
                if (prev === 'expanded') return 'peek';
                if (prev === 'peek') return 'collapsed';
                if (prev === 'collapsed') {
                    shouldClose = true;
                    return 'collapsed';
                }
                return prev;
            }
            return prev;
        });
        if (shouldClose) onClose();

        touchStartY.current = null;
        touchStartTime.current = null;
    }, [onClose]);

    const handleBackdropClick = useCallback(() => {
        if (sheetState === 'expanded') {
            setSheetState('peek');
        } else {
            onClose();
        }
    }, [sheetState, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen && sheetState === 'expanded') {
            requestAnimationFrame(() => closeButtonRef.current?.focus());
        }
    }, [isOpen, sheetState]);

    useEffect(() => {
        if (isOpen && sheetState !== 'expanded') {
            requestAnimationFrame(() => dragHandleRef.current?.focus());
        }
    }, [isOpen, sheetState]);

    if (!isOpen || !image) return null;

    const displayTitle = getPhotoDisplayTitle(
        image,
        untitledFallbackTitle ?? t('imageManager.untitled'),
    );

    const formattedShutterSpeed = formatShutterSpeed(image.exposure_time);
    const formattedCaptureDate = formatStoredExifDate(image.capture_date, locale);
    const formattedCaptureTime = formatStoredExifTime(image.capture_date, locale);
    const downloadExt = image.filename_jpeg ? image.filename_jpeg.split('.').pop() || 'jpg' : 'jpg';
    const downloadHref = image.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;
    const avifDownloadHref = image.filename_avif ? imageUrl(`/uploads/avif/${image.filename_avif}`) : null;
    const isWideGamutSource = Boolean(image.color_primaries && ['p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3'].includes(image.color_primaries));

    return (
        <>
            {/* Backdrop — only shown when expanded */}
            {sheetState === 'expanded' && (
                <div
                    className="fixed inset-0 z-40 bg-black/40"
                    onClick={handleBackdropClick}
                />
            )}

            {/* Sheet */}
            <FocusTrap
                active={isOpen}
                focusTrapOptions={{
                    allowOutsideClick: true,
                    initialFocus: () => dragHandleRef.current ?? closeButtonRef.current ?? false,
                }}
            >
            <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('viewer.bottomSheet')}
                className="fixed inset-x-0 bottom-0 z-50 bg-card border-t rounded-t-xl shadow-2xl transition-transform duration-300 ease-out"
                style={{
                    transform: `translateY(${liveTranslateY !== null
                        ? `calc(${getTranslateY(sheetState)} + ${liveTranslateY}px)`
                        : getTranslateY(sheetState)})`,
                    transition: liveTranslateY !== null ? 'none' : undefined,
                    maxHeight: '95vh',
                    ...({'maxHeight': '95dvh'} as React.CSSProperties),
                    minHeight: `${PEEK_HEIGHT}px`,
                    overflowY: sheetState === 'expanded' ? 'auto' : 'hidden',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
            >
                {/* Drag handle */}
                <button
                    ref={dragHandleRef}
                    type="button"
	                    className="flex min-h-11 w-full justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => setSheetState((prev) => (prev === 'expanded' ? 'peek' : 'expanded'))}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            onClose();
                            return;
                        }
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSheetState((prev) => (prev === 'expanded' ? 'peek' : 'expanded'));
                        }
                    }}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    aria-expanded={sheetState === 'expanded'}
                    aria-label={t('viewer.info')}
                >
                    <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                </button>

                {/* Peek content — always rendered so transition is smooth */}
                <div className="px-4 pb-3 pr-12 relative">
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
	                        className="absolute right-4 top-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={t('aria.close')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                    {/* Title */}
                    <h2 className="font-semibold text-base leading-snug line-clamp-2 mb-1">
                        {displayTitle}
                    </h2>

                    {/* Camera + date summary row */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {hasExifData(image.camera_model) && (
                            <span className="truncate max-w-[180px]">{image.camera_model}</span>
                        )}
                        {formattedCaptureDate && (
                            <span className="flex items-center gap-1" suppressHydrationWarning>
                                <Calendar className="w-3 h-3" />
                                {formattedCaptureDate}
                            </span>
                        )}
                    </div>
                </div>

                {/* Expanded content.
                    C8-MED-02: use dvh (dynamic viewport height) to account for
                    mobile browser chrome, and add safe-area-inset-bottom padding
                    so the download button is not clipped by the home indicator. */}
                {sheetState === 'expanded' && (
                    <div className="max-h-[calc(95dvh-140px)] overflow-y-auto px-4 pt-1" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
                        {/* Tags */}
                        {image.tags && image.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-4">
                                {image.tags.map((tag: TagInfo) => (
                                    // AGG2L-LOW-01 / plan-303-A: route through
                                    // `humanizeTagLabel` so the bottom-sheet tag
                                    // chip stays consistent with the masonry
                                    // card and the desktop info sidebar. See
                                    // `photo-viewer.tsx` for the matching fix.
                                    <Badge key={tag.slug} variant="secondary" className="text-xs">
                                        #{humanizeTagLabel(tag.name)}
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {/* Description */}
                        {image.description && image.description.trim() && (
                            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                                {image.description}
                            </p>
                        )}

                        {/* EXIF section header */}
                        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                            <Info className="h-4 w-4" />
                            {t('viewer.exifData')}
                        </h3>

                        {/* EXIF grid */}
                        <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                            {hasExifData(image.camera_model) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.camera')}</p>
                                    <p className="font-medium truncate" title={nu(image.camera_model)}>{image.camera_model}</p>
                                </div>
                            )}
                            {hasExifData(image.lens_model) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.lens')}</p>
                                    <p className="font-medium truncate" title={nu(image.lens_model)}>{image.lens_model}</p>
                                </div>
                            )}
                            {hasExifData(image.focal_length) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.focalLength')}</p>
                                    <p className="font-medium">{image.focal_length}mm</p>
                                </div>
                            )}
                            {hasExifData(image.f_number) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.aperture')}</p>
                                    <p className="font-medium">f/{Number(image.f_number).toFixed(1)}</p>
                                </div>
                            )}
                            {/* C8-MED-01: use hasExifData guard matching desktop sidebar pattern
                                in photo-viewer.tsx, rather than relying on formatShutterSpeed()
                                returning a falsy value for invalid input. */}
                            {hasExifData(image.exposure_time) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.shutterSpeed')}</p>
                                    <p className="font-medium">{formattedShutterSpeed}</p>
                                </div>
                            )}
                            {hasExifData(image.iso) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.iso')}</p>
                                    <p className="font-medium">{image.iso}</p>
                                </div>
                            )}
                            {hasExifData(image.icc_profile_name) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                                    <p className="font-medium">
                                        {image.icc_profile_name}
                                        {image.icc_profile_name && image.icc_profile_name.toLowerCase().includes('p3') && (
                                            <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[11px] font-bold bg-purple-200 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200 rounded">
                                                P3
                                            </span>
                                        )}
                                    </p>
                                </div>
                            )}
                            {(image.width > 0 && image.height > 0) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.dimensions')}</p>
                                    <p className="font-medium">
                                        {image.width} × {image.height}
                                        <span className="text-muted-foreground text-xs ml-1">
                                            ({(image.width * image.height / 1000000).toFixed(1)} MP)
                                        </span>
                                    </p>
                                </div>
                            )}
                            {hasExifData(image.original_format) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.format')}</p>
                                    <p className="font-medium">
                                        {image.original_format}
                                        {image.original_file_size && (
                                            <span className="text-muted-foreground text-xs ml-1">
                                                ({(image.original_file_size / (1024 * 1024)).toFixed(1)} MB)
                                            </span>
                                        )}
                                    </p>
                                </div>
                            )}
                            {hasExifData(image.white_balance) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.whiteBalance')}</p>
                                    <p className="font-medium">{image.white_balance}</p>
                                </div>
                            )}
                            {hasExifData(image.metering_mode) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.meteringMode')}</p>
                                    <p className="font-medium">{image.metering_mode}</p>
                                </div>
                            )}
                            {hasExifData(image.exposure_compensation) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.exposureComp')}</p>
                                    <p className="font-medium">{image.exposure_compensation}</p>
                                </div>
                            )}
                            {hasExifData(image.exposure_program) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.exposureProgram')}</p>
                                    <p className="font-medium">{image.exposure_program}</p>
                                </div>
                            )}
                            {hasExifData(image.flash) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.flash')}</p>
                                    <p className="font-medium">{image.flash}</p>
                                </div>
                            )}
                            {hasExifData(image.bit_depth) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.sourceBitDepth')}</p>
                                    <p className="font-medium">{image.bit_depth}-bit</p>
                                </div>
                            )}
                            {/* GPS coordinates: this block is currently unreachable from public photo
                                pages because `selectFields` in data.ts intentionally excludes
                                latitude/longitude for privacy. It would only render if an admin-only
                                data accessor explicitly includes these fields. See SEC-38-01. */}
                            {(isAdminProp && image.latitude != null && image.longitude != null) && (
                                <div className="col-span-2">
                                    <p className="text-muted-foreground text-xs">{t('viewer.location')}</p>
                                    <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${image.latitude},${image.longitude}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-medium text-primary hover:underline flex items-center gap-1"
                                    >
                                        <MapPin className="h-3 w-3" />
                                        {image.latitude.toFixed(4)}, {image.longitude.toFixed(4)}
                                    </a>
                                </div>
                            )}
                        </div>
                        {!hasAnyCameraExifData(image) && (
                            <p className="text-sm text-muted-foreground italic mt-2">{t('viewer.noMetadata')}</p>
                        )}

                        {/* Color details accordion — mirrors desktop sidebar */}
                        <ColorDetailsSection image={image} isAdmin={isAdminProp} t={t} />

                        {/* Histogram */}
                        {image.filename_jpeg && (
                            <div className="mt-4 border-t pt-4">
                                <Histogram
                                    imageUrl={imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(imageSizes, 640)}.jpg`)}`)}
                                    avifUrl={image.filename_avif
                                        ? imageUrl(`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, `_${findNearestImageSize(imageSizes, 640)}.avif`)}`)
                                        : undefined}
                                    colorPrimaries={image.color_primaries}
                                    className="w-full"
                                />
                            </div>
                        )}

                        {/* Capture date/time */}
                        <div className="mt-4 text-sm">
                            <p className="text-muted-foreground text-xs mb-1">{t('viewer.capturedAt')}</p>
                            <p className="font-medium flex items-center gap-1" suppressHydrationWarning>
                                <Calendar className="w-3 h-3" />
                                {formattedCaptureDate || t('common.unknown')}
                            </p>
                            {formattedCaptureTime && (
                                <p className="font-medium flex items-center gap-1 text-xs text-muted-foreground mt-1" suppressHydrationWarning>
                                    <Clock className="w-3 h-3" />
                                    {formattedCaptureTime}
                                </p>
                            )}
                        </div>

                        {/* Gamut-aware download — mirrors desktop sidebar logic.
                            Hidden when the photo has a paid license tier so the
                            free download doesn't undermine the licensing intent. */}
                        {downloadHref && (!image.license_tier || image.license_tier === 'none') && (
                            <div className="mt-4 pt-4 border-t">
                                {isWideGamutSource && avifDownloadHref ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button className="w-full gap-2 min-h-11">
                                                <Download className="h-4 w-4" />
                                                {image.color_pipeline_decision?.startsWith('p3-from-')
                                                    ? t('viewer.downloadP3Jpeg')
                                                    : t('viewer.downloadJpeg')}
                                                <ChevronDown className="h-4 w-4 ml-auto" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="min-w-[12rem]">
                                            <DropdownMenuItem asChild className="min-h-11">
                                                <a
                                                    href={downloadHref}
                                                    download={`photo-${image.id}.${downloadExt}`}
                                                    className="flex items-center gap-2"
                                                >
                                                    {t('viewer.downloadSrgbJpeg')}
                                                </a>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem asChild className="min-h-11">
                                                <a
                                                    href={avifDownloadHref}
                                                    download={`photo-${image.id}.avif`}
                                                    className="flex items-center gap-2"
                                                >
                                                    {t('viewer.downloadP3Avif')}
                                                </a>
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : (
                                    <Button asChild className="w-full gap-2 min-h-11">
                                        <a
                                            href={downloadHref}
                                            download={`photo-${image.id}.${downloadExt}`}
                                        >
                                            <Download className="h-4 w-4" /> {t('viewer.downloadJpeg')}
                                        </a>
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
            </FocusTrap>
        </>
    );
}
