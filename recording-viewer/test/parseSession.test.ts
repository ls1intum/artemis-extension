import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseEventsFile, parseMetadataFile, resolveSchemaVersion } from '../src/parseSession.ts';
import type { SessionStartEvent } from '../src/types.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures/recordings');

function readFixture(name: string, file: string): string {
    return readFileSync(join(FIXTURES, name, file), 'utf-8');
}

// ── resolveSchemaVersion ───────────────────────────────────────────────────────

describe('resolveSchemaVersion', () => {
    it('returns metadata.schemaVersion when present (highest precedence)', () => {
        const meta = { sessionId: 's', exerciseId: 1, participantId: undefined, startTime: 0, endTime: undefined, eventCount: 0, schemaVersion: 2 };
        const start: SessionStartEvent = { type: 'sessionStart', timestamp: 0, exerciseId: 1, participantId: undefined, schemaVersion: 1 };
        expect(resolveSchemaVersion(meta, start)).toBe(2);
    });

    it('falls back to sessionStart.schemaVersion when metadata has no version', () => {
        const meta = { sessionId: 's', exerciseId: 1, participantId: undefined, startTime: 0, endTime: undefined, eventCount: 0 };
        const start: SessionStartEvent = { type: 'sessionStart', timestamp: 0, exerciseId: 1, participantId: undefined, schemaVersion: 2 };
        expect(resolveSchemaVersion(meta, start)).toBe(2);
    });

    it('returns 1 (legacy) when neither metadata nor sessionStart carries a version', () => {
        const meta = { sessionId: 's', exerciseId: 1, participantId: undefined, startTime: 0, endTime: undefined, eventCount: 0 };
        const start: SessionStartEvent = { type: 'sessionStart', timestamp: 0, exerciseId: 1, participantId: undefined };
        expect(resolveSchemaVersion(meta, start)).toBe(1);
    });

    it('returns 1 (legacy) when both metadata and sessionStart are undefined', () => {
        expect(resolveSchemaVersion(undefined, undefined)).toBe(1);
    });

    it('returns 1 (legacy) when metadata is null and sessionStart is undefined', () => {
        expect(resolveSchemaVersion(null, undefined)).toBe(1);
    });
});

// ── V1 fixture: no schemaVersion anywhere ─────────────────────────────────────

describe('V1 basic fixture (no schemaVersion)', () => {
    it('parses all 6 events', () => {
        const text = readFixture('v1-basic', 'events.jsonl');
        const events = parseEventsFile(text);
        expect(events).toHaveLength(6);
    });

    it('first event is sessionStart without schemaVersion', () => {
        const text = readFixture('v1-basic', 'events.jsonl');
        const events = parseEventsFile(text);
        const start = events[0] as SessionStartEvent;
        expect(start.type).toBe('sessionStart');
        expect(start.schemaVersion).toBeUndefined();
    });

    it('resolves schemaVersion to 1 from metadata and sessionStart', () => {
        const metaText = readFixture('v1-basic', 'metadata.json');
        const eventsText = readFixture('v1-basic', 'events.jsonl');
        const metadata = parseMetadataFile(metaText);
        const events = parseEventsFile(eventsText);
        const start = events.find((e): e is SessionStartEvent => e.type === 'sessionStart');
        expect(resolveSchemaVersion(metadata, start)).toBe(1);
    });

    it('metadata has no schemaVersion field', () => {
        const metaText = readFixture('v1-basic', 'metadata.json');
        const metadata = parseMetadataFile(metaText);
        expect(metadata.schemaVersion).toBeUndefined();
    });
});

// ── V2 fixture: new event types ───────────────────────────────────────────────

describe('V2 basic fixture (schemaVersion 2, new event types)', () => {
    it('parses all 11 events', () => {
        const text = readFixture('v2-basic', 'events.jsonl');
        const events = parseEventsFile(text);
        expect(events).toHaveLength(11);
    });

    it('resolves schemaVersion to 2 (metadata wins over sessionStart)', () => {
        const metaText = readFixture('v2-basic', 'metadata.json');
        const eventsText = readFixture('v2-basic', 'events.jsonl');
        const metadata = parseMetadataFile(metaText);
        const events = parseEventsFile(eventsText);
        const start = events.find((e): e is SessionStartEvent => e.type === 'sessionStart');
        expect(resolveSchemaVersion(metadata, start)).toBe(2);
    });

    it('metadata carries recorderVersion', () => {
        const metaText = readFixture('v2-basic', 'metadata.json');
        const metadata = parseMetadataFile(metaText);
        expect(metadata.recorderVersion).toBe('0.4.1');
    });

    it('contains an intervention event with action "blocked"', () => {
        const text = readFixture('v2-basic', 'events.jsonl');
        const events = parseEventsFile(text);
        const intervention = events.find(e => e.type === 'intervention');
        expect(intervention).toBeDefined();
        expect((intervention as { action: string }).action).toBe('blocked');
    });

    it('contains fileSnapshotError, irisChatSendAttempt, fileCreate, textDocumentOpen, textDocumentClose, fileDelete, fileRename', () => {
        const text = readFixture('v2-basic', 'events.jsonl');
        const events = parseEventsFile(text);
        const types = new Set(events.map(e => e.type));
        expect(types.has('fileSnapshotError')).toBe(true);
        expect(types.has('irisChatSendAttempt')).toBe(true);
        expect(types.has('fileCreate')).toBe(true);
        expect(types.has('textDocumentOpen')).toBe(true);
        expect(types.has('textDocumentClose')).toBe(true);
        expect(types.has('fileDelete')).toBe(true);
        expect(types.has('fileRename')).toBe(true);
    });
});

