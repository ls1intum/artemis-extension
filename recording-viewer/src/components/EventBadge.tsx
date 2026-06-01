import type { CSSProperties } from 'react';

import { MARKER_COLORS } from '../constants';

interface Props {
    /** Event-type key; drives the color via MARKER_COLORS. */
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
 * (MARKER_COLORS) and applied inline, so badge pills and canvas dots can never
 * drift apart. Unknown keys (e.g. the special "annotation" badge) get no inline
 * color and fall back to their `.event-badge.<key>` CSS rule.
 */
export function EventBadge({ type, label, className, title }: Props) {
    const color = (MARKER_COLORS as Record<string, string>)[type];
    // `${color}26` appends ~15% alpha (0x26/0xff) to the 6-digit hex for the
    // translucent background, matching the previous per-type CSS look.
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
