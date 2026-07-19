import { useState } from 'react';

import type { EpisodeHistoryEntry } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { BackLink, Container, IconButton, PageHeader, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import { DecisionFlowPipeline } from './DecisionFlowPipeline';
import { EpisodeHistoryPanel } from './EpisodeHistoryPanel';
import { LiveEngineSection } from './LiveEngineSection';
import { SlotPanel } from './SlotPanel';
import styles from './StruggleDetectionView.module.css';
import { TimersPanel } from './TimersPanel';
import type { StruggleData, StruggleDetectionViewProps } from './types';

/** Urgency-meter colour: red at/above θ_full (0.7), amber approaching, green below. */
function getUrgencyColor(u: number): string {
    return u >= 0.7 ? '#f44336' : u >= 0.6 ? '#ff9800' : '#4caf50';
}

export function StruggleDetectionView({ vscodeApi }: StruggleDetectionViewProps) {
    const [data, setData] = useState<StruggleData | null>(null);
    const [episodes, setEpisodes] = useState<EpisodeHistoryEntry[]>([]);

    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.StruggleDetectionInit) {
            const { type: _type, ...struggleData } = msg;
            setData(struggleData);
        } else if (msg.type === ExtensionMsg.StruggleSlotUpdate) {
            setEpisodes(msg.episodes);
        }
    }, [setData, setEpisodes]);

    const handleBackToDashboard = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

    const handleOpenFullscreen = () => {
        postCommand(vscodeApi, 'toggleStruggleFullscreen');
    };

    if (!data) {
        // No back-link here: until the init arrives we cannot know whether this is the embedded
        // editor-tab copy, and a back-link in that standalone panel would mutate the sidebar's
        // global app state rather than navigate the panel. The link returns once data loads.
        return (
            <div className={styles.struggleDetectionView}>
                <SkeletonList count={5} />
            </div>
        );
    }

    // The whole page is developer-only (the entry is dev-gated and the route is guarded). This is a
    // backstop in case the state is reached without developer mode.
    if (!data.developerMode) {
        return (
            <div className={styles.struggleDetectionView}>
                {!data.embedded && (
                    <BackLink onClick={handleBackToDashboard}>
                        Back to Dashboard
                    </BackLink>
                )}
                <Container>
                    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                        <p style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--vscode-foreground)' }}>
                            Developer view
                        </p>
                        <p style={{ margin: 0, fontSize: '14px', color: 'var(--vscode-descriptionForeground)' }}>
                            The struggle-detection dashboard is only available in developer mode.
                        </p>
                    </div>
                </Container>
            </div>
        );
    }

    if (!data.isEnabled) {
        return (
            <div className={styles.struggleDetectionView}>
                {!data.embedded && (
                    <BackLink onClick={handleBackToDashboard}>
                        Back to Dashboard
                    </BackLink>
                )}
                <Container>
                    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                        <p style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            margin: '0 0 8px 0',
                            color: 'var(--vscode-foreground)'
                        }}>
                            Struggle Detection Inactive
                        </p>
                        <p style={{
                            margin: 0,
                            fontSize: '14px',
                            color: 'var(--vscode-descriptionForeground)'
                        }}>
                            Struggle detection needs your consent to run. Grant it via the setting
                            &quot;Artemis › Iris: Proactive Code Egress&quot; to start local typing/pause analysis.
                        </p>
                    </div>
                </Container>
            </div>
        );
    }

    const urgencyColor = getUrgencyColor(data.urgency);
    const urgencyPercent = Math.min(Math.max(data.urgency * 100, 0), 100);

    return (
        <div className={styles.struggleDetectionView}>
            {!data.embedded && (
                <BackLink
                    onClick={handleBackToDashboard}
                    actions={data.developerMode
                        ? <IconButton.Fullscreen onClick={handleOpenFullscreen} title="Open in Editor" />
                        : undefined}
                >
                    Back to Dashboard
                </BackLink>
            )}

            <PageHeader
                title="Struggle Detection"
                subtitle="Monitors your development patterns to detect when you might need help."
            />

            {/* On wide viewports (fullscreen editor tab) the panels flow into two columns,
                auto-balanced by height; in the narrow sidebar they stack in source order. */}
            <div className={styles.masonry}>
                {/* Urgency (compact, top): the v3 decision signal (S_base) that triggers alerts. */}
                <Container
                    header={
                        <div style={{ fontSize: '15px', fontWeight: 600 }}>
                            Urgency (decision signal)
                        </div>
                    }
                    variant="default"
                    padding="default"
                    collapsible
                    defaultCollapsed={false}
                >
                    {!data.debug?.sessionActive ? (
                        /* No active exercise session: the engine reports urgency 0 here, so show an
                           explicit empty state instead of a calm green "0.00" that reads as "running". */
                        <div style={{ fontSize: '13px', color: 'var(--vscode-descriptionForeground)' }}>
                            No active exercise session. Open an Artemis exercise to start the engine; the score appears once it ticks.
                        </div>
                    ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {/* Score + status on one line; the long explanation moves to a hover tooltip. */}
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                            <div style={{ fontSize: '26px', fontWeight: 700, color: urgencyColor, minWidth: '54px', lineHeight: 1 }}>
                                {data.urgency.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: urgencyColor }}>
                                {data.urgency >= 0.7 ? 'At or above alert threshold' : 'Below alert threshold'}
                            </div>
                            <div
                                style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}
                                title="Core severity (typing + gap), 0.0 (calm) to 1.0 (severe). Alert at θ = 0.70."
                            >
                                &theta; = 0.70
                            </div>
                        </div>

                        {/* Slim progress bar with θ marker at 70% */}
                        <div style={{
                            position: 'relative',
                            height: '6px',
                            borderRadius: '3px',
                            background: 'var(--vscode-progressBar-background, #333)',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${urgencyPercent}%`,
                                borderRadius: '3px',
                                background: urgencyColor,
                                transition: 'width 0.3s ease'
                            }} />
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: '70%',
                                width: '2px',
                                height: '100%',
                                background: 'var(--vscode-foreground)'
                            }} />
                        </div>
                    </div>
                    )}
                </Container>

                {/* Decision-flow pipeline: how the latest tick decided. Renders only with an
                    active session + a real tick (the component self-guards). */}
                {data.debug && <DecisionFlowPipeline debug={data.debug} collapsible defaultCollapsed />}

                {/* Developer-only timers/counters dashboard (warm-up, cooldown, grace, throttle, metrics).
                    Fed by the per-tick struggleDetectionInit snapshot; interpolates its own 1 s clock. */}
                {data.developerMode && data.debug && <TimersPanel debug={data.debug} collapsible defaultCollapsed />}

                {/* Developer-only slot state panel: live intervention slot view.
                    Owns its own subscribe/unsubscribe lifecycle (ref-counted alongside LiveEngineSection).
                    Renders in both the sidebar and the fullscreen editor-tab copy (feed is sender-aware). */}
                {data.developerMode && <SlotPanel vscodeApi={vscodeApi} collapsible defaultCollapsed={false} />}

                {/* Developer-only episode history panel: terminated episodes for this session.
                    Pure presentational; the View fans msg.episodes from the slot broadcast down as a prop.
                    Renders in both the sidebar and the fullscreen editor-tab copy (feed is sender-aware). */}
                {data.developerMode && <EpisodeHistoryPanel episodes={episodes} collapsible defaultCollapsed />}

                {/* Developer-only live engine view (curve + current-tick gate panel).
                    Owns its own subscribe/unsubscribe lifecycle; the parent must NOT
                    post struggleLiveSubscribe (avoids the listener-before-subscribe race).
                    Renders in both the sidebar and the fullscreen editor-tab copy (feed is sender-aware). */}
                {data.developerMode && <LiveEngineSection vscodeApi={vscodeApi} collapsible defaultCollapsed />}

                {/* Developer tools */}
                {__IRIS_RECORDING__ && data.developerMode && (
                    <Container
                        header={
                            <div style={{ fontSize: '15px', fontWeight: 600 }}>
                                Developer Tools
                            </div>
                        }
                        variant="default"
                        padding="default"
                        collapsible
                        defaultCollapsed
                    >
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => postCommand(vscodeApi, 'openRecordingsFolder')}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    border: '1px solid var(--vscode-button-border, transparent)',
                                    borderRadius: '4px',
                                    background: 'var(--vscode-button-secondaryBackground)',
                                    color: 'var(--vscode-button-secondaryForeground)',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                }}
                            >
                                Open Recordings Folder
                            </button>
                        </div>
                    </Container>
                )}
            </div>
        </div>
    );
}