// ── V2 without metadata: schemaVersion comes from sessionStart ────────────────

describe('V2 no-metadata fixture (schemaVersion from sessionStart)', () => {
    it('parses 3 events', () => {
        const text = readFixture('v2-no-metadata', 'events.jsonl');
        const events = parseEventsFile(text);
        expect(events).toHaveLength(3);
    });

    it('resolves schemaVersion to 2 from sessionStart when no metadata', () => {
        const text = readFixture('v2-no-metadata', 'events.jsonl');
        const events = parseEventsFile(text);
        const start = events.find((e): e is SessionStartEvent => e.type === 'sessionStart');
        expect(resolveSchemaVersion(null, start)).toBe(2);
    });
});

// ── Conflicting versions: metadata wins ───────────────────────────────────────

describe('resolveSchemaVersion — conflicting metadata vs sessionStart', () => {
    it('metadata version 3 beats sessionStart version 2', () => {
        const meta = { sessionId: 's', exerciseId: 1, participantId: undefined, startTime: 0, endTime: undefined, eventCount: 0, schemaVersion: 3 };
        const start: SessionStartEvent = { type: 'sessionStart', timestamp: 0, exerciseId: 1, participantId: undefined, schemaVersion: 2 };
        expect(resolveSchemaVersion(meta, start)).toBe(3);
    });

    it('metadata version 1 beats sessionStart version 2 (metadata always wins)', () => {
        const meta = { sessionId: 's', exerciseId: 1, participantId: undefined, startTime: 0, endTime: undefined, eventCount: 0, schemaVersion: 1 };
        const start: SessionStartEvent = { type: 'sessionStart', timestamp: 0, exerciseId: 1, participantId: undefined, schemaVersion: 2 };
        expect(resolveSchemaVersion(meta, start)).toBe(1);
    });
});

// ── Malformed last line ───────────────────────────────────────────────────────

describe('malformed-last-line fixture (partial-write crash simulation)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('parses the 3 valid events and skips the malformed line', () => {
        const text = readFixture('malformed-last-line', 'events.jsonl');
        const events = parseEventsFile(text);
        expect(events).toHaveLength(3);
    });

    it('emits a console.warn for the malformed line', () => {
        const text = readFixture('malformed-last-line', 'events.jsonl');
        parseEventsFile(text);
        expect(console.warn).toHaveBeenCalledOnce();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[parseSession]'));
    });

    it('warn message contains the line number', () => {
        const text = readFixture('malformed-last-line', 'events.jsonl');
        parseEventsFile(text);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('4'));
    });

    it('last valid event is a save event', () => {
        const text = readFixture('malformed-last-line', 'events.jsonl');
        const events = parseEventsFile(text);
        expect(events[events.length - 1]?.type).toBe('save');
    });
});

// ── Legacy failedTests: string[] without failedTestDetails ────────────────────

describe('legacy buildResult: failedTests as string[] without failedTestDetails', () => {
    it('parses a buildResult with failedTests array and no failedTestDetails', () => {
        const line = JSON.stringify({
            type: 'buildResult',
            timestamp: 1700000000000,
            successful: false,
            errorCount: 2,
            failedTests: ['com.example.TestA#testFoo', 'com.example.TestB#testBar'],
            buildFailed: false,
        });
        const events = parseEventsFile(line);
        expect(events).toHaveLength(1);
        const ev = events[0] as { type: string; failedTests: string[]; failedTestDetails?: unknown };
        expect(ev.type).toBe('buildResult');
        expect(ev.failedTests).toEqual(['com.example.TestA#testFoo', 'com.example.TestB#testBar']);
        expect(ev.failedTestDetails).toBeUndefined();
    });
});
