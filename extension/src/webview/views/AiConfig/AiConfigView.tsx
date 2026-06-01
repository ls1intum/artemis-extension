import { useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { BackLink, Badge, Container, PageHeader, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import styles from './AiConfigView.module.css';
import type { AiConfigViewProps, AiExtensionItem } from './types';

export function AiConfigView({ vscodeApi }: AiConfigViewProps) {
    const [extensions, setExtensions] = useState<AiExtensionItem[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.AiConfigInit) {
            setExtensions(msg.aiExtensions);
            setIsLoaded(true);
        }
    }, [setExtensions, setIsLoaded]);

    const handleBackToDashboard = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

    if (!isLoaded) {
        return (
            <div className={styles.aiConfigView}>
                <BackLink onClick={handleBackToDashboard}>
                    Back to Dashboard
                </BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Group extensions by provider
    const groupedByProvider = extensions.reduce<Record<string, { color: string; extensions: AiExtensionItem[] }>>((acc, ext) => {
        if (!acc[ext.provider]) {
            acc[ext.provider] = { color: ext.providerColor, extensions: [] };
        }
        acc[ext.provider].extensions.push(ext);
        return acc;
    }, {});

    const installedCount = extensions.filter(e => e.isInstalled).length;

    return (
        <div className={styles.aiConfigView}>
            <BackLink onClick={handleBackToDashboard}>
                Back to Dashboard
            </BackLink>

            <PageHeader
                title="AI Extension Checker"
                subtitle="Checks for AI-assisted coding extensions that may violate academic integrity policies."
            >
                {isLoaded && extensions.length > 0 && (
                    <div style={{
                        padding: '12px 16px',
                        borderRadius: '6px',
                        background: installedCount > 0
                            ? 'var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1))'
                            : 'var(--vscode-inputValidation-infoBackground, rgba(0, 127, 255, 0.1))',
                        border: `1px solid ${installedCount > 0
                            ? 'var(--vscode-inputValidation-errorBorder, #f44)'
                            : 'var(--vscode-inputValidation-infoBorder, #007acc)'}`,
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--vscode-foreground)'
                    }}>
                        {installedCount} of {extensions.length} blocklisted extensions installed
                    </div>
                )}
            </PageHeader>

            {isLoaded && Object.entries(groupedByProvider).map(([providerName, group]) => (
                <Container
                    key={providerName}
                    listMode={true}
                >
                    <div style={{ marginBottom: '16px' }}>
                        <h2 style={{
                            fontSize: '20px',
                            fontWeight: 600,
                            margin: '0 0 8px 0',
                            color: 'var(--vscode-foreground)',
                            borderLeft: `3px solid ${group.color}`,
                            paddingLeft: '12px'
                        }}>
                            {providerName}
                        </h2>
                        <div style={{
                            height: '1px',
                            background: 'var(--vscode-panel-border)',
                            margin: '12px 0 0 0'
                        }} />
                    </div>

                    {group.extensions.map(ext => (
                        <div key={ext.id} style={{
                            padding: '16px',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                        }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                gap: '12px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <h3 style={{
                                        fontSize: '16px',
                                        fontWeight: 600,
                                        margin: '0 0 4px 0',
                                        color: 'var(--vscode-foreground)'
                                    }}>
                                        {ext.name}
                                    </h3>
                                    <p style={{
                                        margin: 0,
                                        fontSize: '13px',
                                        color: 'var(--vscode-descriptionForeground)'
                                    }}>
                                        {ext.publisher} &bull; v{ext.version}
                                    </p>
                                </div>
                                <Badge variant={ext.isInstalled ? 'error' : 'success'}>
                                    {ext.isInstalled ? 'Installed' : 'Not installed'}
                                </Badge>
                            </div>
                            <p style={{
                                margin: 0,
                                fontSize: '14px',
                                color: 'var(--vscode-foreground)',
                                lineHeight: '1.5'
                            }}>
                                {ext.description}
                            </p>
                        </div>
                    ))}
                </Container>
            ))}

            {isLoaded && extensions.length === 0 && (
                <Container variant="muted">
                    <div style={{
                        textAlign: 'center',
                        padding: '40px 20px',
                        color: 'var(--vscode-descriptionForeground)'
                    }}>
                        <p style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            margin: '0 0 8px 0',
                            color: 'var(--vscode-foreground)'
                        }}>
                            No blocklisted extensions configured
                        </p>
                        <p style={{ margin: 0, fontSize: '14px' }}>
                            The AI extension blocklist is empty.
                        </p>
                    </div>
                </Container>
            )}
        </div>
    );
}
