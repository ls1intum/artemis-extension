import type * as vscode from 'vscode';

import { type CourseAccessScope, normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';

type StaleAnswer = 'solved' | 'still-on-it' | 'something-else';

/** Per-message record: `ts` orders eviction, `answer` is the student's quick-reply if any. */
interface Entry { ts: number; answer?: StaleAnswer; }
type StaleCheckMap = Record<number, Entry>;

const STORAGE_KEY_PREFIX = 'iris.staleChecks';
export const STALE_CHECK_STORAGE_LIMIT = 200;

/**
 * Extension-local record of which proactive rows are stale-checks and how they were answered.
 * Keyed by Artemis messageId, scoped by server+principal, bounded (evict oldest). This is the
 * Route B persistence: it lets a reloaded episode keep its differentiated check-in without any
 * Artemis DB or contract change. Only stale-checks are stored; a proactive row absent from the
 * map is a hint.
 */
export class StaleCheckStore {
    private readonly _shadow = new Map<string, StaleCheckMap>();
    private _writeChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    public recordKind(messageId: number): void { this._upsert(messageId, undefined); }
    public recordAnswer(messageId: number, answer: StaleAnswer): void { this._upsert(messageId, answer); }

    public lookup(messageId: number): { isStaleCheck: true; answer?: StaleAnswer } | undefined {
        const key = this._scopeKey();
        if (!key) { return undefined; }
        const entry = this._map(key)[messageId];
        return entry ? { isStaleCheck: true, answer: entry.answer } : undefined;
    }

    private _upsert(messageId: number, answer: StaleAnswer | undefined): void {
        if (!Number.isFinite(messageId)) { return; }
        const key = this._scopeKey();
        if (!key) { return; }
        const map = this._map(key);
        const prev = map[messageId];
        const next: StaleCheckMap = { ...map, [messageId]: { ts: Date.now(), answer: answer ?? prev?.answer } };

        const ids = Object.keys(next);
        if (ids.length > STALE_CHECK_STORAGE_LIMIT) {
            let oldest = ids[0]!;
            for (const id of ids) { if (next[Number(id)]!.ts < next[Number(oldest)]!.ts) { oldest = id; } }
            delete next[Number(oldest)];
        }

        this._shadow.set(key, next);
        const snapshot = { ...next };
        this._writeChain = this._writeChain
            .catch(() => undefined)
            .then(() => this._globalState.update(key, snapshot))
            .catch((err: unknown) => logger.warn('Failed to persist stale-check store', LogCategory.IRIS_CHAT, err));
    }

    private _scopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        const segment = normalizeScopeSegment(scope);
        return segment ? `${STORAGE_KEY_PREFIX}::${segment}` : null;
    }

    private _map(key: string): StaleCheckMap {
        const cached = this._shadow.get(key);
        if (cached) { return cached; }
        const persisted = this._globalState.get<StaleCheckMap>(key, {});
        const copy: StaleCheckMap = {};
        for (const [id, e] of Object.entries(persisted)) {
            const idNum = Number(id);
            if (Number.isFinite(idNum) && e && typeof (e as Entry).ts === 'number') { copy[idNum] = e as Entry; }
        }
        this._shadow.set(key, copy);
        return copy;
    }
}
