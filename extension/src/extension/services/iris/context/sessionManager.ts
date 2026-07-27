import type { ActiveContext, ChatContextType, StoredSession } from '@extension/types';

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
        /**
         * Task 12: reports the context key(s) affected by a session mutation
         * so `ContextStore` can fire `onDidChangeSessions` and consumers
         * (the course-history cache) can invalidate precisely. Threaded the
         * same way as `_saveState` above.
         */
        private readonly _fireSessionsChanged: (contextKeys: string[]) => void,
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
        this._fireSessionsChanged([key]);
    }

    public createSessionWithDetails(
        preview: string,
        messageCount: number,
        createdAt: number,
        artemisSessionId?: number,
        title?: string,
        lastActivity?: number,
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
            lastActivity: lastActivity ?? createdAt,
            artemisSessionId,
        };
        const sessions = state.sessions[key] ?? [];
        state.sessions[key] = [session, ...sessions];
        this._saveState();
        this._fireSessionsChanged([key]);
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
        this._fireSessionsChanged([key]);
    }

    /**
     * Overwrite the active session's `messageCount` with the authoritative
     * count of messages actually loaded from the server. The overview endpoint
     * carries no message counts, so `upsertSessionFromOverview` seeds a new
     * session with `messageCount: 0`; once its messages load, this corrects it
     * so the UI (and `cleanupEmptySessions`) reflect reality. Unlike
     * `incrementActiveSessionMessageCount`, this is an absolute set (not a +1)
     * and does NOT touch `lastActivity`: a history load is not new activity.
     */
    public setActiveSessionMessageCount(count: number): void {
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
        session.messageCount = count;
        this._saveState();
        this._fireSessionsChanged([key]);
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

        // Keep only sessions with messages, the active session, OR sessions backed by a real
        // Artemis session id. A local messageCount of 0 does not mean the server-side session
        // is empty (e.g. upsertSessionFromOverview creates/rehomes sessions before their message
        // count is known locally); only untouched local drafts (no artemisSessionId, no messages,
        // not active) are eligible for pruning.
        const activeSessionId = state.activeSessionId;
        const filteredSessions = sessions.filter(
            session => session.messageCount > 0
                || session.id === activeSessionId
                || session.artemisSessionId !== undefined
        );

        // Update state if we removed any sessions
        if (filteredSessions.length !== sessions.length) {
            state.sessions[key] = filteredSessions;
            this._saveState();
        }
    }

    public updateSessionTitle(artemisSessionId: number, title: string): boolean {
        const state = this._getState();
        for (const [key, sessions] of Object.entries(state.sessions)) {
            const session = sessions.find(s => s.artemisSessionId === artemisSessionId);
            if (session) {
                session.title = title;
                this._saveState();
                this._fireSessionsChanged([key]);
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

    /**
     * Idempotent, cross-context upsert keyed by `artemisSessionId`. Scans every context's
     * session array for an existing match: if found under `contextKey`, updates title/lastActivity
     * in place; if found under a different key, rehomes it (delete-then-insert) so that
     * `switchSession` (which only searches the active context) can select it; if not found,
     * creates a new session under `contextKey`. Any pre-existing duplicates of the same
     * `artemisSessionId` are collapsed to one. Returns the local session id.
     */
    public upsertSessionFromOverview(entry: {
        contextKey: string;
        artemisSessionId: number;
        title?: string;
        lastActivity: number;
    }): string {
        const { contextKey, artemisSessionId, title, lastActivity } = entry;
        const state = this._getState();

        let existing: StoredSession | undefined;
        let existingKey: string | undefined;

        // Remove every matching session from every context array (collapsing duplicates),
        // keeping the first match found so its id/preview/createdAt survive the rehome.
        for (const key of Object.keys(state.sessions)) {
            const sessions = state.sessions[key];
            const remaining: StoredSession[] = [];
            for (const session of sessions) {
                if (session.artemisSessionId === artemisSessionId) {
                    if (existing === undefined) {
                        existing = session;
                        existingKey = key;
                    }
                } else {
                    remaining.push(session);
                }
            }
            if (remaining.length !== sessions.length) {
                state.sessions[key] = remaining;
            }
        }

        // Task 12: report both the old and new context key when this rehomes a
        // session out of a different context; otherwise just the (single) key
        // that was actually touched.
        const rehomed = existing !== undefined && existingKey !== contextKey;
        const changedKeys = rehomed ? [existingKey!, contextKey] : [contextKey];

        const target = state.sessions[contextKey] ?? [];
        if (existing) {
            const updated: StoredSession = {
                ...existing,
                contextKey,
                title: title ?? existing.title,
                lastActivity,
            };
            state.sessions[contextKey] = [updated, ...target];
            this._saveState();
            this._fireSessionsChanged(changedKeys);
            return updated.id;
        }

        const session: StoredSession = {
            id: `session-${artemisSessionId}`,
            contextKey,
            preview: title ?? 'New conversation',
            title,
            messageCount: 0,
            createdAt: lastActivity,
            lastActivity,
            artemisSessionId,
        };
        state.sessions[contextKey] = [session, ...target];
        this._saveState();
        this._fireSessionsChanged(changedKeys);
        return session.id;
    }

    /**
     * The `artemisSessionId` of the session the RAW `state.activeSessionId`
     * points at within the active context. Deliberately does NOT use the
     * `ContextSnapshot.activeSession` display fallback (`sessions.find(...)
     * ?? sessions[0]`), which would turn "no explicit selection" (null id)
     * into "the newest session" and defeat the #364 A0 preserve-selection
     * policy. Returns `undefined` when there is no active context, the raw
     * id is null, or it does not resolve to a session in the active context.
     */
    public getActiveArtemisSessionId(): number | undefined {
        const active = this._getActiveContext();
        if (!active) {
            return undefined;
        }
        const state = this._getState();
        if (state.activeSessionId === null) {
            return undefined;
        }
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key] ?? [];
        const session = sessions.find(s => s.id === state.activeSessionId);
        return session?.artemisSessionId;
    }

    /**
     * Sets active the (post-import) local session in the active context that
     * carries `artemisSessionId`. Used by the #364 A0 refresh policy to
     * re-select a previously-active session after a re-import assigns it a
     * new local id. Returns `false` (no-op) when there is no active context
     * or no session carries that id.
     */
    public selectByArtemisSessionId(artemisSessionId: number): boolean {
        const active = this._getActiveContext();
        if (!active) {
            return false;
        }
        const state = this._getState();
        const key = getContextKey(active.type, active.id);
        const sessions = state.sessions[key] ?? [];
        const session = sessions.find(s => s.artemisSessionId === artemisSessionId);
        if (!session) {
            return false;
        }
        state.activeSessionId = session.id;
        this._saveState();
        return true;
    }

    public clearAllSessions(): void {
        const state = this._getState();
        // Clear all session data but keep exercises and courses
        state.sessions = {};
        state.activeSessionId = null;
        this._saveState();
    }
}
