/**
 * Runtime feature flags.
 *
 * These are evaluated at build time for client bundles and at runtime for
 * server code. NEXT_PUBLIC_ prefix is required for client-side visibility.
 */

/** WI-08 / WI-09: HDR AVIF delivery via <picture media="dynamic-range:high">.
 *  Defaults to false until the HDR encoder (WI-09) is implemented. */
export const HDR_FEATURE_ENABLED = process.env.NEXT_PUBLIC_HDR_FEATURE_FLAG === 'true';
