import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { ArtemisApiService } from '../api';
import { ActiveContext, ApiError, type IrisChatSession, type IrisChatMessage, type IrisSettingsResponse } from '../types';
import { logger, LogCategory } from './loggingService';
import type { ExtensionToWebviewMessage } from '../shared/messageContracts';

export class ChatSessionService {
    private _contextLoadToken = 0;

    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
        private readonly _onSessionLoaded: () => Promise<void>,
        private readonly _onCreateNewSession: () => void,
        private readonly _onPostSnapshot: () => void
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
        const current = this._contextStore.getActiveContext();
        return !!current && current.type === expected.type && current.id === expected.id;
    }

    public async checkAndLoadIrisSettings(context: ActiveContext): Promise<boolean> {
        if (!this._artemisApiService) {
            logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
            return false;
        }

        try {
            logger.irisChat(`Checking Iris settings for ${context.type}: ${context.title}`);

            // Step 1: Check if Iris is globally enabled (server profile)
            const profileInfo = await this._artemisApiService.getProfileInfo();
            if (!this._artemisApiService.isIrisProfileActive(profileInfo)) {
                logger.irisChat('Iris profile not active on server (global check failed)');
                return false;
            }

            // Step 2: Fetch course-level settings based on context type
            let settings: IrisSettingsResponse;
            if (context.type === 'course') {
                settings = await this._artemisApiService.getIrisCourseChatSettings(context.id);
            } else if (context.type === 'exercise') {
                const courseId = await this.resolveCourseIdForExercise(context);
                if (!courseId) {
                    logger.warn('Unable to resolve course for exercise context; cannot check Iris settings', LogCategory.IRIS_CHAT);
                    return false;
                }
                settings = await this._artemisApiService.getIrisCourseChatSettings(courseId);
            } else {
                logger.warn(`Unsupported context type for Iris: ${context.type}`, LogCategory.IRIS_CHAT);
                return false;
            }

            // Check if Iris chat is enabled
            const chatSettings = settings?.settings;

            if (!chatSettings?.enabled) {
                logger.irisChat('Iris chat is disabled in settings');
                return false;
            }

            logger.irisChat('Iris chat is enabled, settings loaded:', {
                enabled: chatSettings.enabled,
                rateLimit: settings?.effectiveRateLimit?.requests,
                rateLimitTimeframeHours: settings?.effectiveRateLimit?.timeframeHours
            });

            return true;
        } catch (error: unknown) {
            logger.error('Error checking Iris settings:', LogCategory.IRIS_CHAT, error);

            // If it's a 403, Iris is probably disabled - return false to show disabled overlay
            if ((error instanceof ApiError && error.status === 403) || (error instanceof Error && error.message?.includes('403'))) {
                logger.irisChat('Iris is not available (403 error)');
                return false;
            }

            // For other errors, log but still return false to show disabled state
            logger.irisChat(`Could not load Iris settings: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private async resolveCourseIdForExercise(context: ActiveContext): Promise<number | undefined> {
        if (context.courseId) {
            return context.courseId;
        }

        const tracked = this._contextStore.getExerciseById(context.id);
        if (tracked?.courseId) {
            return tracked.courseId;
        }

        try {
            const exerciseDetails = await this._artemisApiService?.getExerciseDetails(context.id);
            const resolvedCourseId = exerciseDetails?.exercise?.course?.id ?? exerciseDetails?.course?.id;
            if (resolvedCourseId) {
                this._contextStore.registerExercise({
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
        const activeContext = this._contextStore.getActiveContext();

        logger.session('Starting loadAllSessionsForContext');
        logger.session('Active context:', activeContext);

        if (!activeContext || !this._artemisApiService) {
            logger.session('Cannot load sessions: missing context or API service', {
                hasContext: !!activeContext,
                hasApiService: !!this._artemisApiService
            });
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = this.incrementLoadToken();

        logger.session('Target context for loading:', targetContext);
        logger.session('Load token:', loadToken);

        try {
            logger.session(`Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`);

            // Step 0: Check if Iris is enabled for this context
            const isEnabled = await this.checkAndLoadIrisSettings(activeContext);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.irisChat('Context changed while checking Iris settings, aborting load');
                return;
            }

            if (!isEnabled) {
                logger.irisChat('Iris is disabled, not loading sessions');
                // Clear any existing sessions and show disabled overlay
                this._postMessage({
                    type: 'clearChatMessages'
                });
                const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
                this._postMessage({
                    type: 'showDisabledState',
                    message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
                });
                return;
            }

            // Hide disabled overlay if it was previously shown
            this._postMessage({
                type: 'hideDisabledState'
            });

            // Step 1: Fetch session metadata (fast, lightweight)
            let artemisSessionsMetadata: IrisChatSession[] = [];
            if (activeContext.type === 'course') {
                artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
            } else {
                logger.irisChat(`Unsupported context type: ${activeContext.type}`);
                return;
            }

            logger.irisChat(`Fetched ${artemisSessionsMetadata.length} session(s) metadata from Artemis`);

            // Step 2: Fetch messages for each session (to display in list)
            const artemisSessionsListFromServer: IrisChatSession[] = await Promise.all(
                artemisSessionsMetadata.map(async (session) => {
                    if (!this._artemisApiService) {
                        return { ...session, messages: [] };
                    }
                    try {
                        logger.irisChat(`Fetching messages for session ${session.id}...`);
                        const messages = await this._artemisApiService.getChatMessages(session.id);
                        return {
                            ...session,
                            messages: messages
                        };
                    } catch (error) {
                        logger.warn(`Failed to fetch messages for session ${session.id}:`, LogCategory.IRIS_CHAT, error);
                        return {
                            ...session,
                            messages: []
                        };
                    }
                })
            );

            logger.irisChat(`Fetched messages for all ${artemisSessionsListFromServer.length} sessions`);

            // CLEAR all existing sessions for this context to avoid stale data
            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.irisChat('Context changed before clearing sessions, aborting load');
                return;
            }

            const contextKey = `${targetContext.type}:${targetContext.id}`;
            logger.irisChat(`Clearing all existing sessions for context ${contextKey} before loading fresh data from Artemis`);
            this._contextStore.clearSessionsForContext(contextKey);

            // Clear chat messages immediately after clearing sessions to avoid showing old messages
            this._postMessage({ type: 'clearChatMessages' });

            // Import all sessions from Artemis
            if (artemisSessionsListFromServer.length > 0) {
                // Sort sessions by creation date (newest first)
                artemisSessionsListFromServer.sort((a, b) => {
                    const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
                    const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
                    return dateB - dateA;
                });

                logger.irisChat(`Importing ${artemisSessionsListFromServer.length} sessions from Artemis`);

                for (const artemisSession of artemisSessionsListFromServer) {

                    if (!this.isCurrentContext(targetContext, loadToken)) {
                        logger.irisChat('Context changed while importing sessions, aborting load');
                        return;
                    }

                    // Create local session for each Artemis session
                    const messageCount = artemisSession.messages?.length || 0;
                    const createdAt = artemisSession.creationDate ? new Date(artemisSession.creationDate).getTime() : Date.now();

                    // Create preview from first user message or use default
                    let preview = 'New conversation';
                    if (artemisSession.messages && artemisSession.messages.length > 0) {
                        const firstUserMsg = artemisSession.messages.find((m: IrisChatMessage) => m.sender === 'USER');
                        if (firstUserMsg?.content?.[0]?.textContent) {
                            preview = firstUserMsg.content[0].textContent.substring(0, 50);
                        }
                    }

                    logger.irisChat(`Importing session ${artemisSession.id}: ${messageCount} messages, preview: "${preview}"`);

                    // Create local session with Artemis session ID and messages
                    this._contextStore.createSessionWithDetails(
                        preview,
                        messageCount,
                        createdAt,
                        artemisSession.id,
                        artemisSession.messages || []
                    );
                }

                logger.irisChat(`Imported ${artemisSessionsListFromServer.length} sessions for ${activeContext.type} ${activeContext.id}`);
            }

            // Get the latest snapshot after importing sessions
            const updatedSnapshot = this._contextStore.snapshot();

            // If there are sessions, switch to the first one and load its messages
            if (updatedSnapshot.sessions.length > 0) {
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.irisChat('Context changed before switching to first session, aborting load');
                    return;
                }

                // Switch to the first (most recent) session
                this._contextStore.switchToFirstSession();

                // Load messages for the first session
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.irisChat('Context changed before loading messages, aborting load');
                    return;
                }

                await this._onSessionLoaded();
            } else {
                // No sessions exist, create a new one
                logger.irisChat('No sessions found, creating a new one');
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.irisChat('Context changed before creating new session, aborting load');
                    return;
                }
                this._contextStore.createSession();
                this._onCreateNewSession();
            }

            // Post updated snapshot to show sessions in UI
            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.irisChat('Context changed before posting snapshot, aborting load');
                return;
            }

            this._onPostSnapshot();

        } catch (error: unknown) {
            logger.error('Error loading sessions for context:', LogCategory.SESSION, error);
            vscode.window.showWarningMessage(`Could not load sessions: ${error instanceof Error ? error.message : String(error)}`);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.irisChat('Context changed during error handling, skipping fallback session creation');
                return;
            }

            // Fall back to creating a new session
            this._contextStore.createSession();
            this._onCreateNewSession();
            this._onPostSnapshot();
        }
    }
}
