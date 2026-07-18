export const MASONRY_WIDTH_BUCKET_PX = 48;
export const MASONRY_COLUMN_GAP_PX = 16;
export const MASONRY_CARD_WIDTH_FALLBACK_PX = 300;
const PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX = 32;
const SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX = 64;

export type MasonryColumnCount = 1 | 2 | 3 | 4 | 5;

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

function cappedSlotSize(
    itemCount: number,
    maximumColumns: MasonryColumnCount,
    containerMaxWidth: number,
    horizontalPadding: number,
): string {
    const columns = getEffectiveMasonryColumns(itemCount, maximumColumns);
    return `${estimateMasonryCardWidth(containerMaxWidth - horizontalPadding, columns)}px`;
}

/**
 * Mirrors `columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`.
 * The item-count cap matches HomeClient's dynamic class policy, so a sparse
 * gallery never advertises more columns than it actually renders. Tailwind's
 * default `.container` gains a fixed max-width at every breakpoint, including
 * `lg` where the column count stays at three. Encode those capped, padded,
 * gapped slot widths during SSR so an ultrawide browser does not start a 1536w
 * request before the client can observe the real masonry width.
 */
export function getMainMasonrySizes(itemCount: number): string {
    return [
        `(min-width: 1536px) ${cappedSlotSize(itemCount, 5, 1536, PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX)}`,
        `(min-width: 1280px) ${cappedSlotSize(itemCount, 4, 1280, PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX)}`,
        `(min-width: 1024px) ${cappedSlotSize(itemCount, 3, 1024, PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX)}`,
        `(min-width: 768px) ${cappedSlotSize(itemCount, 3, 768, PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX)}`,
        `(min-width: 640px) ${cappedSlotSize(itemCount, 2, 640, PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX)}`,
        `calc(100vw - ${PUBLIC_CONTAINER_HORIZONTAL_PADDING_PX}px)`,
    ].join(', ');
}

export const ARCHIVE_MASONRY_SIZES = getMainMasonrySizes(5);

/**
 * Mirrors `columns-1 md:columns-2 lg:columns-3 xl:columns-4` inside the shared
 * page's second `container px-4`, nested under the public layout container.
 */
export const SHARED_GROUP_MASONRY_SIZES = [
    `(min-width: 1536px) ${cappedSlotSize(4, 4, 1536, SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX)}`,
    `(min-width: 1280px) ${cappedSlotSize(4, 4, 1280, SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX)}`,
    `(min-width: 1024px) ${cappedSlotSize(4, 3, 1024, SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX)}`,
    `(min-width: 768px) ${cappedSlotSize(4, 2, 768, SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX)}`,
    `(min-width: 640px) ${cappedSlotSize(4, 1, 640, SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX)}`,
    `calc(100vw - ${SHARED_GROUP_TOTAL_HORIZONTAL_PADDING_PX}px)`,
].join(', ');
