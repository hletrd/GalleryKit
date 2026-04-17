'use client';

import { useState, useRef, useEffect, useCallback } from "react";
import FocusTrap from 'focus-trap-react';
import { Info, MapPin, Calendar, Clock } from "lucide-react";
import { useTranslation } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { ImageDetail, TagInfo, hasExifData, nu } from '@/lib/image-types';

interface InfoBottomSheetProps {
    image: ImageDetail;
    isOpen: boolean;
    onClose: () => void;
}

type SheetState = 'collapsed' | 'peek' | 'expanded';

const PEEK_HEIGHT = 140;   // px visible in peek state

export default function InfoBottomSheet({ image, isOpen, onClose }: InfoBottomSheetProps) {
    const { t } = useTranslation();
    const [sheetState, setSheetState] = useState<SheetState>('peek');
    const sheetRef = useRef<HTMLDivElement>(null);
    const touchStartY = useRef<number | null>(null);
    const touchStartTime = useRef<number | null>(null);

    // Reset the sheet back to 'peek' whenever it opens. This is intentionally
    // a prop→state sync: the parent controls isOpen, and on each open we want
    // the sheet to start from the peek state regardless of where the user
    // left it last time. Acceptable per React's "sync external state" guidance.
    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSheetState('peek');
        }
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

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (touchStartY.current === null || touchStartTime.current === null) return;

        const deltaY = e.changedTouches[0].clientY - touchStartY.current;
        const deltaTime = Date.now() - touchStartTime.current;
        const velocity = Math.abs(deltaY) / deltaTime; // px/ms

        const isSwipeUp = deltaY < -30 || (deltaY < 0 && velocity > 0.3);
        const isSwipeDown = deltaY > 30 || (deltaY > 0 && velocity > 0.3);

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
                    onClose();
                    return 'collapsed';
                }
                return prev;
            }
            return prev;
        });

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

    // Escape key to close
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !image) return null;

    const displayTitle = image.title && image.title.trim() !== ''
        ? image.title
        : (image.tags && image.tags.length > 0
            ? image.tags.map((tag: TagInfo) => `#${tag.name}`).join(' ')
            : t('imageManager.untitled'));

    const formattedShutterSpeed = (() => {
        if (!hasExifData(image.exposure_time)) return null;
        const val = Number(image.exposure_time);
        if (!Number.isFinite(val)) return String(image.exposure_time);
        if (val < 1 && val > 0) {
            const denominator = Math.round(1 / val);
            if (Math.abs(1 / denominator - val) < 0.00001) {
                return `1/${denominator}s`;
            }
        }
        return `${image.exposure_time}s`;
    })();

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
            <FocusTrap active={isOpen && sheetState === 'expanded'} focusTrapOptions={{ allowOutsideClick: true, initialFocus: false }}>
            <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('viewer.bottomSheet')}
                className="fixed inset-x-0 bottom-0 z-50 bg-card border-t rounded-t-xl shadow-2xl transition-transform duration-300 ease-out"
                style={{
                    transform: `translateY(${getTranslateY(sheetState)})`,
                    maxHeight: '95vh',
                    ...({'maxHeight': '95dvh'} as React.CSSProperties),
                    minHeight: `${PEEK_HEIGHT}px`,
                    overflowY: sheetState === 'expanded' ? 'auto' : 'hidden',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
                    <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                </div>

                {/* Peek content — always rendered so transition is smooth */}
                <div className="px-4 pb-3">
                    {/* Title */}
                    <h2 className="font-semibold text-base leading-snug line-clamp-2 mb-1">
                        {displayTitle}
                    </h2>

                    {/* Camera + date summary row */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {hasExifData(image.camera_model) && (
                            <span className="truncate max-w-[180px]">{image.camera_model}</span>
                        )}
                        {image.capture_date && (
                            <span className="flex items-center gap-1" suppressHydrationWarning>
                                <Calendar className="w-3 h-3" />
                                {new Date(image.capture_date).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                </div>

                {/* Expanded content */}
                {sheetState === 'expanded' && (
                    <div className="px-4 pb-8 pt-1">
                        {/* Tags */}
                        {image.tags && image.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-4">
                                {image.tags.map((tag: TagInfo) => (
                                    <Badge key={tag.slug} variant="secondary" className="text-xs">
                                        #{tag.name}
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
                                    <p className="font-medium">f/{image.f_number}</p>
                                </div>
                            )}
                            {formattedShutterSpeed && (
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
                            {hasExifData(image.color_space) && (
                                <div>
                                    <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                                    <p className="font-medium">{image.color_space}</p>
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
                            {(image.latitude != null && image.longitude != null) && (
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

                        {/* Capture date/time */}
                        <div className="mt-4 text-sm">
                            <p className="text-muted-foreground text-xs mb-1">{t('viewer.capturedAt')}</p>
                            <p className="font-medium flex items-center gap-1" suppressHydrationWarning>
                                <Calendar className="w-3 h-3" />
                                {image.capture_date ? new Date(image.capture_date).toLocaleDateString() : t('common.unknown')}
                            </p>
                            {image.capture_date && (
                                <p className="font-medium flex items-center gap-1 text-xs text-muted-foreground mt-1" suppressHydrationWarning>
                                    <Clock className="w-3 h-3" />
                                    {new Date(image.capture_date).toLocaleTimeString()}
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
            </FocusTrap>
        </>
    );
}
