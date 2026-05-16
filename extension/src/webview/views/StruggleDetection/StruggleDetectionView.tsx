import { useState } from 'react';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';
import { BackLink, Container, Badge, PageHeader, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import type { StruggleDetectionViewProps, StruggleData } from './types';
import styles from './StruggleDetectionView.module.css';

function getEqLevel(eq: number): { label: string; color: string } {
    if (eq < 0.15) {
        return { label: 'Normal development', color: '#4caf50' };
    }
    if (eq < 0.35) {
        return { label: 'Occasional difficulty', color: '#ffc107' };
    }
    if (eq < 0.60) {
        return { label: 'Systematic struggle', color: '#ff9800' };
    }
    return { label: 'Severe struggle', color: '#f44336' };
}

function getActionVariant(action: string): 'default' | 'success' | 'warning' | 'error' | 'muted' {
    switch (action) {
        case 'none': return 'success';
        case 'subtle': return 'default';
        case 'notification': return 'warning';
        case 'proactive': return 'error';
        default: return 'muted';
    }
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

    const eqLevel = getEqLevel(data.eq);
    const eqPercent = Math.min(Math.max(data.eq * 100, 0), 100);

    return (
        <div className={styles.struggleDetectionView}>
            <BackLink onClick={handleBackToDashboard}>
                Back to Dashboard
            </BackLink>

            <PageHeader
                title="Struggle Detection"
                subtitle="Monitors your development patterns to detect when you might need help."
            />

            {/* EQ Score */}
            <Container
                header={
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>
                        Error Quotient (EQ)
                    </div>
                }
                variant="default"
                padding="default"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {data.eqConfidence === 'insufficient' && (
                        <div style={{
                            padding: '10px 14px',
                            borderRadius: '6px',
                            background: 'var(--vscode-inputValidation-warningBackground, rgba(255, 193, 7, 0.1))',
                            border: '1px solid var(--vscode-inputValidation-warningBorder, #ffc107)',
                            fontSize: '13px',
                            color: 'var(--vscode-foreground)'
                        }}>
                            Not enough data yet. Continue working to build an accurate EQ estimate.
                        </div>
                    )}

                    {/* Score display */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{
                            fontSize: '36px',
                            fontWeight: 700,
                            color: eqLevel.color,
                            minWidth: '80px'
                        }}>
                            {data.eq.toFixed(2)}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: eqLevel.color,
                                marginBottom: '4px'
                            }}>
                                {eqLevel.label}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)'
                            }}>
                                Scale: 0.0 (no errors) &mdash; 1.0 (severe struggle)
                            </div>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div style={{
                        height: '8px',
                        borderRadius: '4px',
                        background: 'var(--vscode-progressBar-background, #333)',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${eqPercent}%`,
                            borderRadius: '4px',
                            background: eqLevel.color,
                            transition: 'width 0.3s ease'
                        }} />
                    </div>

                    {/* Threshold markers */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: 'var(--vscode-descriptionForeground)',
                        padding: '0 2px'
                    }}>
                        <span>0.0</span>
                        <span>0.15</span>
                        <span>0.35</span>
                        <span>0.60</span>
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
                            Confidence
                        </span>
                        <Badge variant={data.eqConfidence === 'sufficient' ? 'default' : 'muted'}>
                            {data.eqConfidence}
                        </Badge>
                    </div>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '14px', color: 'var(--vscode-foreground)' }}>
                            Recommended action
                        </span>
                        <Badge variant={getActionVariant(data.recommendedAction)}>
                            {data.recommendedAction}
                        </Badge>
                    </div>
                    {data.triggerType && (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <span style={{ fontSize: '14px', color: 'var(--vscode-foreground)' }}>
                                Last trigger
                            </span>
                            <Badge variant="muted">
                                {data.triggerType}
                            </Badge>
                        </div>
                    )}
                </div>
            </Container>

            {/* Developer tools */}
            {data.developerMode && (
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
