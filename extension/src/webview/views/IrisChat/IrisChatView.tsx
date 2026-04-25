import { useEffect, useState, useRef, useMemo } from 'react';
import { ExtensionMsg, postCommand } from '../../../shared/messageContracts';
import type { VsCodeApi } from '../../../shared/messageContracts';
import type { IrisStageDTO } from './types';
import { useChatStore } from '../../stores/useChatStore';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import { useClickOutside } from '../../hooks/useClickOutside';
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
    const {
        setIrisState, setShowDiagnostics, addMessage,
        applyLoadedMessages, setMessageLoadError,
        clearMessages, setReferencedFiles, setWebSocketStatus,
        setDisabledMessage, setNoAiDetected, setIrisStages, resetTransientChatUi,
    } = store;
    const [sideMenuOpen, setSideMenuOpen] = useState(false);
    const [forceContextPicker, setForceContextPicker] = useState(false);
    const [contextSwitching, setContextSwitching] = useState(false);
    const previousContextId = useRef<number | null>(null);
    const sideMenuRef = useRef<HTMLDivElement>(null);

    // Close side menu when clicking outside
    useClickOutside(sideMenuRef, sideMenuOpen, () => setSideMenuOpen(false));

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

    // Message listener - handles messages from extension
    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.UpdateIrisState: {
                setIrisState(msg.state);
                if (msg.showDiagnostics !== undefined) {
                    setShowDiagnostics(msg.showDiagnostics);
                }
                break;
            }

            case ExtensionMsg.ShowContextPicker: {
                setIrisState(msg.state);
                setForceContextPicker(true);
                break;
            }

            case ExtensionMsg.AddMessage: {
                const m = msg.message;
                addMessage({
                    id: m.id,
                    localId: crypto.randomUUID(),
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                    helpful: m.helpful ?? null,
                    status: 'sent',
                });
                if (m.role === 'assistant') {
                    resetTransientChatUi();
                }
                break;
            }

            case ExtensionMsg.LoadMessages: {
                // Discard any load that does not match the currently active
                // local session. This covers the obvious "user switched
                // sessions while a load was in flight" case AND the subtler
                // one where there is no active session at all (clearMessages,
                // never-selected, etc.) — in both we must not mutate the
                // store with a payload the user has navigated away from.
                const currentSessionId = useChatStore.getState().activeSessionId;
                if (currentSessionId !== msg.localSessionId) {
                    break;
                }
                resetTransientChatUi();
                applyLoadedMessages(
                    msg.localSessionId,
                    msg.messages.map((m) => ({
                        id: m.id,
                        localId: crypto.randomUUID(),
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp,
                        helpful: m.helpful ?? null,
                        status: 'sent' as const,
                    })),
                );
                break;
            }

            case ExtensionMsg.LoadMessagesError: {
                const currentSessionId = useChatStore.getState().activeSessionId;
                if (currentSessionId !== msg.localSessionId) {
                    break;
                }
                setMessageLoadError(msg.localSessionId);
                break;
            }

            case ExtensionMsg.ClearChatMessages:
                clearMessages();
                break;

            case ExtensionMsg.UpdateReferencedFiles: {
                setReferencedFiles({
                    includedFiles: msg.includedFiles,
                    excludedFiles: msg.excludedFiles,
                    totalCount: msg.totalCount,
                });
                break;
            }

            case ExtensionMsg.UpdateWebSocketStatus: {
                setWebSocketStatus(msg.status);
                if (msg.status !== 'connected') {
                    resetTransientChatUi();
                }
                break;
            }

            case ExtensionMsg.ShowDisabledState: {
                setDisabledMessage(msg.message);
                break;
            }

            case ExtensionMsg.HideDisabledState:
                setDisabledMessage(null);
                break;

            case ExtensionMsg.UpdateNoAiStatus: {
                setNoAiDetected(msg.isNoAiDetected);
                break;
            }

            case ExtensionMsg.UpdateIrisStages: {
                setIrisStages(msg.stages);
                break;
            }
        }
    }, [setIrisState, setShowDiagnostics, addMessage, applyLoadedMessages, setMessageLoadError, clearMessages, setReferencedFiles, setWebSocketStatus, setDisabledMessage, setNoAiDetected, setIrisStages, resetTransientChatUi]);

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

    const handleSendMessage = (text: string) => {
        const localId = crypto.randomUUID();

        // Clear any stale stages/streaming from previous request
        resetTransientChatUi();

        // Add optimistic message
        store.addMessage({
            localId,
            role: 'user',
            content: text,
            timestamp: Date.now(),
            status: 'sending',
        });

        // Start streaming state (thinking indicator will show)
        store.startStreaming('__thinking__');

        // Send to extension
        postCommand(vscodeApi, 'sendMessage', { text });
    };

    const handleFeedback = (messageId: number, feedback: 'positive' | 'negative') => {
        const activeSession = store.sessions.find(s => s.id === store.activeSessionId);
        if (typeof activeSession?.artemisSessionId !== 'number') {return;}
        postCommand(vscodeApi, 'messageFeedback', {
            sessionId: activeSession.artemisSessionId,
            messageId,
            feedback,
        });
    };

    const handleOpenFile = (path: string) => {
        postCommand(vscodeApi, 'openFile', { filePath: path });
    };

    const handleResetSessions = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'resetChatSessions');
    };

    const handleOpenHelp = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'openHelpPopup');
    };

    const handleOpenDiagnostics = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'openDiagnostics');
    };

    const handleDebugSessions = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'debugSessions');
    };

    const handleOpenSettings = (setting?: string) => {
        postCommand(vscodeApi, 'openSettings', { setting: setting ?? 'Artemis' });
    };

    const handleReconnectWebSocket = () => {
        postCommand(vscodeApi, 'reconnectWebSocket');
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

    // Compute disabled placeholder for input. Order matters: real
    // unavailability ('no context', '.noai', explicit disabled) wins over
    // the transient 'loading' state — we only fall through to 'Loading…'
    // when the chat is otherwise usable but still waiting for hydration.
    let disabledPlaceholder: string | undefined;
    if (store.context === null) {
        disabledPlaceholder = 'Select a course or exercise to start chatting';
    } else if (store.isNoAiDetected) {
        disabledPlaceholder = 'AI assistance is disabled (.noai detected)';
    } else if (store.disabledMessage) {
        disabledPlaceholder = 'Iris chat is not available for this exercise';
    }

    // Check if workspace exercise exists
    const hasWorkspaceExercise = store.allExercises.some(ex => ex.isWorkspace);

    // Derive active stage: first stage that is not DONE or SKIPPED.
    // NOT_STARTED is intentionally included: it shows dots immediately while
    // Artemis transitions the stage to IN_PROGRESS (provides instant feedback).
    const activeStage = useMemo<IrisStageDTO | null>(
        () => store.irisStages.find(s => s.state !== 'DONE' && s.state !== 'SKIPPED') ?? null,
        [store.irisStages],
    );

    // Track whether the message list for the *currently active* session has
    // been hydrated. We key on the local session UUID rather than the
    // Artemis server session id because new sessions have a UUID
    // immediately but no server id until the create round-trip returns.
    // While there is no active session at all (e.g. no context selected
    // yet), there is nothing to load and we treat that as hydrated.
    const messagesHydrated =
        store.activeSessionId === null
        || (store.messageLoad !== null
            && store.messageLoad.localSessionId === store.activeSessionId
            && store.messageLoad.status === 'success');
    const messagesErrored =
        store.activeSessionId !== null
        && store.messageLoad !== null
        && store.messageLoad.localSessionId === store.activeSessionId
        && store.messageLoad.status === 'error';
    const messagesLoading = !messagesHydrated && !messagesErrored;

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    {/* Iris logo */}
                    <img
                        src={document.getElementById('root')?.dataset.irisLogoUri}
                        alt=""
                        width="24"
                        height="24"
                        className={styles.irisIcon}
                    />
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
                    forceContextPicker={forceContextPicker}
                    onSelectContext={(type, id, title, shortName) => {
                        postCommand(vscodeApi, 'selectChatContext', { context: type, itemId: id, itemName: title, itemShortName: shortName });
                        setForceContextPicker(false);
                    }}
                    onSelectSession={(sessionId) => {
                        postCommand(vscodeApi, 'switchSession', { sessionId });
                    }}
                    onCreateNewSession={() => {
                        postCommand(vscodeApi, 'createNewSession');
                    }}
                    onSwitchToWorkspace={() => {
                        postCommand(vscodeApi, 'switchToWorkspaceContext');
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

            {/* WebSocket status banner: shown when the connection is in a
                terminal state the user must act on (retries exhausted, or
                client torn down without a pending retry). Transient states
                ('connecting', 'reconnecting') and the pre-init 'unknown'
                state suppress the banner — the status bar already surfaces
                that detail. */}
            {store.webSocketStatus === 'disconnected' && !isChatDisabled && (
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

            {/* Message list with context-switch animation and hydration skeleton.
                Hierarchy: error UI > skeleton (context-switch animation OR
                pending hydration) > populated/welcome list. */}
            <div className={clsx(styles.messagesSection, {
                [styles.contextSwitching]: contextSwitching
            })}>
                {messagesErrored ? (
                    <div className={styles.skeletonContainer}>
                        <div className={styles.loadError} role="alert">
                            Failed to load chat history. Try selecting the
                            session again or reconnecting.
                        </div>
                    </div>
                ) : (contextSwitching || messagesLoading) ? (
                    <div className={styles.skeletonContainer}>
                        <div className={clsx(styles.skeleton, styles.skeleton1)} />
                        <div className={clsx(styles.skeleton, styles.skeleton2)} />
                        <div className={clsx(styles.skeleton, styles.skeleton3)} />
                    </div>
                ) : (
                    <ChatMessageList
                        messages={store.messages}
                        streaming={store.streaming}
                        activeStage={activeStage}
                        onFeedback={handleFeedback}
                        onSendPrompt={handleSendMessage}
                        hasContext={store.context !== null}
                        isChatDisabled={isChatDisabled}
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

                {/* Chat input — disabled while we are still hydrating the
                    message list so a fast user does not race the load and
                    have their just-sent message swallowed when the server
                    snapshot arrives. */}
                <ChatInput
                    onSend={handleSendMessage}
                    disabled={isChatDisabled || store.context === null || messagesLoading}
                    disabledPlaceholder={
                        disabledPlaceholder
                        ?? (messagesLoading ? 'Loading conversation…' : undefined)
                    }
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
                    ). Iris can make mistakes.
                </div>
            </div>
        </div>
    );
}
