const SLOT_SIZE_BY_COLUMNS = {
    1: '100vw',
    2: '50vw',
    3: '33vw',
    4: '25vw',
    5: '20vw',
} as const;

export const MASONRY_WIDTH_BUCKET_PX = 48;
export const MASONRY_COLUMN_GAP_PX = 16;
export const MASONRY_CARD_WIDTH_FALLBACK_PX = 300;

export type MasonryColumnCount = keyof typeof SLOT_SIZE_BY_COLUMNS;

function normalizeItemCount(itemCount: number): number {
    if (!Number.isFinite(itemCount)) return 1;
    return Math.max(1, Math.min(5, Math.trunc(itemCount)));
}

export function getEffectiveMasonryColumns(itemCount: number, maximumColumns: number): MasonryColumnCount {
    return Math.min(normalizeItemCount(itemCount), normalizeItemCount(maximumColumns)) as MasonryColumnCount;
}

export function quantizeMasonryContainerWidth(width: number): number {
    if (!Number.isFinite(width) || width <= 0) return 0;
    return Math.max(1, Math.round(width / MASONRY_WIDTH_BUCKET_PX) * MASONRY_WIDTH_BUCKET_PX);
}

export function estimateMasonryCardWidth(containerWidth: number, columns: number): number {
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) return MASONRY_CARD_WIDTH_FALLBACK_PX;
    const normalizedColumns = normalizeItemCount(columns);
    const usableWidth = containerWidth - MASONRY_COLUMN_GAP_PX * (normalizedColumns - 1);
    const width = Math.floor(usableWidth / normalizedColumns);
    return width > 0 ? width : MASONRY_CARD_WIDTH_FALLBACK_PX;
}

function slotSize(itemCount: number, maximumColumns: MasonryColumnCount): string {
    const columns = getEffectiveMasonryColumns(itemCount, maximumColumns);
    return SLOT_SIZE_BY_COLUMNS[columns];
}

/**
 * Mirrors `columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`.
 * The item-count cap matches HomeClient's dynamic class policy, so a sparse
 * gallery never advertises more columns than it actually renders.
 */
export function getMainMasonrySizes(itemCount: number): string {
    return [
        `(min-width: 1536px) ${slotSize(itemCount, 5)}`,
        `(min-width: 1280px) ${slotSize(itemCount, 4)}`,
        `(min-width: 768px) ${slotSize(itemCount, 3)}`,
        `(min-width: 640px) ${slotSize(itemCount, 2)}`,
        slotSize(itemCount, 1),
    ].join(', ');
}

export const ARCHIVE_MASONRY_SIZES = getMainMasonrySizes(5);

/** Mirrors `columns-1 md:columns-2 lg:columns-3 xl:columns-4`. */
export const SHARED_GROUP_MASONRY_SIZES = [
    '(min-width: 1280px) 25vw',
    '(min-width: 1024px) 33vw',
    '(min-width: 768px) 50vw',
    '100vw',
].join(', ');
