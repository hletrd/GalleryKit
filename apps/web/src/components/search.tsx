'use client';

import Image from 'next/image';
import { useState, useEffect, useRef, useCallback } from 'react';
import FocusTrap from '@/components/lazy-focus-trap';
import { Search as SearchIcon, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchImagesAction } from '@/app/actions';
import Link from 'next/link';
import { useTranslation } from '@/components/i18n-provider';
import { imageUrl } from '@/lib/image-url';
import { localizePath } from '@/lib/locale-path';

export function Search() {
    const { t, locale } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<{ id: number; title: string | null; description: string | null; filename_webp: string; filename_jpeg: string; width: number; height: number; topic: string; camera_model: string | null }[]>([]);
    const [loading, setLoading] = useState(false);
    const [isMac, setIsMac] = useState(true);
    const [activeIndex, setActiveIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const debounceRef = useRef<NodeJS.Timeout>(undefined);
    const requestIdRef = useRef(0);

    // Detect platform for keyboard shortcut hint (SSR-safe: default to Mac, correct on client)
    useEffect(() => {
        setIsMac(/Mac|iPhone|iPad/.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform));
    }, []);

    const performSearch = useCallback(async (searchQuery: string) => {
        // Clear stale refs from previous result sets
        resultRefs.current = [];
        if (!searchQuery.trim()) {
            setResults([]);
            return;
        }
        const requestId = ++requestIdRef.current;
        setLoading(true);
        try {
            const data = await searchImagesAction(searchQuery);
            if (requestId === requestIdRef.current) {
                setResults(data);
            }
        } catch {
            if (requestId === requestIdRef.current) {
                setResults([]);
            }
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            performSearch(query);
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, performSearch]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === 'Escape' && isOpen) {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

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
        return (
            <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(true)}
                aria-label={t('aria.searchPhotos')}
                className="h-9 w-9"
            >
                <SearchIcon className="h-4 w-4" />
            </Button>
        );
    }

    return (
        <>
            <div
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setIsOpen(false)}
                aria-hidden="true"
            />
            <FocusTrap active={isOpen} focusTrapOptions={{ allowOutsideClick: true, initialFocus: false }}>
            <div role="dialog" aria-modal="true" aria-label={t('aria.searchPhotos')} className="fixed inset-0 sm:inset-auto sm:top-0 sm:left-0 sm:right-0 z-50 p-0 sm:p-6 sm:pt-[10vh]">
                <div className="mx-auto h-full sm:h-auto sm:max-w-xl bg-card sm:border sm:rounded-xl shadow-2xl overflow-hidden flex flex-col">
                    <div className="flex items-center gap-2 p-4 border-b">
                        <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded={results.length > 0}
                            aria-controls="search-results"
                            aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); }}
                            onKeyDown={(e) => {
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
                            placeholder={t('search.placeholder') || 'Search photos, tags, cameras...'}
                            className="border-0 focus-visible:ring-0 shadow-none h-8 p-0"
                        />
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsOpen(false)}
                            className="h-8 w-8 shrink-0"
                            aria-label={t('aria.close')}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto sm:max-h-[60vh]">
                        {results.length > 0 ? (
                            <div className="p-2" id="search-results" role="listbox">
                                {results.map((image, idx) => (
                                    <Link
                                        key={image.id}
                                        ref={(el) => { resultRefs.current[idx] = el; }}
                                        role="option"
                                        id={`search-result-${idx}`}
                                        aria-selected={idx === activeIndex}
                                        href={localizePath(locale, `/p/${image.id}`)}
                                        onClick={() => setIsOpen(false)}
                                        className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${idx === activeIndex ? 'bg-muted' : 'hover:bg-muted/50'}`}
                                    >
                                        <div className="w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0">
                                            <Image
                                                src={imageUrl(`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, '_640.jpg')}`)}
                                                alt={image.title || t('common.photo')}
                                                width={48}
                                                height={48}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-sm truncate">
                                                {image.title || image.description || `${t('common.photo')} ${image.id}`}
                                            </p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {[image.topic ? image.topic.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null, image.camera_model].filter(Boolean).join(' \u00b7 ')}
                                            </p>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ) : query.trim() ? (
                            <div className="p-8 text-center text-muted-foreground text-sm">
                                {loading ? '' : (t('search.noResults') || 'No photos found')}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-muted-foreground text-sm">
                                {t('search.hint') || 'Search by title, tag, camera, or description'}
                            </div>
                        )}
                    </div>
                    <div className="hidden sm:block p-2 border-t text-center">
                        <p className="text-xs text-muted-foreground">
                            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">{isMac ? '\u2318' : 'Ctrl+'}K</kbd> {t('search.toggleHint')}
                        </p>
                    </div>
                </div>
            </div>
            </FocusTrap>
        </>
    );
}
