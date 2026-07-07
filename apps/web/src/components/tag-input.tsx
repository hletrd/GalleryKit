'use client';

import * as React from 'react';
import { X, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';
import { isValidTagName } from '@/lib/validation';
import { isImeComposingReactEvent } from '@/lib/ime';

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
    disabled?: boolean;
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
    disabled = false,
}: TagInputProps) {
    const { t } = useTranslation();
    const [inputValue, setInputValue] = React.useState('');
    const [isOpen, setIsOpen] = React.useState(false);
    const [highlightedIndex, setHighlightedIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const suggestionsId = React.useId();

    // AGG8b-30 / PERF-REACT-02 (run-10 c8b): normalize the tag vocabulary
    // and the selected set ONCE per prop change instead of re-running NFKC
    // normalization over the whole availableTags list (twice) plus the
    // selected list (per available tag) on every keystroke.
    const normalizedAvailableTags = React.useMemo(
        () => availableTags.map((tag) => ({ tag, normalized: normalizeTagInputValue(tag.name) })),
        [availableTags],
    );
    const normalizedSelectedTags = React.useMemo(
        () => new Set(selectedTags.map((tag) => normalizeTagInputValue(tag))),
        [selectedTags],
    );

    const normalizedInputValue = normalizeTagInputValue(inputValue);

    const filteredTags = React.useMemo(() => {
        // R15C15 CR-15: normalize both sides with NFKC (matching hasSelectedTag /
        // resolveCanonicalTagName) so a fullwidth / composed-Unicode tag isn't
        // shown in the dropdown after it has already been selected.
        return normalizedAvailableTags
            .filter(({ normalized }) => !normalizedSelectedTags.has(normalized)) // Exclude selected
            .filter(({ normalized }) => normalized.includes(normalizedInputValue)) // Match input
            .map(({ tag }) => tag);
    }, [normalizedAvailableTags, normalizedSelectedTags, normalizedInputValue]);

    // Check if the current input exactly matches an existing tag (case-insensitive)
    const exactMatch = normalizedAvailableTags.find(
        ({ normalized }) => normalized === normalizedInputValue
    )?.tag;

    // Determine if we should show "Create new tag" option.
    // normalizeTagInputValue trims first, so the Set lookup below is
    // equivalent to the previous hasSelectedTag(selectedTags, cleanInputValue).
    const cleanInputValue = inputValue.trim();
    const showCreateOption = cleanInputValue.length > 0
        && !cleanInputValue.includes(',')
        && isValidTagName(cleanInputValue)
        && !exactMatch
        && !normalizedSelectedTags.has(normalizedInputValue);

    const reset = () => {
        setInputValue('');
        setIsOpen(false);
        setHighlightedIndex(0);
    };

    const addTag = (tag: string) => {
        if (disabled) return;
        const clean = tag.trim();
        if (!isValidTagName(clean)) return;
        const nextTag = resolveCanonicalTagName(availableTags, clean);
        if (!hasSelectedTag(selectedTags, nextTag)) {
            onTagsChange([...selectedTags, nextTag]);
        }
        reset();
        inputRef.current?.focus();
    };

    const removeTag = (tagToRemove: string) => {
        if (disabled) return;
        onTagsChange(selectedTags.filter(tag => tag !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        // R4C6 COR-R4C6-01: an in-progress IME composition (Korean, etc.)
        // delivers Enter/comma/arrow keydowns BEFORE the text is settled.
        // Acting on them adds half-composed tags, pops tags on the
        // composition's Backspace, and hijacks the candidate-list arrows.
        if (isImeComposingReactEvent(e)) return;
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
        // eslint-disable-next-line react-hooks/set-state-in-effect -- highlighted option is scoped to the current filtered suggestion list
        setHighlightedIndex(0);
    }, [filteredTags.length, showCreateOption]);

    const suggestionsVisible = !disabled && isOpen && !!(inputValue || filteredTags.length > 0);
    const activeDescendantId = suggestionsVisible
        ? highlightedIndex < filteredTags.length
            ? `${suggestionsId}-option-${filteredTags[highlightedIndex]?.id}`
            : showCreateOption && highlightedIndex === filteredTags.length
                ? `${suggestionsId}-create`
                : undefined
        : undefined;

    return (
        <div className={cn("relative", className)} ref={containerRef}>
            <div
                className={cn(
                "flex flex-wrap items-center gap-2 p-2 rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                disabled && "opacity-60",
                )}
                onClick={() => {
                    if (!disabled) inputRef.current?.focus();
                }}
            >
                {selectedTags.map(tag => (
                    <Badge variant="secondary" key={tag} className="gap-1 pr-1">
                        {tag}
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                            className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 opacity-70 hover:opacity-100 transition-all shrink-0"
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
	                    aria-expanded={suggestionsVisible}
	                    aria-controls={suggestionsVisible ? suggestionsId : undefined}
                    aria-activedescendant={activeDescendantId}
                    className="flex-1 min-h-11 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    disabled={disabled}
                    aria-disabled={disabled}
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

            {suggestionsVisible && (
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
	                                    "relative flex min-h-11 select-none items-center rounded-sm px-2 py-2 text-sm outline-none cursor-pointer",
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
	                                    "relative flex min-h-11 select-none items-center rounded-sm px-2 py-2 text-sm outline-none cursor-pointer border-t mt-1",
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
