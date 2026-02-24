import { useEffect, useState, useRef } from 'react';
import type { VsCodeApi } from '../../../../../shared/messageContracts';
import { useChatStore } from '../../stores/useChatStore';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInput } from './components/ChatInput';
import { ContextSelector } from './components/ContextSelector';
import { ReferencedFiles } from './components/ReferencedFiles';
import clsx from 'clsx';
import styles from './IrisChatView.module.css';

interface IrisChatViewProps {
    vscodeApi: VsCodeApi;
}

export function IrisChatView({ vscodeApi }: IrisChatViewProps) {
    const store = useChatStore();
    const [sideMenuOpen, setSideMenuOpen] = useState(false);
    const [forceContextPicker, setForceContextPicker] = useState(false);
    const [contextSwitching, setContextSwitching] = useState(false);
    const previousContextId = useRef<number | null>(null);
    const sideMenuRef = useRef<HTMLDivElement>(null);

    // Close side menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                sideMenuRef.current &&
                !sideMenuRef.current.contains(event.target as Node)
            ) {
                setSideMenuOpen(false);
            }
        };

        if (sideMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [sideMenuOpen]);

    // Detect context switches for animation
    useEffect(() => {
        const currentId = store.context?.id;

        if (previousContextId.current !== null && currentId !== previousContextId.current) {
            // Context changed - trigger fade out/in animation
            setContextSwitching(true);

            // Reset animation after messages load (500ms for fade out + load + fade in)
            const timer = setTimeout(() => {
                setContextSwitching(false);
            }, 500);

            return () => clearTimeout(timer);
        }

        previousContextId.current = currentId ?? null;
    }, [store.context?.id]);

    // Message listener - handles messages from extension (uses legacy format with message.command)
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case 'updateIrisState':
                    store.setIrisState(message.state);
                    // Extract showDiagnostics flag if present
                    if (typeof message.showDiagnostics === 'boolean') {
                        store.setShowDiagnostics(message.showDiagnostics);
                    }
                    break;

                case 'showContextPicker':
                    store.setIrisState(message.state);
                    setForceContextPicker(true);
                    break;

                case 'addMessage':
                    if (message.message) {
                        store.addMessage({
                            id: message.message.id,
                            localId: crypto.randomUUID(),
                            role: message.message.role,
                            content: message.message.content,
                            timestamp: message.message.timestamp,
                            helpful: message.message.helpful,
                            status: 'sent',
                        });
                    }
                    break;

                case 'loadMessages':
                    if (message.messages) {
                        store.setMessages(message.messages.map((m: any) => ({
                            id: m.id,
                            localId: crypto.randomUUID(),
                            role: m.role,
                            content: m.content,
                            timestamp: m.timestamp,
                            helpful: m.helpful,
                            status: 'sent',
                        })));
                    }
                    break;

                case 'clearChatMessages':
                    store.clearMessages();
                    break;

                case 'updateReferencedFiles':
                    store.setReferencedFiles({
                        includedFiles: message.includedFiles || [],
                        excludedFiles: message.excludedFiles || [],
                        totalCount: message.totalCount || 0,
                    });
                    break;

                case 'updateWebSocketStatus':
                    store.setWebSocketConnected(message.isConnected);
                    break;

                case 'showDisabledState':
                    store.setDisabledMessage(message.message);
                    break;

                case 'hideDisabledState':
                    store.setDisabledMessage(null);
                    break;

                case 'updateNoAiStatus':
                    store.setNoAiDetected(message.isNoAiDetected);
                    break;
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [store]);

    // State persistence (only forceContextPicker)
    useEffect(() => {
        const state = vscodeApi.getState() as { forceContextPicker?: boolean } | undefined;
        if (state) {
            setForceContextPicker(state.forceContextPicker || false);
        }
    }, [vscodeApi]);

    useEffect(() => {
        vscodeApi.setState({
            forceContextPicker,
        });
    }, [forceContextPicker, vscodeApi]);

    // Command dispatch helpers
    const sendCommand = (command: string, payload?: Record<string, unknown>) => {
        vscodeApi.postMessage({ command, ...payload } as any);
    };

    const handleSendMessage = (text: string) => {
        const localId = crypto.randomUUID();

        // Add optimistic message
        store.addMessage({
            localId,
            role: 'user',
            content: text,
            timestamp: Date.now(),
            status: 'sending',
        });

        // Start streaming state (thinking indicator will show)
        store.startStreaming(localId + '-response');

        // Send to extension
        sendCommand('sendMessage', { text });
    };

    const handleFeedback = (messageId: string, feedback: 'positive' | 'negative') => {
        sendCommand('messageFeedback', {
            messageId,
            feedback: feedback === 'positive' ? 'POSITIVE' : 'NEGATIVE',
        });
    };

    const handleOpenFile = (path: string) => {
        sendCommand('openFile', { filePath: path });
    };

    const handleResetSessions = () => {
        setSideMenuOpen(false);
        sendCommand('resetChatSessions');
    };

    const handleOpenHelp = () => {
        setSideMenuOpen(false);
        sendCommand('openHelpPopup');
    };

    const handleOpenDiagnostics = () => {
        setSideMenuOpen(false);
        sendCommand('openDiagnostics');
    };

    const handleDebugSessions = () => {
        setSideMenuOpen(false);
        sendCommand('debugSessions');
    };

    const handleOpenSettings = (setting?: string) => {
        sendCommand('openSettings', setting ? { setting } : {});
    };

    const handleReconnectWebSocket = () => {
        sendCommand('reconnectWebSocket');
    };

    // Check if chat is disabled
    const isChatDisabled = store.disabledMessage !== null || store.isNoAiDetected;

    // Determine disabled reason text
    let disabledBannerText: string | null = null;
    if (store.disabledMessage) {
        disabledBannerText = store.disabledMessage;
    } else if (store.isNoAiDetected) {
        disabledBannerText = 'AI assistance is disabled. A .noai file was detected in your workspace.';
    }

    // Check if workspace exercise exists
    const hasWorkspaceExercise = store.allExercises.some(ex => ex.isWorkspace);

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    {/* Iris bot icon */}
                    <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className={styles.irisIcon}
                    >
                        <circle
                            cx="12"
                            cy="12"
                            r="8"
                            stroke="var(--vscode-charts-purple)"
                            strokeWidth="2"
                        />
                        <circle
                            cx="9"
                            cy="10"
                            r="1.5"
                            fill="var(--vscode-charts-purple)"
                        />
                        <circle
                            cx="15"
                            cy="10"
                            r="1.5"
                            fill="var(--vscode-charts-purple)"
                        />
                        <path
                            d="M8 15c1 1.5 3 1.5 4 0s3-1.5 4 0"
                            stroke="var(--vscode-charts-purple)"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                    <h1 className={styles.title}>Chat with Iris</h1>
                </div>

                {/* Hamburger menu */}
                <div className={styles.headerRight} ref={sideMenuRef}>
                    <button
                        className={styles.menuButton}
                        onClick={() => setSideMenuOpen(!sideMenuOpen)}
                        aria-label="Menu"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path
                                d="M3 12h18M3 6h18M3 18h18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>

                    {sideMenuOpen && (
                        <div className={styles.sideMenu}>
                            <button
                                className={styles.menuItem}
                                onClick={handleResetSessions}
                            >
                                Reset & Sync Sessions
                            </button>
                            <button
                                className={styles.menuItem}
                                onClick={handleOpenHelp}
                            >
                                Chat Context Guide
                            </button>

                            {store.showDiagnostics && (
                                <>
                                    <button
                                        className={styles.menuItem}
                                        onClick={handleOpenDiagnostics}
                                    >
                                        Diagnostics
                                    </button>
                                    <button
                                        className={styles.menuItem}
                                        onClick={handleDebugSessions}
                                    >
                                        Debug Sessions (Raw)
                                    </button>
                                </>
                            )}

                            <div className={styles.menuDivider} />

                            <div className={styles.menuAbout}>
                                <strong>About</strong>
                                <p>Iris Chat — AI-powered guidance tailored to your Artemis coursework.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Context Selector */}
            <div className={styles.contextSection}>
                <ContextSelector
                    context={store.context}
                    sessions={store.sessions}
                    activeSessionId={store.activeSessionId}
                    recentExercises={store.recentExercises}
                    recentCourses={store.recentCourses}
                    allExercises={store.allExercises}
                    allCourses={store.allCourses}
                    onSelectContext={(type, id, title, shortName) => {
                        sendCommand('selectChatContext', { context: type, itemId: id, itemName: title, itemShortName: shortName });
                        setForceContextPicker(false);
                    }}
                    onSelectSession={(sessionId) => {
                        sendCommand('switchSession', { sessionId });
                    }}
                    onCreateNewSession={() => {
                        sendCommand('createNewSession');
                    }}
                    onSwitchToWorkspace={() => {
                        sendCommand('switchToWorkspaceContext');
                        setForceContextPicker(false);
                    }}
                    onSwitchContext={() => {
                        setForceContextPicker(true);
                    }}
                />
            </div>

            {/* Disabled banner (Iris not available or .noai detected) */}
            {disabledBannerText && (
                <div className={styles.disabledBanner}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span>{disabledBannerText}</span>
                </div>
            )}

            {/* WebSocket status banner */}
            {!store.isWebSocketConnected && (
                <div className={styles.websocketBanner}>
                    <span>WebSocket disconnected</span>
                    <button
                        className={styles.reconnectButton}
                        onClick={handleReconnectWebSocket}
                    >
                        Reconnect
                    </button>
                </div>
            )}

            {/* Message list with context switch animation */}
            <div className={clsx(styles.messagesSection, {
                [styles.contextSwitching]: contextSwitching
            })}>
                {contextSwitching ? (
                    // Skeleton placeholders during context switch
                    <div className={styles.skeletonContainer}>
                        <div className={clsx(styles.skeleton, styles.skeleton1)} />
                        <div className={clsx(styles.skeleton, styles.skeleton2)} />
                        <div className={clsx(styles.skeleton, styles.skeleton3)} />
                    </div>
                ) : (
                    <ChatMessageList
                        messages={store.messages}
                        streaming={store.streaming}
                        onFeedback={handleFeedback}
                        onSendPrompt={handleSendMessage}
                        hasContext={store.context !== null}
                    />
                )}
            </div>

            {/* Input section */}
            <div className={styles.inputSection}>
                {/* Referenced files */}
                <ReferencedFiles
                    files={store.referencedFiles}
                    onOpenFile={handleOpenFile}
                />

                {/* Chat input */}
                <ChatInput
                    onSend={handleSendMessage}
                    disabled={isChatDisabled || store.context === null}
                />

                {/* Disclaimer */}
                <div className={styles.disclaimer}>
                    Iris has access to your uncommitted changes (
                    <button
                        className={styles.disclaimerLink}
                        onClick={() => handleOpenSettings('artemis.iris.sendUncommittedChanges')}
                    >
                        configurable
                    </button>
                    ). Iris can make mistakes. Consider verifying important information.
                </div>
            </div>
        </div>
    );
}
