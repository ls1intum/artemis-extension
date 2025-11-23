import * as assert from 'assert';
import { normalizeRelativePath } from '../../src/utils/pathUtils';

suite('Path Utils Test Suite', () => {
    test('normalizeRelativePath should handle empty input', () => {
        assert.strictEqual(normalizeRelativePath(null), '');
        assert.strictEqual(normalizeRelativePath(undefined), '');
        assert.strictEqual(normalizeRelativePath(''), '');
    });

    test('normalizeRelativePath should normalize slashes', () => {
        assert.strictEqual(normalizeRelativePath('folder\\file.txt'), 'folder/file.txt');
    });

    test('normalizeRelativePath should remove leading slashes', () => {
        assert.strictEqual(normalizeRelativePath('/folder/file.txt'), 'folder/file.txt');
        assert.strictEqual(normalizeRelativePath('\\folder\\file.txt'), 'folder/file.txt');
    });

    test('normalizeRelativePath should remove .git suffix', () => {
        assert.strictEqual(normalizeRelativePath('file.java.git'), 'file.java');
        assert.strictEqual(normalizeRelativePath('folder/file.git'), 'folder/file');
    });

    test('normalizeRelativePath should trim whitespace', () => {
        assert.strictEqual(normalizeRelativePath('  folder/file.txt  '), 'folder/file.txt');
    });

    test('normalizeRelativePath should handle mixed slashes', () => {
        assert.strictEqual(normalizeRelativePath('folder\\subfolder/file.txt'), 'folder/subfolder/file.txt');
    });

    test('normalizeRelativePath should handle case insensitive .git suffix', () => {
        assert.strictEqual(normalizeRelativePath('file.java.GIT'), 'file.java');
        assert.strictEqual(normalizeRelativePath('folder/file.Git'), 'folder/file');
    });
});
