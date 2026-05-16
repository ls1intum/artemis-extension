import * as assert from 'assert';
import { BuildLogParser } from '@extension/utils/buildLogParser';
import type { BuildLogEntry } from '@extension/types';

suite('BuildLogParser Test Suite', () => {

    function createLogEntry(log: string): BuildLogEntry {
        return { id: 1, time: new Date().toISOString(), log };
    }

    test('should parse Gradle error format', () => {
        const log = 'src/de/tum/in/ase/eist/BubbleSort.java:15: error: cannot find symbol';
        const entries = [createLogEntry(log)];
        
        const result = BuildLogParser.parseFirstError(entries);
        
        assert.ok(result);
        assert.strictEqual(result?.filePath, 'src/de/tum/in/ase/eist/BubbleSort.java');
        assert.strictEqual(result?.line, 15);
        assert.strictEqual(result?.message, 'cannot find symbol');
    });

    test('should parse Maven error format', () => {
        const log = '[ERROR] /src/main/java/com/example/App.java:[20,10] ; expected';
        const entries = [createLogEntry(log)];
        
        const result = BuildLogParser.parseFirstError(entries);
        
        assert.ok(result);
        assert.strictEqual(result?.filePath, 'src/main/java/com/example/App.java');
        assert.strictEqual(result?.line, 20);
        assert.strictEqual(result?.message, '; expected');
    });

    test('should parse Swift error format', () => {
        const log = 'Sources/App/main.swift:5:1: error: use of unresolved identifier';
        const entries = [createLogEntry(log)];
        
        const result = BuildLogParser.parseFirstError(entries);
        
        assert.ok(result);
        assert.strictEqual(result?.filePath, 'Sources/App/main.swift');
        assert.strictEqual(result?.line, 5);
        assert.strictEqual(result?.message, 'use of unresolved identifier');
    });

    test('should return null if no error found', () => {
        const log = 'BUILD SUCCESSFUL in 2s';
        const entries = [createLogEntry(log)];
        
        const result = BuildLogParser.parseFirstError(entries);
        
        assert.strictEqual(result, null);
    });

    test('should find first error in multiple logs', () => {
        const entries = [
            createLogEntry('Compiling...'),
            createLogEntry('src/Test.java:10: error: first error'),
            createLogEntry('src/Test.java:20: error: second error')
        ];
        
        const result = BuildLogParser.parseFirstError(entries);
        
        assert.ok(result);
        assert.strictEqual(result?.line, 10);
        assert.strictEqual(result?.message, 'first error');
    });

    test('should handle Windows paths in logs', () => {
        // Simulate a log that might come from a Windows runner (though usually logs are standardized)
        // But our path normalizer handles backslashes
        const log = 'src/com/example/Test.java:5: error: message';
        const entries = [createLogEntry(log)];
        
        const result = BuildLogParser.parseFirstError(entries);
        
        assert.ok(result);
        assert.strictEqual(result?.filePath, 'src/com/example/Test.java');
    });
});
