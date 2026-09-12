import type { EpisodeHistoryEntry } from '@shared/messageContracts';

import { Container } from '@webview/components';

import styles from './EpisodeHistoryPanel.module.css';
import { mmss } from './useEngineCountdowns';

/** Static map from outcome label to its CSS module chip class. Avoids dynamic
 *  string concatenation which fails in esbuild CSS-modules production builds. */
const CHIP_CLASS: Record<EpisodeHistoryEntry['outcome'], string> = {
    DISMISSED: styles.chipDismissed,
    RECOVERED: styles.chipRecovered,
    ABANDONED: styles.chipAbandoned,
    DISCARDED: styles.chipDiscarded,
    INTERRUPTED: styles.chipInterrupted,
};

/**
 * Pure presentational list of terminated episodes for the current session.
 * No subscription: the parent reads `msg.episodes` from the struggleSlotUpdate
 * message and passes the array down as a prop.
 */
export function EpisodeHistoryPanel({ episodes, collapsible, defaultCollapsed }: { episodes: EpisodeHistoryEntry[]; collapsible?: boolean; defaultCollapsed?: boolean }) {
    return (
        <Container
            header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Episodes (this session)</div>}
            variant="default"
            padding="default"
            collapsible={collapsible}
            defaultCollapsed={defaultCollapsed}
        >
            {episodes.length === 0 ? (
                <p className={styles.emptyState}>No episodes yet this session.</p>
            ) : (
                <div className={styles.list}>
                    {[...episodes].reverse().map((ep, i) => (
                        <div key={`${ep.episodeId}-${ep.startedAtMs}-${i}`}>
                            {i > 0 && <hr className={styles.divider} />}
                            <div className={styles.row}>
                                <span className={styles.episodeId} title={ep.episodeId}>{ep.episodeId}</span>
                                <span className={styles.level}>{ep.peakLevel}</span>
                                <span className={`${styles.chip} ${CHIP_CLASS[ep.outcome]}`}>{ep.outcome}</span>
                                <span className={styles.meta}>hints: {ep.hintCount}</span>
                                <span className={styles.meta}>{mmss(ep.durationMs / 1000, 'floor')}</span>
                                <span className={styles.meta}>{new Date(ep.startedAtMs).toLocaleTimeString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Container>
    );
}
