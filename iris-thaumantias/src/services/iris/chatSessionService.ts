import * as vscode from 'vscode';
import { ActiveContext, ApiError, type IrisChatMessage, type IrisSettingsResponse } from '../../types';
import type { IrisSessionManager } from './irisSessionManager';
import { extractIrisMessageContent } from './messageUtils';
import { logger, LogCategory } from '../loggingService';
import { ExtensionMsg } from '../../shared/messageContracts';
import { fetchSessionsWithMessages, importSessionsToStore } from './sessionSyncUtils';
import type { IrisServiceDeps } from './sessionSyncUtils';

export class IrisSessionInitService {
    private _contextLoadToken = 0;

    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _onSessionLoaded: () => Promise<void>,
        private readonly _onCreateNewSession: () => void,
    ) { }

    public get contextLoadToken(): number {
        return this._contextLoadToken;
    }

    public incrementLoadToken(): number {
        return ++this._contextLoadToken;
    }

    public isCurrentContext(expected: ActiveContext, loadToken: number): boolean {
        if (loadToken !== this._contextLoadToken) {
            return false;
        }
        const current = this.deps.contextStore.getActiveContext();
        return !!current && current.type === expected.type && current.id === expected.id;
    }

    public async checkAndLoadIrisSettings(context: ActiveContext): Promise<boolean> {
        if (!this.deps.artemisApiService) {
            logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
            return false;
        }

        try {
            logger.info(`Checking Iris settings for ${context.type}: ${context.title}`, LogCategory.IRIS_CHAT);

            // Step 1: Check if Iris is globally enabled (server profile)
            const profileInfo = await this.deps.artemisApiService.getProfileInfo();
            if (!this.deps.artemisApiService.isIrisProfileActive(profileInfo)) {
                logger.info('Iris profile not active on server (global check failed)', LogCategory.IRIS_CHAT);
                return false;
            }

            // Step 2: Fetch course-level settings based on context type
            let settings: IrisSettingsResponse;
            if (context.type === 'course') {
                settings = await this.deps.artemisApiService.getIrisCourseChatSettings(context.id);
            } else if (context.type === 'exercise') {
                const courseId = await this.resolveCourseIdForExercise(context);
                if (!courseId) {
                    logger.warn('Unable to resolve course for exercise context; cannot check Iris settings', LogCategory.IRIS_CHAT);
                    return false;
                }
                settings = await this.deps.artemisApiService.getIrisCourseChatSettings(courseId);
            } else {
                logger.warn(`Unsupported context type for Iris: ${context.type}`, LogCategory.IRIS_CHAT);
                return false;
            }

            // Check if Iris chat is enabled
            const chatSettings = settings?.settings;

            if (!chatSettings?.enabled) {
                logger.info('Iris chat is disabled in settings', LogCategory.IRIS_CHAT);
                return false;
            }

            logger.info('Iris chat is enabled, settings loaded:', LogCategory.IRIS_CHAT, {
                enabled: chatSettings.enabled,
                rateLimit: settings?.effectiveRateLimit?.requests,
                rateLimitTimeframeHours: settings?.effectiveRateLimit?.timeframeHours
            });

            return true;
        } catch (error: unknown) {
            logger.error('Error checking Iris settings:', LogCategory.IRIS_CHAT, error);

            // If it's a 403, Iris is probably disabled - return false to show disabled overlay
            if ((error instanceof ApiError && error.status === 403) || (error instanceof Error && error.message?.includes('403'))) {
                logger.info('Iris is not available (403 error)', LogCategory.IRIS_CHAT);
                return false;
            }

            // For other errors, log but still return false to show disabled state
            logger.info(`Could not load Iris settings: ${error instanceof Error ? error.message : String(error)}`, LogCategory.IRIS_CHAT);
            return false;
        }
    }

    private async resolveCourseIdForExercise(context: ActiveContext): Promise<number | undefined> {
        if (context.courseId) {
            return context.courseId;
        }

        const tracked = this.deps.contextStore.getExerciseById(context.id);
        if (tracked?.courseId) {
            return tracked.courseId;
        }

        try {
            const exerciseDetails = await this.deps.artemisApiService?.getExerciseDetails(context.id);
            const resolvedCourseId = exerciseDetails?.exercise?.course?.id;
            if (resolvedCourseId) {
                this.deps.contextStore.registerExercise({
                    id: context.id,
                    title: context.title,
                    shortName: context.shortName,
                    courseId: resolvedCourseId,
                });
            }
            return resolvedCourseId;
        } catch (error) {
            logger.warn('Failed to resolve course from exercise details:', LogCategory.IRIS_CHAT, error);
            return undefined;
        }
    }

    public async loadAllSessionsForContext(): Promise<void> {
        const activeContext = this.deps.contextStore.getActiveContext();

        logger.info('Starting loadAllSessionsForContext', LogCategory.SESSION);
        logger.info('Active context:', LogCategory.SESSION, activeContext);

        if (!activeContext || !this.deps.artemisApiService) {
            logger.info('Cannot load sessions: missing context or API service', LogCategory.SESSION, {
                hasContext: !!activeContext,
                hasApiService: !!this.deps.artemisApiService
            });
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = this.incrementLoadToken();

        logger.info('Target context for loading:', LogCategory.SESSION, targetContext);
        logger.info('Load token:', LogCategory.SESSION, loadToken);

        try {
            logger.info(`Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`, LogCategory.SESSION);

            // Step 0: Check if Iris is enabled for this context
            const isEnabled = await this.checkAndLoadIrisSettings(activeContext);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed while checking Iris settings, aborting load', LogCategory.IRIS_CHAT);
                return;
            }

            if (!isEnabled) {
                logger.info('Iris is disabled, not loading sessions', LogCategory.IRIS_CHAT);
                // Clear any existing sessions and show disabled overlay
                this.deps.postMessage({
                    type: ExtensionMsg.ClearChatMessages
                });
                const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
                this.deps.postMessage({
                    type: ExtensionMsg.ShowDisabledState,
                    message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
                });
                return;
            }

            // Hide disabled overlay if it was previously shown
            this.deps.postMessage({
                type: ExtensionMsg.HideDisabledState
            });

            // Step 1+2: Fetch sessions with messages using shared utility
            const sessionsFromServer = await fetchSessionsWithMessages(this.deps.artemisApiService, activeContext);

            logger.info(`Fetched ${sessionsFromServer.length} session(s) with messages from Artemis`, LogCategory.IRIS_CHAT);

            // CLEAR all existing sessions for this context to avoid stale data
            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed before clearing sessions, aborting load', LogCategory.IRIS_CHAT);
                return;
            }

            const contextKey = `${targetContext.type}:${targetContext.id}`;
            logger.info(`Clearing all existing sessions for context ${contextKey} before loading fresh data from Artemis`, LogCategory.IRIS_CHAT);
            this.deps.contextStore.clearSessionsForContext(contextKey);

            // Clear chat messages immediately after clearing sessions to avoid showing old messages
            this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

            // Import all sessions from Artemis using shared utility
            const importedCount = importSessionsToStore(sessionsFromServer, this.deps.contextStore);
            if (importedCount > 0) {
                logger.info(`Imported ${importedCount} sessions for ${activeContext.type} ${activeContext.id}`, LogCategory.IRIS_CHAT);
            }

            // Get the latest snapshot after importing sessions
            const updatedSnapshot = this.deps.contextStore.snapshot();

            // If there are sessions, switch to the first one and load its messages
            if (updatedSnapshot.sessions.length > 0) {
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.info('Context changed before switching to first session, aborting load', LogCategory.IRIS_CHAT);
                    return;
                }

                // Switch to the first (most recent) session
                this.deps.contextStore.switchToFirstSession();

                // Load messages for the first session
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.info('Context changed before loading messages, aborting load', LogCategory.IRIS_CHAT);
                    return;
                }

                await this._onSessionLoaded();
            } else {
                // No sessions exist, create a new one
                logger.info('No sessions found, creating a new one', LogCategory.IRIS_CHAT);
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.info('Context changed before creating new session, aborting load', LogCategory.IRIS_CHAT);
                    return;
                }
                this._onCreateNewSession();
            }

            // Post updated snapshot to show sessions in UI
            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed before posting snapshot, aborting load', LogCategory.IRIS_CHAT);
                return;
            }

            this.deps.postSnapshot();

        } catch (error: unknown) {
            logger.error('Error loading sessions for context:', LogCategory.SESSION, error);
            vscode.window.showWarningMessage(`Could not load sessions: ${error instanceof Error ? error.message : String(error)}`);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed during error handling, skipping fallback session creation', LogCategory.IRIS_CHAT);
                return;
            }

            // Fall back to creating a new session
            this._onCreateNewSession();
            this.deps.postSnapshot();
        }
    }

    public async initializeIrisSessionAndLoadMessages(
        context: ActiveContext,
        irisSessionManager: IrisSessionManager,
    ): Promise<void> {
        logger.info('initializeIrisSessionAndLoadMessages called', LogCategory.WEBSOCKET, {
            contextType: context.type,
            contextId: context.id,
            contextTitle: context.title
        });

        if (!this.deps.artemisApiService) {
            logger.error('No Artemis API service available', LogCategory.WEBSOCKET);
            return;
        }

        try {
            logger.info(`Initializing Iris session for ${context.type}: ${context.title} (ID: ${context.id})`, LogCategory.IRIS_CHAT);

            const snapshot = this.deps.contextStore.snapshot();
            const activeLocalSession = snapshot.activeSession;

            logger.info('Active local session:', LogCategory.IRIS_CHAT, {
                id: activeLocalSession?.id,
                messageCount: activeLocalSession?.messageCount,
                artemisSessionId: activeLocalSession?.artemisSessionId,
                createdAt: activeLocalSession?.createdAt ? new Date(activeLocalSession.createdAt).toISOString() : 'unknown'
            });

            const sessionId = await irisSessionManager.initializeSession(context, activeLocalSession?.artemisSessionId);

            if (!activeLocalSession?.artemisSessionId) {
                logger.info(`Storing NEW Artemis session ID mapping: ${sessionId}`, LogCategory.IRIS_CHAT);
                this.deps.contextStore.setArtemisSessionId(sessionId);
                this.deps.postSnapshot();
            }

            logger.info(`Iris session initialized with ID: ${sessionId}`, LogCategory.WEBSOCKET);

            logger.info(`Fetching messages for session: ${sessionId}`, LogCategory.IRIS_CHAT);
            const messages = await this.deps.artemisApiService.getChatMessages(sessionId);
            logger.info(`Received ${messages?.length || 0} messages from Iris`, LogCategory.IRIS_CHAT);

            if (activeLocalSession?.messageCount && activeLocalSession.messageCount > 0 &&
                (!messages || messages.length === 0)) {
                logger.warn(`Warning: Expected ${activeLocalSession.messageCount} messages but got none. Stored session might be stale.`, LogCategory.IRIS_CHAT);
                logger.warn('Clearing stale Artemis session ID mapping...', LogCategory.IRIS_CHAT);

                this.deps.contextStore.setArtemisSessionId(undefined);
                this.deps.postSnapshot();

                vscode.window.showWarningMessage(
                    'This conversation\'s messages could not be found on the server. They may have been deleted. The session mapping has been reset.',
                    'Create New Conversation'
                ).then(selection => {
                    if (selection === 'Create New Conversation') {
                        this._onCreateNewSession();
                    }
                });
            }

            if (messages && messages.length > 0) {
                logger.info('Sending messages to webview', LogCategory.IRIS_CHAT, messages);

                const formattedMessages = messages.map((msg: IrisChatMessage) => {
                    let content = extractIrisMessageContent(msg.content);
                    if (content === 'undefined' || content === 'null') {
                        const legacyMsg = msg as { message?: string };
                        if (typeof legacyMsg.message === 'string') {
                            content = legacyMsg.message;
                        }
                    }

                    return {
                        id: msg.id,
                        role: (msg.sender === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
                        content: content,
                        timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                        helpful: (msg as { helpful?: boolean | null }).helpful
                    };
                });

                this.deps.postMessage({
                    type: ExtensionMsg.LoadMessages,
                    messages: formattedMessages
                });
                logger.info('Messages sent to webview', LogCategory.IRIS_CHAT);
            } else {
                logger.info('No messages to load or view not ready', LogCategory.IRIS_CHAT);
            }

            vscode.window.showInformationMessage(`Connected to Iris for ${context.title}`);
        } catch (error: unknown) {
            logger.error('Error initializing Iris session', LogCategory.IRIS_CHAT, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to connect to Iris: ${errorMessage}`);
        }
    }
}
