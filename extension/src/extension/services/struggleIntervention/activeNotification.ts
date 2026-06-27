import * as vscode from 'vscode';

const OPEN = 'Open Iris';
const DISMISS = 'Not now';

/** Pure: the short notification text (the full hint lives in the chat bubble, not the toast). */
export function buildActiveNotificationText(): string {
    return 'Iris has a suggestion that might help you move forward.';
}

/** Raise the active-surface notification; `Open Iris` focuses the chat + reports engagement, `Not now` → backoff. */
export function showActiveNotification(onOpen?: () => void, onDismiss?: () => void): void {
    void vscode.window.showInformationMessage(buildActiveNotificationText(), OPEN, DISMISS).then(choice => {
        if (choice === OPEN) {
            onOpen?.();
            void vscode.commands.executeCommand('iris.chatView.focus');
        }
        else if (choice === DISMISS) {
            onDismiss?.();
        }
    });
}
