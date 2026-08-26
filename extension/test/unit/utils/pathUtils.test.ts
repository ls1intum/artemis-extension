import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import { expandHomePath, normalizeRelativePath } from '@extension/utils/pathUtils';

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

suite('expandHomePath', () => {
    test('expands a leading tilde, which is the form the extension itself suggests', () => {
        assert.strictEqual(expandHomePath('~/artemis-exercises'), path.join(os.homedir(), 'artemis-exercises'));
    });

    test('expands a backslash-separated tilde, so the Windows spelling works too', () => {
        assert.strictEqual(expandHomePath('~\\artemis-exercises'), path.join(os.homedir(), 'artemis-exercises'));
    });

    test('expands a bare tilde to the home directory itself', () => {
        assert.strictEqual(expandHomePath('~'), os.homedir());
    });

    test('leaves another user\'s home alone, because resolving it is not portable', () => {
        assert.strictEqual(expandHomePath('~student/exercises'), '~student/exercises');
    });

    test('leaves a tilde that is not leading alone', () => {
        assert.strictEqual(expandHomePath('/tmp/~/exercises'), '/tmp/~/exercises');
        assert.strictEqual(expandHomePath('/tmp/backup~'), '/tmp/backup~');
    });

    test('returns absolute and empty paths unchanged', () => {
        assert.strictEqual(expandHomePath('/Users/someone/exercises'), '/Users/someone/exercises');
        assert.strictEqual(expandHomePath(''), '');
    });
});
