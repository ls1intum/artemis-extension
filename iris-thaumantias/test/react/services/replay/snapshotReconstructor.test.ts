import { describe, it, expect } from 'vitest';
import {
    isCompilerDiagnosticSerialized,
    getErrorFamilySerialized,
    createSnapshotFromDiagnosticState,
    createSnapshotFromBuildEvent,
} from '../../../../src/services/telemetry/replay/snapshotReconstructor';
import type { SerializedDiagnostic, BuildResultEvent } from '../../../../src/services/telemetry/recording/types';

function makeDiag(overrides: Partial<SerializedDiagnostic> = {}): SerializedDiagnostic {
    return {
        code: 'ts2304',
        message: 'Cannot find name',
        severity: 0, // Error
        range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 },
        source: 'ts',
        ...overrides,
    };
}

describe('isCompilerDiagnosticSerialized', () => {
    it('returns true for severity 0 with non-lint source', () => {
        expect(isCompilerDiagnosticSerialized(makeDiag())).toBe(true);
    });

    it('returns false for non-error severity', () => {
        expect(isCompilerDiagnosticSerialized(makeDiag({ severity: 1 }))).toBe(false);
        expect(isCompilerDiagnosticSerialized(makeDiag({ severity: 2 }))).toBe(false);
    });

    it('returns false for lint sources', () => {
        expect(isCompilerDiagnosticSerialized(makeDiag({ source: 'eslint' }))).toBe(false);
        expect(isCompilerDiagnosticSerialized(makeDiag({ source: 'ESLint' }))).toBe(false);
        expect(isCompilerDiagnosticSerialized(makeDiag({ source: 'tslint' }))).toBe(false);
        expect(isCompilerDiagnosticSerialized(makeDiag({ source: 'sonarlint' }))).toBe(false);
    });

    it('handles undefined source as non-lint', () => {
        expect(isCompilerDiagnosticSerialized(makeDiag({ source: undefined }))).toBe(true);
    });
});

describe('getErrorFamilySerialized', () => {
    it('returns source:code', () => {
        expect(getErrorFamilySerialized(makeDiag())).toBe('ts:ts2304');
    });

    it('handles undefined source and code', () => {
        expect(getErrorFamilySerialized(makeDiag({ source: undefined, code: undefined }))).toBe('unknown:unknown');
    });

    it('handles numeric codes', () => {
        expect(getErrorFamilySerialized(makeDiag({ code: 2304 }))).toBe('ts:2304');
    });
});

describe('createSnapshotFromDiagnosticState', () => {
    it('creates empty snapshot from empty state', () => {
        const state = new Map<string, SerializedDiagnostic[]>();
        const snapshot = createSnapshotFromDiagnosticState(state, 1000);
        expect(snapshot.hasErrors).toBe(false);
        expect(snapshot.errorCount).toBe(0);
        expect(snapshot.errorFamilies.size).toBe(0);
        expect(snapshot.timestamp).toBe(1000);
    });

    it('counts compiler errors across multiple URIs', () => {
        const state = new Map<string, SerializedDiagnostic[]>();
        state.set('file:///a.ts', [makeDiag({ code: 'ts2304' }), makeDiag({ code: 'ts2345' })]);
        state.set('file:///b.ts', [makeDiag({ code: 'ts2304' })]);
        const snapshot = createSnapshotFromDiagnosticState(state, 2000);
        expect(snapshot.hasErrors).toBe(true);
        expect(snapshot.errorCount).toBe(3);
        expect(snapshot.errorFamilies.size).toBe(2); // ts:ts2304, ts:ts2345
    });

    it('filters out lint diagnostics', () => {
        const state = new Map<string, SerializedDiagnostic[]>();
        state.set('file:///a.ts', [
            makeDiag({ source: 'eslint', code: 'no-unused-vars' }),
            makeDiag({ source: 'ts', code: 'ts2304' }),
        ]);
        const snapshot = createSnapshotFromDiagnosticState(state, 3000);
        expect(snapshot.errorCount).toBe(1);
        expect(snapshot.errorFamilies.has('ts:ts2304')).toBe(true);
    });

    it('filters out non-error severity', () => {
        const state = new Map<string, SerializedDiagnostic[]>();
        state.set('file:///a.ts', [
            makeDiag({ severity: 1 }), // Warning
            makeDiag({ severity: 0 }), // Error
        ]);
        const snapshot = createSnapshotFromDiagnosticState(state, 4000);
        expect(snapshot.errorCount).toBe(1);
    });
});

describe('createSnapshotFromBuildEvent', () => {
    it('creates hasErrors=true for buildFailed', () => {
        const event: BuildResultEvent = {
            type: 'buildResult',
            timestamp: 5000,
            successful: false,
            errorCount: 3,
            failedTests: [],
            buildFailed: true,
        };
        const snapshot = createSnapshotFromBuildEvent(event);
        expect(snapshot.hasErrors).toBe(true);
        expect(snapshot.errorFamilies.has('build:compiler-error')).toBe(true);
        expect(snapshot.timestamp).toBe(5000);
    });

    it('creates hasErrors=false for successful build', () => {
        const event: BuildResultEvent = {
            type: 'buildResult',
            timestamp: 6000,
            successful: true,
            errorCount: 0,
            failedTests: [],
            buildFailed: false,
        };
        const snapshot = createSnapshotFromBuildEvent(event);
        expect(snapshot.hasErrors).toBe(false);
        expect(snapshot.errorCount).toBe(0);
    });

    it('creates hasErrors=false for test failure (not compiler error)', () => {
        const event: BuildResultEvent = {
            type: 'buildResult',
            timestamp: 7000,
            successful: false,
            errorCount: 0,
            failedTests: ['testAdd'],
            buildFailed: false,
        };
        const snapshot = createSnapshotFromBuildEvent(event);
        expect(snapshot.hasErrors).toBe(false);
    });
});
