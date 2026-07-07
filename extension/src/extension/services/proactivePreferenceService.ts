import type * as vscode from 'vscode';

import type { ProactiveLevel } from '@shared/messageContracts';

import { type CourseAccessScope, normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';

const STORAGE_KEY_PREFIX = 'proactive.preference';

/** Exercise id -> deviation from the `more` default. Default-level exercises are ABSENT (keeps the map small). */
type PreferenceMap = Record<number, 'less' | 'off'>;

/**
 * Durable per-exercise proactive-help level (spec §12.2), stored in VS Code globalState keyed by
 * server + principal. Default level is `more`: a never-set exercise reads `more`, and only `less`/`off`
 * deviations are persisted. Plain client service — imports NOTHING from services/struggle|intervention,
 * so it stays in the clean bundle.
 */
export class ProactivePreferenceService {
    private readonly _shadow = new Map<string, PreferenceMap>();
    private _writeChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    getLevel(exerciseId: number): ProactiveLevel {
        const key = this._scopeKey();
        if (!key || !Number.isFinite(exerciseId)) { return 'more'; }
        return this._map(key)[exerciseId] ?? 'more';
    }

    setLevel(exerciseId: number, level: ProactiveLevel): void {
        const key = this._scopeKey();
        if (!key || !Number.isFinite(exerciseId)) { return; }
        const next: PreferenceMap = { ...this._map(key) };
        if (level === 'more') { delete next[exerciseId]; } else { next[exerciseId] = level; }
        this._shadow.set(key, next);
        const snapshot = { ...next };
        this._writeChain = this._writeChain.catch(() => undefined)
            .then(() => this._globalState.update(key, snapshot))
            .catch((err: unknown) => logger.warn('Failed to persist proactive preference', LogCategory.VIEW, err));
    }

    isProactiveOn(exerciseId: number): boolean {
        return this.getLevel(exerciseId) !== 'off';
    }

    /**
     * Boolean adapter kept for the existing on/off command wiring (`proactiveControlCommands.ts`), which
     * this task does not touch. `on` maps to the `more` default, `off` to the `off` level.
     */
    setProactiveOn(exerciseId: number, on: boolean): void {
        this.setLevel(exerciseId, on ? 'more' : 'off');
    }

    private _map(key: string): PreferenceMap {
        const cached = this._shadow.get(key);
        if (cached) { return cached; }
        const persisted = this._globalState.get<Record<number, unknown>>(key, {});
        const copy: PreferenceMap = {};
        for (const [id, v] of Object.entries(persisted)) {
            const numId = Number(id);
            if (!Number.isFinite(numId)) { continue; }
            const level = this._normalizeLegacy(v);
            if (level !== 'more') { copy[numId] = level; }
        }
        this._shadow.set(key, copy);
        return copy;
    }

    /** Legacy `false` (pre-level boolean store) -> `off`; valid level strings kept; anything else -> `more` (the default). */
    private _normalizeLegacy(v: unknown): ProactiveLevel {
        if (v === false) { return 'off'; }
        if (v === 'off' || v === 'less') { return v; }
        return 'more';
    }

    private _scopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        const segment = normalizeScopeSegment(scope);
        return segment ? `${STORAGE_KEY_PREFIX}::${segment}` : null;
    }
}
