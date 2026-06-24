import * as vscode from 'vscode';

const OPEN = 'Open Iris';

/** Pure: the short notification text (the full hint lives in the chat bubble, not the toast). */
export function buildActiveNotificationText(): string {
    return 'Iris has a suggestion that might help you move forward.';
}

/** Raise the active-surface notification; its action focuses the Iris chat + reports the engagement. */
export function showActiveNotification(onOpen?: () => void): void {
    void vscode.window.showInformationMessage(buildActiveNotificationText(), OPEN).then(choice => {
        if (choice === OPEN) {
            onOpen?.();
            void vscode.commands.executeCommand('iris.chatView.focus');
        }
    });
}
