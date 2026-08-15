import type * as vscode from 'vscode';

import type { ProactiveLevel } from '@shared/messageContracts';

import { type CourseAccessScope, normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';

const STORAGE_KEY_PREFIX = 'proactive.level';

const LEVELS: readonly ProactiveLevel[] = ['off', 'less', 'more'];

/**
 * Durable single proactive-help level (spec §12.2, Off/Less/More), stored in VS Code globalState
 * keyed by server + principal. The level is remembered ONCE per user, not per exercise: every
 * exercise reads the same value. Default is `more`, so proactive help exists without any setup.
 * Plain client service: imports NOTHING from services/struggle|intervention, so it stays in the
 * clean bundle. The legacy per-exercise map key (`proactive.preference::…`) is deliberately never
 * read or written, since that shape never shipped and there is nothing to migrate.
 */
export class ProactivePreferenceService {
    private readonly _shadow = new Map<string, ProactiveLevel>();
    private _writeChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    getLevel(): ProactiveLevel {
        const key = this._scopeKey();
        if (!key) { return 'more'; }
        const cached = this._shadow.get(key);
        if (cached) { return cached; }
        const level = this._validate(this._globalState.get<unknown>(key));
        this._shadow.set(key, level);
        return level;
    }

    setLevel(level: ProactiveLevel): void {
        const key = this._scopeKey();
        if (!key) { return; }
        // The shadow always holds the current level (incl. `more`) so a read right after this write is
        // correct even while the async persistence below is still queued.
        this._shadow.set(key, level);
        // Persist `off`/`less`; delete the key on `more` (keeps the "absent = default" convention).
        const persisted = level === 'more' ? undefined : level;
        this._writeChain = this._writeChain.catch(() => undefined)
            .then(() => this._globalState.update(key, persisted))
            .catch((err: unknown) => logger.warn('Failed to persist proactive level', LogCategory.VIEW, err));
    }

    isProactiveOn(): boolean {
        return this.getLevel() !== 'off';
    }

    /** globalState is runtime-untyped: accept only a valid level scalar, default everything else to `more`. */
    private _validate(v: unknown): ProactiveLevel {
        return typeof v === 'string' && (LEVELS as readonly string[]).includes(v) ? (v as ProactiveLevel) : 'more';
    }

    private _scopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        const segment = normalizeScopeSegment(scope);
        return segment ? `${STORAGE_KEY_PREFIX}::${segment}` : null;
    }
}
