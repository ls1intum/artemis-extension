import type * as vscode from 'vscode';

import { type CourseAccessScope, normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';

const STORAGE_KEY_PREFIX = 'proactive.preference';

/** Exercise id -> false (explicitly off). Default-on exercises are ABSENT (keeps the map small). */
type PreferenceMap = Record<number, false>;

/**
 * Durable per-exercise "proactive struggle help on/off" preference (spec §12.2), stored in VS Code globalState
 * keyed by server + principal. Default ON: a never-set exercise reads true. Plain client service — imports NOTHING
 * from services/struggle|intervention, so it stays in the clean bundle.
 */
export class ProactivePreferenceService {
    private readonly _shadow = new Map<string, PreferenceMap>();
    private _writeChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    isProactiveOn(exerciseId: number): boolean {
        const key = this._scopeKey();
        if (!key || !Number.isFinite(exerciseId)) { return true; }
        return this._map(key)[exerciseId] !== false;
    }

    setProactiveOn(exerciseId: number, on: boolean): void {
        const key = this._scopeKey();
        if (!key || !Number.isFinite(exerciseId)) { return; }
        const next: PreferenceMap = { ...this._map(key) };
        if (on) { delete next[exerciseId]; } else { next[exerciseId] = false; }
        this._shadow.set(key, next);
        const snapshot = { ...next };
        this._writeChain = this._writeChain.catch(() => undefined)
            .then(() => this._globalState.update(key, snapshot))
            .catch((err: unknown) => logger.warn('Failed to persist proactive preference', LogCategory.VIEW, err));
    }

    private _map(key: string): PreferenceMap {
        const cached = this._shadow.get(key);
        if (cached) { return cached; }
        const persisted = this._globalState.get<PreferenceMap>(key, {});
        const copy: PreferenceMap = {};
        for (const [id, v] of Object.entries(persisted)) {
            if (v === false && Number.isFinite(Number(id))) { copy[Number(id)] = false; }
        }
        this._shadow.set(key, copy);
        return copy;
    }

    private _scopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        const segment = normalizeScopeSegment(scope);
        return segment ? `${STORAGE_KEY_PREFIX}::${segment}` : null;
    }
}
