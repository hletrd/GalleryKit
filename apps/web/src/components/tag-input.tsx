'use client';

import * as React from 'react';
import { X, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';

export interface Tag {
    id: number;
    name: string;
    slug: string;
}

interface TagInputProps {
    availableTags: Tag[];
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
    placeholder?: string;
    className?: string;
    ariaLabel?: string;
}

export function normalizeTagInputValue(value: string) {
    return value.trim().normalize('NFKC').toLocaleLowerCase();
}

export function hasSelectedTag(selectedTags: string[], candidate: string) {
    const normalizedCandidate = normalizeTagInputValue(candidate);
    return selectedTags.some((tag) => normalizeTagInputValue(tag) === normalizedCandidate);
}

export function resolveCanonicalTagName(availableTags: Tag[], candidate: string) {
    const normalizedCandidate = normalizeTagInputValue(candidate);
    return availableTags.find((tag) => normalizeTagInputValue(tag.name) === normalizedCandidate)?.name ?? candidate.trim();
}

export function TagInput({
    availableTags,
    selectedTags,
    onTagsChange,
    placeholder,
    className,
    ariaLabel,
}: TagInputProps) {
    const { t } = useTranslation();
    const [inputValue, setInputValue] = React.useState('');
    const [isOpen, setIsOpen] = React.useState(false);
    const [highlightedIndex, setHighlightedIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const suggestionsId = React.useId();

    const filteredTags = React.useMemo(() => {
        const lowerInput = inputValue.trim().toLowerCase();
        return availableTags
            .filter(tag => !hasSelectedTag(selectedTags, tag.name)) // Exclude selected
            .filter(tag => tag.name.toLowerCase().includes(lowerInput)); // Match input
    }, [availableTags, selectedTags, inputValue]);

    // Check if the current input exactly matches an existing tag (case-insensitive)
    const exactMatch = availableTags.find(
        tag => normalizeTagInputValue(tag.name) === normalizeTagInputValue(inputValue)
    );

    // Determine if we should show "Create new tag" option
    const cleanInputValue = inputValue.trim();
    const showCreateOption = cleanInputValue.length > 0
        && !cleanInputValue.includes(',')
        && !exactMatch
        && !hasSelectedTag(selectedTags, cleanInputValue);

    const reset = () => {
        setInputValue('');
        setIsOpen(false);
        setHighlightedIndex(0);
    };

    const addTag = (tag: string) => {
        const clean = tag.trim();
        if (!clean || clean.includes(',')) return;
        const nextTag = resolveCanonicalTagName(availableTags, clean);
        if (!hasSelectedTag(selectedTags, nextTag)) {
            onTagsChange([...selectedTags, nextTag]);
        }
        reset();
        inputRef.current?.focus();
    };

    const removeTag = (tagToRemove: string) => {
        onTagsChange(selectedTags.filter(tag => tag !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && inputValue === '' && selectedTags.length > 0) {
            e.preventDefault();
            removeTag(selectedTags[selectedTags.length - 1]);
        } else if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (isOpen) {
                // If dropdown is open, selecting from list takes priority
                if (filteredTags.length > 0 && highlightedIndex < filteredTags.length) {
                    addTag(filteredTags[highlightedIndex].name);
                } else if (showCreateOption && highlightedIndex === filteredTags.length) {
                    addTag(inputValue);
                } else if (inputValue) {
                    // Fallback: just add what's typed if it's valid
                     addTag(inputValue);
                }
            } else if (inputValue) {
                 addTag(inputValue);
            }
        } else if (e.key === 'Tab') {
            // UX-01: Tab should accept the highlighted suggestion (if any)
            // and then let the browser move focus to the next focusable element.
            // We intentionally do NOT call preventDefault() so the default
            // Tab focus-traversal still works and users can Tab out.
            if (isOpen) {
                if (filteredTags.length > 0 && highlightedIndex < filteredTags.length) {
                    addTag(filteredTags[highlightedIndex].name);
                } else if (showCreateOption && highlightedIndex === filteredTags.length) {
                    addTag(inputValue);
                }
            }
            setIsOpen(false);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIsOpen(true);
            const maxIndex = filteredTags.length + (showCreateOption ? 0 : -1); // If create option exists, it's at index = length
            setHighlightedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIsOpen(true);
            const maxIndex = filteredTags.length + (showCreateOption ? 0 : -1);
            setHighlightedIndex(prev => (prev > 0 ? prev - 1 : maxIndex));
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    // Close dropdown on click outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset highlight when list changes
    React.useEffect(() => {
        setHighlightedIndex(0);
    }, [filteredTags.length, showCreateOption]);

    const activeDescendantId = isOpen
        ? highlightedIndex < filteredTags.length
            ? `${suggestionsId}-option-${filteredTags[highlightedIndex]?.id}`
            : showCreateOption && highlightedIndex === filteredTags.length
                ? `${suggestionsId}-create`
                : undefined
        : undefined;

    return (
        <div className={cn("relative", className)} ref={containerRef}>
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                {selectedTags.map(tag => (
                    <Badge variant="secondary" key={tag} className="gap-1 pr-1">
                        {tag}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                            className="ml-1 rounded-full p-0.5 hover:bg-destructive hover:text-destructive-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2 opacity-70 hover:opacity-100 transition-all shrink-0"
                            aria-label={t('aria.removeTag', { tag })}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </Badge>
                ))}
                <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-label={ariaLabel || placeholder}
                    aria-autocomplete="list"
                    aria-expanded={isOpen && !!(inputValue || filteredTags.length > 0)}
                    aria-controls={suggestionsId}
                    aria-activedescendant={activeDescendantId}
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    placeholder={selectedTags.length === 0 ? placeholder : ''}
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {isOpen && (inputValue || filteredTags.length > 0) && (
                <div className="absolute top-full left-0 w-full mt-1 z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95">
                    <div className="max-h-[300px] overflow-auto p-1" id={suggestionsId} role="listbox">
                        {filteredTags.length === 0 && !showCreateOption && (
                            <div className="py-2 px-2 text-sm text-muted-foreground text-center">
                                {t('tagInput.noMatches')}
                            </div>
                        )}

                        {filteredTags.map((tag, index) => (
                            <div
                                key={tag.id}
                                id={`${suggestionsId}-option-${tag.id}`}
                                role="option"
                                aria-selected={highlightedIndex === index}
                                className={cn(
                                    "relative flex select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer",
                                    highlightedIndex === index ? "bg-accent text-accent-foreground" : ""
                                )}
                                onClick={() => addTag(tag.name)}
                                onMouseEnter={() => setHighlightedIndex(index)}
                            >
                                <Check className={cn("mr-2 h-4 w-4", selectedTags.includes(tag.name) ? "opacity-100" : "opacity-0")} />
                                <span>{tag.name}</span>
                            </div>
                        ))}

                        {showCreateOption && (
                            <div
                                id={`${suggestionsId}-create`}
                                role="option"
                                aria-selected={highlightedIndex === filteredTags.length}
                                className={cn(
                                    "relative flex select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer border-t mt-1",
                                    highlightedIndex === filteredTags.length ? "bg-accent text-accent-foreground" : ""
                                )}
                                onClick={() => addTag(inputValue)}
                                onMouseEnter={() => setHighlightedIndex(filteredTags.length)}
                            >
                                <span className="mr-2 h-4 w-4 flex items-center justify-center">+</span>
                                <span>{t('tagInput.create', { value: inputValue })}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
