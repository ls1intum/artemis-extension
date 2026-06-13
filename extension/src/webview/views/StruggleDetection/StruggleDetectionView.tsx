import { useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { BackLink, Badge, Container, PageHeader, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import styles from './StruggleDetectionView.module.css';
import type { StruggleData, StruggleDetectionViewProps } from './types';

/** V-meter colour: red at/above θ_full (0.6), amber approaching, green below. */
function getVColor(v: number): string {
    return v >= 0.6 ? '#f44336' : v >= 0.5 ? '#ff9800' : '#4caf50';
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

    if (!data) {
        return (
            <div className={styles.struggleDetectionView}>
                <BackLink onClick={handleBackToDashboard}>
                    Back to Dashboard
                </BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    if (!data.isEnabled) {
        return (
            <div className={styles.struggleDetectionView}>
                <BackLink onClick={handleBackToDashboard}>
                    Back to Dashboard
                </BackLink>
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

    const vColor = getVColor(data.v);
    const vPercent = Math.min(Math.max(data.v * 100, 0), 100);

    return (
        <div className={styles.struggleDetectionView}>
            <BackLink onClick={handleBackToDashboard}>
                Back to Dashboard
            </BackLink>

            <PageHeader
                title="Struggle Detection"
                subtitle="Monitors your development patterns to detect when you might need help."
            />

            {/* Severity (V) */}
            <Container
                header={
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>
                        Severity (V)
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
                            color: vColor,
                            minWidth: '80px'
                        }}>
                            {data.v.toFixed(2)}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: vColor,
                                marginBottom: '4px'
                            }}>
                                {data.v >= 0.6 ? 'At or above alert threshold' : 'Below alert threshold'}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)'
                            }}>
                                Decayed severity, 0.0 (calm) &mdash; 1.0 (severe). Alert at &theta; = 0.60.
                            </div>
                        </div>
                    </div>

                    {/* Progress bar with θ marker at 60% */}
                    <div style={{
                        position: 'relative',
                        height: '8px',
                        borderRadius: '4px',
                        background: 'var(--vscode-progressBar-background, #333)',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${vPercent}%`,
                            borderRadius: '4px',
                            background: vColor,
                            transition: 'width 0.3s ease'
                        }} />
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: '60%',
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
                        <span>&theta; 0.60</span>
                        <span>1.0</span>
                    </div>
                </div>
            </Container>

            {/* Status details */}
            <Container
                header={
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>
                        Status
                    </div>
                }
                variant="default"
                padding="default"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '14px', color: 'var(--vscode-foreground)' }}>
                            Currently struggling
                        </span>
                        <Badge variant={data.isStruggling ? 'error' : 'success'}>
                            {data.isStruggling ? 'Yes' : 'No'}
                        </Badge>
                    </div>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '14px', color: 'var(--vscode-foreground)' }}>
                            Instantaneous score (S)
                        </span>
                        <Badge variant="muted">
                            {data.s.toFixed(2)}
                        </Badge>
                    </div>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '14px', color: 'var(--vscode-foreground)' }}>
                            Boundary at last tick
                        </span>
                        <Badge variant={data.primaryBoundary ? 'default' : 'muted'}>
                            {data.primaryBoundary ?? '—'}
                        </Badge>
                    </div>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '14px', color: 'var(--vscode-foreground)' }}>
                            Last alert
                        </span>
                        <Badge variant="muted">
                            {data.lastAlertT !== null ? `at ${data.lastAlertT}s` : '—'}
                        </Badge>
                    </div>
                </div>
            </Container>

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
                        <button
                            onClick={() => postCommand(vscodeApi, 'replaySession')}
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
                            Replay Session
                        </button>
                    </div>
                </Container>
            )}
        </div>
    );
}
