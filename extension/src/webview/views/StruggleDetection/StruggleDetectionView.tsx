import { useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { BackLink, Container, IconButton, PageHeader, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import { DecisionFlowPipeline } from './DecisionFlowPipeline';
import { LiveEngineSection } from './LiveEngineSection';
import styles from './StruggleDetectionView.module.css';
import { TimersPanel } from './TimersPanel';
import type { StruggleData, StruggleDetectionViewProps } from './types';

/** Urgency-meter colour: red at/above θ_full (0.7), amber approaching, green below. */
function getUrgencyColor(u: number): string {
    return u >= 0.7 ? '#f44336' : u >= 0.6 ? '#ff9800' : '#4caf50';
}

export function StruggleDetectionView({ vscodeApi }: StruggleDetectionViewProps) {
    const [data, setData] = useState<StruggleData | null>(null);

    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.StruggleDetectionInit) {
            const { type: _type, ...struggleData } = msg;
            setData(struggleData);
        }
    }, [setData]);

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
                            Struggle Detection Disabled
                        </p>
                        <p style={{
                            margin: 0,
                            fontSize: '14px',
                            color: 'var(--vscode-descriptionForeground)'
                        }}>
                            This feature is currently disabled in your settings. Enable it under
                            &quot;Artemis: Struggle Detection&quot; to start monitoring your development patterns.
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

            {/* Decision-flow pipeline (top): how the latest tick decided. Renders only with an
                active session + a real tick (the component self-guards). */}
            {data.debug && <DecisionFlowPipeline debug={data.debug} />}

            {/* Urgency: the v3 decision signal (S_base) that triggers alerts. */}
            <Container
                header={
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>
                        Urgency (decision signal)
                    </div>
                }
                variant="default"
                padding="default"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Score display */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{
                            fontSize: '36px',
                            fontWeight: 700,
                            color: urgencyColor,
                            minWidth: '80px'
                        }}>
                            {data.urgency.toFixed(2)}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: urgencyColor,
                                marginBottom: '4px'
                            }}>
                                {data.urgency >= 0.7 ? 'At or above alert threshold' : 'Below alert threshold'}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)'
                            }}>
                                Core severity (typing + gap), 0.0 (calm) to 1.0 (severe). Alert at &theta; = 0.70.
                            </div>
                        </div>
                    </div>

                    {/* Progress bar with θ marker at 70% */}
                    <div style={{
                        position: 'relative',
                        height: '8px',
                        borderRadius: '4px',
                        background: 'var(--vscode-progressBar-background, #333)',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${urgencyPercent}%`,
                            borderRadius: '4px',
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

                    {/* Scale markers */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: 'var(--vscode-descriptionForeground)',
                        padding: '0 2px'
                    }}>
                        <span>0.0</span>
                        <span>&theta; 0.70</span>
                        <span>1.0</span>
                    </div>
                </div>
            </Container>

            {/* Developer-only timers/counters dashboard (warm-up, cooldown, grace, throttle, metrics).
                Fed by the per-tick struggleDetectionInit snapshot; interpolates its own 1 s clock. */}
            {data.developerMode && data.debug && <TimersPanel debug={data.debug} />}

            {/* Developer-only live engine view (curve + current-tick gate panel).
                Owns its own subscribe/unsubscribe lifecycle; the parent must NOT
                post struggleLiveSubscribe (avoids the listener-before-subscribe race).
                Hidden in the embedded editor-tab copy: that panel has no live feed wired,
                so the chart would sit empty (user chose dashboard-only for the pop-out). */}
            {data.developerMode && !data.embedded && <LiveEngineSection vscodeApi={vscodeApi} />}

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
    );
}
