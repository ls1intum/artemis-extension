import type { StoredSession, ActiveContext, ChatContextType, IrisChatMessage } from '../../../types';

const SESSION_KEY_SEPARATOR = ':';

function getContextKey(type: ChatContextType, id: number): string {
    return `${type}${SESSION_KEY_SEPARATOR}${id}`;
}

function byLastActivityDesc(a: { lastActivity: number }, b: { lastActivity: number }): number {
    return b.lastActivity - a.lastActivity;
}

function now(): number {
    return Date.now();
}

interface SessionState {
    sessions: Record<string, StoredSession[]>;
    activeSessionId: string | null;
}

export class SessionManager {
    constructor(
        private readonly _getState: () => SessionState,
        private readonly _getActiveContext: () => ActiveContext | null,
        private readonly _saveState: () => void,
    ) {}

    public createSession(preview = 'New conversation'): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }

        // Clean up empty sessions before creating a new one
        this.cleanupEmptySessions();

        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const session: StoredSession = {
            id: `session-${crypto.randomUUID()}`,
            contextKey: key,
            preview,
            messageCount: 0,
            createdAt: now(),
            lastActivity: now(),
        };
        const sessions = state.sessions[key] ?? [];
        state.sessions[key] = [session, ...sessions];
        state.activeSessionId = session.id;
        this._saveState();
    }

    public createSessionWithDetails(
        preview: string,
        messageCount: number,
        createdAt: number,
        artemisSessionId?: number,
        _messages?: IrisChatMessage[],
        title?: string,
    ): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }

        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const session: StoredSession = {
            id: `session-${artemisSessionId ?? crypto.randomUUID()}`,
            contextKey: key,
            preview,
            title,
            messageCount,
            createdAt,
            lastActivity: createdAt,
            artemisSessionId,
        };
        const sessions = state.sessions[key] ?? [];
        state.sessions[key] = [session, ...sessions];
        this._saveState();
    }

    public switchSession(sessionId: string): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }

        // Clean up empty sessions when switching
        this.cleanupEmptySessions();

        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key] ?? [];
        if (sessions.some(session => session.id === sessionId)) {
            state.activeSessionId = sessionId;
            this._saveState();
        }
    }

    public switchToFirstSession(): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }

        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key] ?? [];
        if (sessions.length > 0) {
            const sortedSessions = [...sessions].sort(byLastActivityDesc);
            state.activeSessionId = sortedSessions[0].id;
            this._saveState();
        }
    }

    public clearSessionsForContext(contextKey: string): void {
        const active = this._getActiveContext();
        const state = this._getState();
        const activeContextKey = active ? getContextKey(active.type, active.id) : null;
        const shouldClearActiveSession = activeContextKey === contextKey && state.activeSessionId !== null;

        // Remove all sessions for the specified context
        delete state.sessions[contextKey];

        if (shouldClearActiveSession) {
            state.activeSessionId = null;
        }

        this._saveState();
    }

    public incrementActiveSessionMessageCount(): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }
        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key];
        if (!sessions || sessions.length === 0) {
            return;
        }
        const session =
            sessions.find(s => s.id === state.activeSessionId) ?? sessions[0];
        session.messageCount += 1;
        session.lastActivity = now();
        state.activeSessionId = session.id;
        this._saveState();
    }

    public cleanupEmptySessions(): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }
        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key];
        if (!sessions || sessions.length === 0) {
            return;
        }

        // Keep only sessions with messages OR the active session
        const activeSessionId = state.activeSessionId;
        const filteredSessions = sessions.filter(
            session => session.messageCount > 0 || session.id === activeSessionId
        );

        // Update state if we removed any sessions
        if (filteredSessions.length !== sessions.length) {
            state.sessions[key] = filteredSessions;
            this._saveState();
        }
    }

    public updateSessionTitle(artemisSessionId: number, title: string): boolean {
        const state = this._getState();
        for (const sessions of Object.values(state.sessions)) {
            const session = sessions.find(s => s.artemisSessionId === artemisSessionId);
            if (session) {
                session.title = title;
                this._saveState();
                return true;
            }
        }
        return false;
    }

    public setArtemisSessionId(artemisSessionId: number | undefined): void {
        const active = this._getActiveContext();
        if (!active) {
            return;
        }
        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key];
        if (!sessions || sessions.length === 0) {
            return;
        }
        const session = sessions.find(s => s.id === state.activeSessionId) ?? sessions[0];
        session.artemisSessionId = artemisSessionId;
        this._saveState();
    }

    public clearAllSessions(): void {
        const state = this._getState();
        // Clear all session data but keep exercises and courses
        state.sessions = {};
        state.activeSessionId = null;
        this._saveState();
    }
}
