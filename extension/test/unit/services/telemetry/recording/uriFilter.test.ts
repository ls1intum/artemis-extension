/**
 * Unit tests for uriFilter — Block I
 *
 * Covers:
 *   1. Prefix-bug fix: /workspace/ex1 root does NOT accept /workspace/ex10/File.java
 *   2. /workspace/ex1 root + /workspace/ex1/File.java → true
 *   3. Exact root match: /workspace/ex1 root + /workspace/ex1 (root itself) → true
 *   4. Blacklisted scheme: git:// → false
 *   5. Non-file scheme: vscode-remote:// with file-path inside root → false (V1: file: only)
 *   6. No exerciseRoot given, file:// URI → true
 *   7. Blacklisted scheme: vscode-userdata: → false
 *   8. shouldRecordUriString mirrors shouldRecordUri for string inputs
 *   9. All blacklisted schemes are rejected
 *  10. Non-file, non-blacklisted scheme (e.g. untitled:) → false (V1: file: only)
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

import { shouldRecordUri, shouldRecordUriString } from '@extension/services/telemetry/uriFilter';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileUri(fsPath: string): vscode.Uri {
    return vscode.Uri.file(fsPath);
}

// ── shouldRecordUri ───────────────────────────────────────────────────────────

suite('shouldRecordUri (Block I)', () => {
    // ── Prefix-bug fix ────────────────────────────────────────────────────────

    test('1. prefix-bug: /workspace/ex10/File.java must NOT match root /workspace/ex1', () => {
        const root = fileUri('/workspace/ex1');
        const uri  = fileUri('/workspace/ex10/File.java');
        assert.strictEqual(shouldRecordUri(uri, root), false,
            '/workspace/ex10 starts with /workspace/ex1 lexically but is NOT under it');
    });

    test('2. /workspace/ex1/File.java is accepted under root /workspace/ex1', () => {
        const root = fileUri('/workspace/ex1');
        const uri  = fileUri('/workspace/ex1/File.java');
        assert.strictEqual(shouldRecordUri(uri, root), true);
    });

    test('3. exact root match: URI equal to root is accepted', () => {
        const root = fileUri('/workspace/ex1');
        const uri  = fileUri('/workspace/ex1');
        assert.strictEqual(shouldRecordUri(uri, root), true);
    });

    test('2b. deeply nested file is accepted under root', () => {
        const root = fileUri('/workspace/ex1');
        const uri  = fileUri('/workspace/ex1/src/main/java/Main.java');
        assert.strictEqual(shouldRecordUri(uri, root), true);
    });

    test('2c. sibling directory /workspace/ex1-extra is NOT accepted under root /workspace/ex1', () => {
        const root = fileUri('/workspace/ex1');
        const uri  = fileUri('/workspace/ex1-extra/Main.java');
        assert.strictEqual(shouldRecordUri(uri, root), false);
    });

    // ── Blacklisted schemes ───────────────────────────────────────────────────

    test('4. git scheme is rejected', () => {
        const uri = vscode.Uri.parse('git:/some/file.java');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('7. vscode-userdata scheme is rejected', () => {
        const uri = vscode.Uri.parse('vscode-userdata:/settings.json');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('9a. output scheme is rejected', () => {
        const uri = vscode.Uri.parse('output:/extension-output');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('9b. search-result scheme is rejected', () => {
        const uri = vscode.Uri.parse('search-result:/result');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('9c. vscode-scm scheme is rejected', () => {
        const uri = vscode.Uri.parse('vscode-scm:/some/path');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('9d. vscode-settings scheme is rejected', () => {
        const uri = vscode.Uri.parse('vscode-settings:/settings');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('9e. vscode-terminal scheme is rejected', () => {
        const uri = vscode.Uri.parse('vscode-terminal:/term');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    test('9f. vscode-chat-input scheme is rejected', () => {
        const uri = vscode.Uri.parse('vscode-chat-input:/chat');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    // ── Non-file, non-blacklisted schemes (V1: file: only) ───────────────────

    test('5. vscode-remote scheme is rejected in V1 (file: scheme only)', () => {
        // vscode-remote is not blacklisted but is not file: — V1 rejects it.
        // Supporting remote URIs is a planned follow-up.
        const root = fileUri('/workspace/ex1');
        const uri  = vscode.Uri.parse('vscode-remote://ssh-remote+host/workspace/ex1/file.java');
        assert.strictEqual(shouldRecordUri(uri, root), false,
            'V1 only records file: scheme; vscode-remote is a future follow-up');
    });

    test('10. untitled scheme is rejected in V1', () => {
        const uri = vscode.Uri.parse('untitled:Untitled-1');
        assert.strictEqual(shouldRecordUri(uri), false);
    });

    // ── No exerciseRoot ───────────────────────────────────────────────────────

    test('6. file:// URI is accepted when no exerciseRoot is given', () => {
        const uri = fileUri('/workspace/ex1/Main.java');
        assert.strictEqual(shouldRecordUri(uri), true);
    });

    test('6b. file:// URI at any path is accepted without exerciseRoot', () => {
        const uri = fileUri('/tmp/random/path.txt');
        assert.strictEqual(shouldRecordUri(uri), true);
    });
});

// ── shouldRecordUriString ─────────────────────────────────────────────────────

suite('shouldRecordUriString (Block I)', () => {
    test('8a. prefix-bug: ex10 string not accepted under ex1 root string', () => {
        const root = fileUri('/workspace/ex1').toString();
        const uri  = fileUri('/workspace/ex10/File.java').toString();
        assert.strictEqual(shouldRecordUriString(uri, root), false);
    });

    test('8b. file in ex1 subtree accepted', () => {
        const root = fileUri('/workspace/ex1').toString();
        const uri  = fileUri('/workspace/ex1/Main.java').toString();
        assert.strictEqual(shouldRecordUriString(uri, root), true);
    });

    test('8c. git URI string is rejected', () => {
        assert.strictEqual(shouldRecordUriString('git:/some/file.java'), false);
    });

    test('8d. no root: file URI string accepted', () => {
        const uri = fileUri('/workspace/ex1/Main.java').toString();
        assert.strictEqual(shouldRecordUriString(uri), true);
    });

    test('8e. vscode-userdata URI string is rejected', () => {
        assert.strictEqual(shouldRecordUriString('vscode-userdata:/settings.json'), false);
    });

    test('8f. path.sep is correctly used — same result on current platform', () => {
        // Regression guard: ensure that shouldRecordUri and shouldRecordUriString
        // agree for the same input.
        const root = fileUri('/workspace/ex1');
        const uri  = fileUri('/workspace/ex1/sub/file.ts');
        assert.strictEqual(
            shouldRecordUri(uri, root),
            shouldRecordUriString(uri.toString(), root.toString()),
        );
    });
});
