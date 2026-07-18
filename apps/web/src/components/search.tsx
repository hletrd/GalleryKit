'use client';

import Image from 'next/image';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import FocusTrap from '@/components/lazy-focus-trap';
import { Search as SearchIcon, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { searchImagesAction } from '@/app/actions/public';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTranslation } from '@/components/i18n-provider';
import { imageUrl, sizedImageUrl } from '@/lib/image-url';
import { isImeComposingNativeEvent, isImeComposingReactEvent } from '@/lib/ime';
import { localizePath } from '@/lib/locale-path';
import { DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';
import { SEMANTIC_TOP_K_DEFAULT } from '@/lib/clip-embedding-constants';
import { formatStoredExifDate } from '@/lib/exif-datetime';
import { cn, countCodePoints } from '@/lib/utils';
import { useModalTreeIsolation } from '@/components/use-modal-tree-isolation';
import { getPhotoResultLabel } from '@/lib/photo-title';

// AGG-C8-04 (run-6 cycle-8): the semantic route rejects queries shorter than this
// many code points with HTTP 400 (api/search/semantic/route.ts: `countCodePoints(query) < 3`).
// Mirror that minimum client-side so a short semantic query shows the helpful
// "too short" message instead of mapping the 400 to the generic unavailable state.
const SEMANTIC_MIN_QUERY_CODEPOINTS = 3;

interface SearchProps {
    previewImageSizes?: number[];
    semanticSearchMode?: string;
    showDesktopLabel?: boolean;
}

interface SearchResultItemProps {
    image: SearchResult;
    previewImageSizes: number[];
    locale: string;
    idx: number;
    activeIndex: number;
    onClose: () => void;
    refCb: (el: HTMLAnchorElement | null) => void;
    t: ReturnType<typeof useTranslations>;
}

/**
 * R23-M1: Per-row search result component so a sized-derivative 404
 * onError swap to the base JPEG filename can hold per-item state that
 * survives the parent `<Search>` re-rendering on each keystroke.
 *
 * Legacy photos and rows caught mid-backfill after an
 * `IMAGE_PIPELINE_VERSION` bump may only carry the base `filename_jpeg`
 * on disk; the encoder atomic-rename contract guarantees the base file
 * exists. Mirrors the R21-M1 (lightbox) and R22-M1 (per-photo viewer)
 * fallback pattern.
 */
function SearchResultItem({
    image,
    previewImageSizes,
    locale,
    idx,
    activeIndex,
    onClose,
    refCb,
    t,
}: SearchResultItemProps) {
    const sizedSrc = sizedImageUrl('/uploads/jpeg', image.filename_jpeg, 128, previewImageSizes);
    const baseSrc = imageUrl(`/uploads/jpeg/${image.filename_jpeg}`);
    const label = getPhotoResultLabel(image, `${t('common.photo')} ${image.id}`);
    const resultLabel = `${label} #${image.id}`;
    const [imgSrc, setImgSrc] = useState<string>(sizedSrc);
    const fallbackTriedRef = useRef(false);
    return (
        <Link
            ref={refCb}
            id={`search-result-${idx}`}
            role="option"
            aria-selected={idx === activeIndex}
            tabIndex={-1}
            href={localizePath(locale, `/p/${image.id}`)}
            prefetch={false}
            onClick={onClose}
            className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${idx === activeIndex ? 'bg-muted' : 'hover:bg-muted/50'}`}
            aria-label={resultLabel}
        >
            <div className="w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0">
                <Image
                    src={imgSrc}
                    alt=""
                    aria-hidden="true"
                    width={48}
                    height={48}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={() => {
                        if (fallbackTriedRef.current) return;
                        fallbackTriedRef.current = true;
                        if (imgSrc !== baseSrc) {
                            setImgSrc(baseSrc);
                        }
                    }}
                />
            </div>
            <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">
                    {resultLabel}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                    {[image.topic_label || (image.topic ? image.topic.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null), image.camera_model, image.lens_model, formatStoredExifDate(image.capture_date, locale)].filter(Boolean).join(' · ')}
                </p>
            </div>
        </Link>
    );
}

interface SearchResult {
    id: number;
    title: string | null;
    description: string | null;
    filename_jpeg: string;
    width: number;
    height: number;
    topic: string;
    topic_label: string | null;
    camera_model: string | null;
    lens_model: string | null;
    capture_date: string | null;
}

export function Search({ previewImageSizes = DEFAULT_IMAGE_SIZES, semanticSearchMode = 'disabled', showDesktopLabel = false }: SearchProps) {
    const { t, locale } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [settledQuery, setSettledQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchStatus, setSearchStatus] = useState<'error' | 'rateLimited' | 'maintenance' | 'invalid' | 'invalidSemantic' | 'semanticSetupRequired' | null>(null);
    const [useSemanticSearch, setUseSemanticSearch] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const modalRootRef = useRef<HTMLDivElement>(null);
    const resultRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const requestIdRef = useRef(0);
    const semanticAbortRef = useRef<AbortController | null>(null);
    const wasOpenRef = useRef(false);
    useModalTreeIsolation(isOpen, modalRootRef);

    const clearSearchState = useCallback(() => {
        requestIdRef.current++;
        semanticAbortRef.current?.abort();
        semanticAbortRef.current = null;
        resultRefs.current = [];
        setActiveIndex(-1);
        setLoading(false);
        setResults([]);
        setSearchStatus(null);
        setSettledQuery('');
    }, []);

    const performSearch = useCallback(async (searchQuery: string, semantic: boolean) => {
        // Clear stale refs from previous result sets
        resultRefs.current = [];
        const normalizedQuery = searchQuery.trim();
        if (!normalizedQuery) {
            clearSearchState();
            return;
        }
        const requestId = ++requestIdRef.current;
        let activeSemanticAbortController: AbortController | null = null;
        setLoading(true);
        setSearchStatus(null);
        try {
            if (semantic) {
                // AGG-C8-04 (run-6 cycle-8): guard the semantic minimum client-side.
                // Without this, a 1-2 char query reaches the route, returns 400, and
                // falls through to the generic 'error' branch. The
                // keyword path surfaces a helpful message for the analogous case, so the
                // semantic path should too.
                if (countCodePoints(normalizedQuery) < SEMANTIC_MIN_QUERY_CODEPOINTS) {
                    setLoading(false);
                    setResults([]);
                    setSearchStatus('invalidSemantic');
                    setSettledQuery(normalizedQuery);
                    return;
                }
                semanticAbortRef.current?.abort();
                const abortController = new AbortController();
                activeSemanticAbortController = abortController;
                semanticAbortRef.current = abortController;
                // Semantic search: POST to /api/search/semantic
                const resp = await fetch('/api/search/semantic', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: normalizedQuery, topK: SEMANTIC_TOP_K_DEFAULT }),
                    signal: abortController.signal,
                });
                if (requestId !== requestIdRef.current) return;
                if (resp.status === 429) {
                    setResults([]);
                    setSearchStatus('rateLimited');
                    setSettledQuery(normalizedQuery);
                } else if (resp.status === 503) {
                    let semanticErrorCode: string | undefined;
                    try {
                        semanticErrorCode = ((await resp.clone().json()) as { code?: string }).code;
                    } catch {
                        semanticErrorCode = undefined;
                    }
                    if (requestId !== requestIdRef.current) return;
                    setResults([]);
                    setSearchStatus(
                        semanticErrorCode === 'semantic_not_configured' || semanticErrorCode === 'semantic_no_embeddings'
                            ? 'semanticSetupRequired'
                            : 'maintenance',
                    );
                    setSettledQuery(normalizedQuery);
                } else if (!resp.ok) {
                    setResults([]);
                    setSearchStatus('error');
                    setSettledQuery(normalizedQuery);
                } else {
                    const json = await resp.json() as { results?: { imageId: number; title?: string | null; description?: string | null; filename_jpeg?: string; width?: number; height?: number; topic?: string; topic_label?: string | null; camera_model?: string | null; lens_model?: string | null; capture_date?: string | null }[] };
                    // R4C6 COR-R4C6-07: resp.json() is a SECOND await — re-check
                    // the request id before committing results so a slow stale
                    // response cannot clobber a fresher one (the keyword branch
                    // already re-checks after its await).
                    if (requestId !== requestIdRef.current) return;
                    const semanticResults: SearchResult[] = (json.results ?? []).map(r => ({
                        id: r.imageId,
                        title: r.title ?? null,
                        description: r.description ?? null,
                        filename_jpeg: r.filename_jpeg ?? '',
                        width: r.width ?? 0,
                        height: r.height ?? 0,
                        topic: r.topic ?? '',
                        topic_label: r.topic_label ?? null,
                        camera_model: r.camera_model ?? null,
                        lens_model: r.lens_model ?? null,
                        capture_date: r.capture_date ?? null,
                    }));
                    setResults(semanticResults);
                    setSearchStatus(null);
                    setSettledQuery(normalizedQuery);
                }
            } else {
                const data = await searchImagesAction(normalizedQuery);
                if (requestId === requestIdRef.current) {
                    if (data.status === 'ok') {
                        setResults(data.results);
                        setSearchStatus(null);
                    } else {
                        setResults([]);
                        setSearchStatus(data.status);
                    }
                    setSettledQuery(normalizedQuery);
                }
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                return;
            }
            if (requestId === requestIdRef.current) {
                setResults([]);
                setSearchStatus('error');
                setSettledQuery(normalizedQuery);
            }
        } finally {
            if (
                activeSemanticAbortController
                && semanticAbortRef.current === activeSemanticAbortController
            ) {
                semanticAbortRef.current = null;
            }
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, [clearSearchState]);

    const handleQueryChange = useCallback((nextQuery: string) => {
        requestIdRef.current++;
        semanticAbortRef.current?.abort();
        semanticAbortRef.current = null;
        resultRefs.current = [];
        setQuery(nextQuery);
        setActiveIndex(-1);
        setLoading(false);
        setResults([]);
        setSearchStatus(null);
        setSettledQuery('');
    }, []);

    useEffect(() => {
        return () => {
            semanticAbortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!query.trim()) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional debounce reset when the query is cleared
            clearSearchState();
            return;
        }
        debounceRef.current = setTimeout(() => {
            performSearch(query, useSemanticSearch);
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, useSemanticSearch, performSearch, clearSearchState]);

    const handleClose = useCallback(() => {
        setIsOpen(false);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // R4C6 COR-R4C6-01: Escape during an IME composition cancels the
            // composition only — it must not close the search dialog and
            // destroy the in-progress query.
            if (isImeComposingNativeEvent(e)) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                // AGG9B-28 / CR9-S8 (loop-B cycle 9b): keep the guard against
                // hijacking Cmd/Ctrl+K while typing in unrelated inputs, but
                // allow the toggle from the search dialog's OWN input — the
                // dialog focuses it on open, so the blanket input guard made
                // the standard close gesture (Cmd/Ctrl+K again) inert exactly
                // while the dialog was open.
                const isForeignInput =
                    (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) &&
                    e.target !== inputRef.current;
                if (isForeignInput) return;
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleClose, isOpen]);

    useEffect(() => {
        if (isOpen) {
            wasOpenRef.current = true;
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
        }

        if (wasOpenRef.current) {
            requestAnimationFrame(() => triggerRef.current?.focus());
            wasOpenRef.current = false;
        }
    }, [isOpen]);

    useEffect(() => {
        if (activeIndex < 0) return;
        resultRefs.current[activeIndex]?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
        });
    }, [activeIndex]);

    // Lock body scroll when the search overlay is open. Must be declared
    // before any early return so the hook order stays stable across renders
    // (rules-of-hooks), then no-ops when the overlay is closed.
    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [isOpen]);

    if (!isOpen) {
        const showSearchLabel = semanticSearchMode === 'production' || showDesktopLabel;
        return (
            <Button
                ref={triggerRef}
                variant="ghost"
                size={showSearchLabel ? 'default' : 'icon'}
                onClick={() => setIsOpen(true)}
                aria-label={t('aria.searchPhotos')}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                // 44x44 touch-target floor; matches the adjacent theme/locale
                // buttons in the nav (F-3).
                className={showSearchLabel ? "h-11 min-w-11 gap-2 px-3" : "h-11 w-11"}
            >
                <SearchIcon className="h-4 w-4" />
                {showSearchLabel && <span className={cn("text-sm", showDesktopLabel ? "hidden lg:inline" : "inline")}>{t('aria.searchPhotos')}</span>}
            </Button>
        );
    }

    const trimmedQuery = query.trim();
    const hasSettledCurrentQuery = trimmedQuery.length > 0 && settledQuery === trimmedQuery;
    const hasDisplayedResults = hasSettledCurrentQuery && results.length > 0;
    const liveSearchStatusMessage = loading
        ? t('search.searching')
        : hasDisplayedResults
            ? t('search.resultsCount', { count: results.length })
            : '';
    const visibleSearchStatusMessage = !loading && hasSettledCurrentQuery && !hasDisplayedResults
        ? searchStatus
            ? t(`search.${searchStatus}`)
            : t('search.noResults')
        : '';

    const dialog = (
        <div ref={modalRootRef} className="contents">
            <div
                className="fixed inset-0 bg-black/50 z-40"
                onClick={handleClose}
                aria-hidden="true"
            />
            <FocusTrap
                active={isOpen}
                focusTrapOptions={{
                    allowOutsideClick: true,
                    initialFocus: '#search-input',
                    fallbackFocus: '#search-dialog',
                }}
            >
            <div
                id="search-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={t('aria.searchPhotos')}
                className="fixed inset-0 sm:inset-auto sm:top-0 sm:left-0 sm:right-0 z-50 p-0 sm:p-6 sm:pt-[10vh]"
            >
                <div className="mx-auto h-full sm:h-auto sm:max-w-xl bg-card sm:border sm:rounded-xl shadow-2xl overflow-hidden flex flex-col">
                    <div className="flex items-center gap-2 p-4 border-b">
                        <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <label htmlFor="search-input" className="sr-only">
                            {t('search.placeholder')}
                        </label>
                        <Input
                            id="search-input"
                            ref={inputRef}
                            aria-label={t('search.placeholder')}
                            aria-describedby={hasDisplayedResults ? 'search-keyboard-instructions' : undefined}
                            role="combobox"
                            aria-autocomplete="list"
                            aria-controls={hasDisplayedResults ? 'search-results' : undefined}
                            aria-expanded={hasDisplayedResults}
                            aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `search-result-${activeIndex}` : undefined}
                            value={query}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            onKeyDown={(e) => {
                                // R4C6 COR-R4C6-01: while an IME composition
                                // is in progress, arrows navigate the
                                // candidate list and Enter commits the
                                // composition — they must not move the
                                // result selection or click a result.
                                if (isImeComposingReactEvent(e)) return;
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setActiveIndex(i => Math.min(i + 1, results.length - 1));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setActiveIndex(i => Math.max(i - 1, -1));
                                } else if (e.key === 'Enter' && activeIndex >= 0 && resultRefs.current[activeIndex]) {
                                    e.preventDefault();
                                    resultRefs.current[activeIndex]?.click();
                                }
                            }}
                            placeholder={t('search.placeholder')}
                            className="h-11 border-0 px-0 py-2 shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleClose}
                            // 44x44 touch-target floor for the dialog dismiss
                            // affordance on mobile (F-21).
                            className="h-11 w-11 shrink-0"
                            aria-label={t('aria.close')}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="sr-only" aria-live="polite" aria-atomic="true">
                        {liveSearchStatusMessage}
                    </div>
                    {hasDisplayedResults && (
                        <p id="search-keyboard-instructions" className="sr-only">
                            {t('search.keyboardInstructions')}
                        </p>
                    )}
                    <div className="flex-1 overflow-y-auto sm:max-h-[60vh]">
                        {hasDisplayedResults ? (
                            <div className="p-2" id="search-results" role="listbox" aria-label={t('aria.searchPhotos')}>
                                {results.map((image, idx) => (
                                    <SearchResultItem
                                        key={image.id}
                                        image={image}
                                        previewImageSizes={previewImageSizes}
                                        locale={locale}
                                        idx={idx}
                                        activeIndex={activeIndex}
                                        onClose={handleClose}
                                        refCb={(el) => { resultRefs.current[idx] = el; }}
                                        t={t}
                                    />
                                ))}
                            </div>
                        ) : trimmedQuery ? (
                            <div className="p-8 text-center text-muted-foreground text-sm" role="status" aria-live="polite" aria-atomic="true">
                                {visibleSearchStatusMessage}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-muted-foreground text-sm">
                                {t('search.hint')}
                            </div>
                        )}
                    </div>
                    <div className="hidden sm:block p-2 border-t text-center">
                        <p className="text-xs text-muted-foreground">
                            {hasDisplayedResults && (
                                <span className="mr-2">{t('search.keyboardInstructions')}</span>
                            )}
                            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Ctrl/&#8984; K</kbd> {t('search.toggleHint')}
                        </p>
                    </div>
                    {semanticSearchMode !== 'disabled' && (
                        <div className="p-3 border-t space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                                <Label
                                    htmlFor="semantic-search-toggle"
                                    className="text-xs text-muted-foreground cursor-pointer select-none"
                                >
                                    {t('search.semanticToggle')}
                                </Label>
                                <Switch
                                    id="semantic-search-toggle"
                                    checked={useSemanticSearch}
                                    onCheckedChange={(checked) => {
                                        clearSearchState();
                                        setUseSemanticSearch(checked);
                                    }}
                                    aria-describedby={semanticSearchMode !== 'disabled' ? 'semantic-search-hint' : undefined}
                                    aria-label={t('search.semanticToggle')}
                                    // 44px touch-target floor: Switch has an implicit min-h,
                                    // wrapper div provides at least 44px tap area via padding.
                                />
                            </div>
                            {/* CRT-R5C2-01: honesty disclaimer. Shown only in stub mode —
                                stub encoder scores are essentially random so we tell the visitor
                                the results may not match. In production mode the results are real,
                                so the disclaimer is omitted. */}
                            {semanticSearchMode === 'stub' && (
                                <p id="semantic-search-hint" className="text-xs text-muted-foreground">
                                    {t('search.semanticExperimentalHint')}
                                </p>
                            )}
                            {semanticSearchMode === 'production' && (
                                <p id="semantic-search-hint" className="text-xs text-muted-foreground">
                                    {t('search.semanticProductionHint')}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
            </FocusTrap>
        </div>
    );

    return createPortal(dialog, document.body);
}
