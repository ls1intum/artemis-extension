import type { CSSProperties } from 'react';

import { ALL_MARKER_COLORS } from '../constants';

interface Props {
    /** Event-type key; drives the color via ALL_MARKER_COLORS. */
    type: string;
    /** Visible text; defaults to the type key. */
    label?: string;
    /** Extra class names appended after the base/type classes. */
    className?: string;
    /** Tooltip text (e.g. the full label when the badge is truncated). */
    title?: string;
}

/**
 * Event-type badge pill. The color is derived from the single source of truth
 * (ALL_MARKER_COLORS, which merges MARKER_COLORS with the legacy EQ/
 * intervention colors so old recordings' badges stay distinguishable) and
 * applied inline, so badge pills and canvas dots can never drift apart.
 * Unknown keys (e.g. the special "annotation" badge) get no inline color and
 * fall back to their `.event-badge.<key>` CSS rule.
 */
export function EventBadge({ type, label, className, title }: Props) {
    const color = ALL_MARKER_COLORS[type];
    // `${color}26` appends ~15% alpha (0x26/0xff) to the 6-digit hex for the
    // translucent background.
    const style: CSSProperties | undefined = color
        ? { color, background: `${color}26` }
        : undefined;
    return (
        <span
            className={`event-badge ${type}${className ? ` ${className}` : ''}`}
            style={style}
            title={title}
        >
            {label ?? type}
        </span>
    );
}
