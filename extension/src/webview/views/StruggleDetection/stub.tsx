import type { StruggleDetectionViewProps } from './types';

/**
 * No-op stub for the Open VSX (clean) build. The `@struggleView` esbuild alias
 * resolves to this instead of the real StruggleDetectionView, so the real view
 * and its CSS are excluded from the cloud bundle. Imports nothing with side
 * effects, so esbuild drops it when unused.
 */
export function StruggleDetectionView(_props: StruggleDetectionViewProps) {
    return null;
}
