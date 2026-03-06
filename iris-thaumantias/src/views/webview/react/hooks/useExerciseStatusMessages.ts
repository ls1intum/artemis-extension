import { useExtensionMessage } from './useExtensionMessage';
import { useExerciseDetailStore } from '../stores/useExerciseDetailStore';
import { ExtensionMsg } from '../../../../shared/messageContracts';
import type { VsCodeApi } from '../../../../shared/messageContracts';

/**
 * Shared hook that listens for exercise status extension messages
 * (UpdateRepoStatus, ShowClonedRepoNotice, UpdateDirtyPagesStatus)
 * and updates the exercise detail store accordingly.
 */
export function useExerciseStatusMessages(vscodeApi: VsCodeApi): void {
    const { setRepoStatus, setClonedNotice, setDirtyPagesStatus } = useExerciseDetailStore();

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.UpdateRepoStatus:
                setRepoStatus({ isConnected: msg.isConnected, hasChanges: msg.hasChanges, isPracticeRepo: msg.isPracticeRepo });
                break;
            case ExtensionMsg.ShowClonedRepoNotice:
                setClonedNotice(msg.exerciseTitle);
                break;
            case ExtensionMsg.UpdateDirtyPagesStatus:
                setDirtyPagesStatus({ hasDirtyPages: msg.hasDirtyPages, dirtyFileCount: msg.dirtyFileCount, autoSaveEnabled: msg.autoSaveEnabled });
                break;
        }
    }, [vscodeApi, setRepoStatus, setClonedNotice, setDirtyPagesStatus]);
}
