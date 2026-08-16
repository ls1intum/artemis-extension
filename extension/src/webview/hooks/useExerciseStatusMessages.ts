import type { VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';

import { useExtensionMessage } from './useExtensionMessage';

/**
 * Listens for exercise status extension messages and updates the exercise
 * detail store.
 */
export function useExerciseStatusMessages(vscodeApi: VsCodeApi): void {
    const { setRepoStatus, setClonedNotice, setDirtyPagesStatus } = useExerciseDetailStore();

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.UpdateRepoStatus:
                setRepoStatus({ isConnected: msg.isConnected, hasChanges: msg.hasChanges, isPracticeRepo: msg.isPracticeRepo });
                break;
            case ExtensionMsg.ShowClonedRepoNotice:
                setClonedNotice(msg.exerciseTitle, msg.participationId);
                break;
            case ExtensionMsg.UpdateDirtyPagesStatus:
                setDirtyPagesStatus({ hasDirtyPages: msg.hasDirtyPages, dirtyFileCount: msg.dirtyFileCount, autoSaveEnabled: msg.autoSaveEnabled });
                break;
        }
    }, [vscodeApi, setRepoStatus, setClonedNotice, setDirtyPagesStatus]);
}
