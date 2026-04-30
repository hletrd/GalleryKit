import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Count Unicode code points in a string, matching MySQL's `varchar(N)`
 * character semantics. JavaScript's `.length` counts UTF-16 code units,
 * which double-counts supplementary characters (emoji, rare CJK) that
 * use surrogate pairs. MySQL `varchar(N)` with `utf8mb4` counts code
 * points, so a 128-emoji title (256 JS code units) fits in `varchar(255)`.
 *
 * C7-AGG7R-02: use this for all admin string length validations that
 * compare against MySQL varchar limits.
 */
export function countCodePoints(s: string): number {
  return [...s].length;
}
