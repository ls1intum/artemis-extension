import type { IrisActivityDTO, IrisActivityState } from '@shared/types/apiResponses';

import { activityLabel, formatActivityDuration } from '@webview/views/IrisChat/activityLabels';

import styles from './ActivityFeed.module.css';

interface ActivityFeedProps {
    activities: IrisActivityDTO[];
    mode: 'live' | 'trail';
}

const STATE_ICON: Readonly<Record<IrisActivityState, string>> = {
    RUNNING: '◌',
    FINISHED: '✓',
    FAILED: '✕',
};

function stateClass(state: IrisActivityState): string {
    switch (state) {
        case 'RUNNING':
            return styles.stateRunning;
        case 'FINISHED':
            return styles.stateFinished;
        case 'FAILED':
            return styles.stateFailed;
    }
}

export function ActivityFeed({ activities, mode }: ActivityFeedProps) {
    if (activities.length === 0) {
        return null;
    }

    const isLive = mode === 'live';

    return (
        <div
            className={isLive ? styles.feedLive : styles.feedTrail}
            data-testid={`activity-feed-${mode}`}
            aria-live={isLive ? 'polite' : undefined}
            aria-label={isLive ? 'Iris activity' : 'Iris tool activity trail'}
        >
            {activities.map((activity) => {
                const duration = formatActivityDuration(activity);
                return (
                    <span key={activity.id} className={`${styles.chip} ${stateClass(activity.state)}`}>
                        <span className={styles.icon} aria-hidden="true">{STATE_ICON[activity.state]}</span>
                        <span className={styles.label}>{activityLabel(activity.name)}</span>
                        {activity.detail && (
                            <span className={styles.detail} title={activity.detail}>{activity.detail}</span>
                        )}
                        {duration && (
                            <span className={styles.duration}>{duration}</span>
                        )}
                    </span>
                );
            })}
        </div>
    );
}
