import * as vscode from 'vscode';
import type { StoredState } from './contextStateTypes';
import { logger } from '../loggingService';

const STORE_KEY = 'iris.contextStore';
const STORE_VERSION = 1;

export class ContextPersistence {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    public load(): StoredState {
        const raw = this._context.globalState.get<StoredState>(STORE_KEY);
        if (!raw) {
            return this.defaultState();
        }
        if (raw.version !== STORE_VERSION) {
            return this.migrate(raw);
        }
        // Don't load sessions from storage - always start fresh
        return {
            ...raw,
            sessions: {},
            activeSessionId: null,
        };
    }

    public save(state: StoredState): void {
        // Don't persist sessions and activeSessionId - only save exercise/course tracking
        const stateToPersist: StoredState = {
            ...state,
            sessions: {}, // Never persist sessions
            activeSessionId: null, // Never persist active session
        };
        this._context.globalState.update(STORE_KEY, stateToPersist).then(undefined, (err: unknown) => logger.error('Failed to persist state', undefined, err));
    }

    private migrate(previous: StoredState): StoredState {
        return {
            version: STORE_VERSION,
            activeContext: previous.activeContext ?? null,
            activeSessionId: previous.activeSessionId ?? null,
            recentExercises: previous.recentExercises ?? [],
            recentCourses: previous.recentCourses ?? [],
            allExercises: previous.allExercises ?? [],
            allCourses: previous.allCourses ?? [],
            sessions: previous.sessions ?? {},
        };
    }

    private defaultState(): StoredState {
        return {
            version: STORE_VERSION,
            activeContext: null,
            activeSessionId: null,
            recentExercises: [],
            recentCourses: [],
            allExercises: [],
            allCourses: [],
            sessions: {},
        };
    }
}
