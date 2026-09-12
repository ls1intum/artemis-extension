import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { type ReactNode, useState } from 'react';

import styles from './EarlierHintsGroup.module.css';
import type { ChatRenderItem } from './groupProactiveMessages';

interface EarlierHintsGroupProps {
    /** The consecutive closed episodes to collapse (already known to be a run of >= 2). */
    items: ChatRenderItem[];
    /** Renders one closed episode as its normal fold line (each still expands to its own timeline). */
    renderFoldLine: (item: ChatRenderItem) => ReactNode;
}

/**
 * Collapses a run of consecutive closed proactive episodes behind a single "N earlier hints" line.
 * Clicking it reveals the individual fold lines, keeping the history reachable while
 * killing the tall stack of near-identical rows in a long session.
 */
export function EarlierHintsGroup({ items, renderFoldLine }: EarlierHintsGroupProps) {
    const [expanded, setExpanded] = useState(false);
    const count = items.length;
    return (
        <div className={styles.group}>
            <button
                type="button"
                className={styles.summary}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
            >
                {expanded
                    ? <ChevronDown size={12} aria-hidden="true" />
                    : <ChevronRight size={12} aria-hidden="true" />}
                <span>{count} earlier {count === 1 ? 'hint' : 'hints'}</span>
            </button>
            {expanded && (
                <div className={styles.children}>
                    {items.map(renderFoldLine)}
                </div>
            )}
        </div>
    );
}
