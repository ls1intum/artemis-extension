import { useCallback, useRef, useState } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { postCommand } from '@shared/messageContracts';

import { useChatStore } from '@webview/stores/useChatStore';

/**
 * The dashboard course list, and whether we are still waiting for it.
 *
 * A fresh installation tracks nothing, so an empty list is only meaningful
 * once a fetch has finished; without `loading` the picker says "No courses
 * found" the instant it opens.
 */
export function useCourseList(vscodeApi: VsCodeApi) {
    const [loading, setLoading] = useState(false);
    /** Whether a `refreshCourses` we asked for is still outstanding. */
    const requested = useRef(false);

    /**
     * Opening the picker IS the question "what is there now", so this always
     * refetches. The previous list stays rendered until the answer arrives;
     * only an empty list shows the loading state.
     */
    const request = useCallback(() => {
        requested.current = true;
        if (useChatStore.getState().courses.length === 0) { setLoading(true); }
        postCommand(vscodeApi, 'refreshCourses');
    }, [vscodeApi]);

    /**
     * A snapshot arrived carrying `answersCourseRefresh`. Ends the wait only
     * for a request we actually made: the host posts snapshots of its own, and
     * one of those must not report a list nobody asked about as our answer.
     */
    const noteRefreshAnswered = useCallback(() => {
        if (!requested.current) { return; }
        requested.current = false;
        setLoading(false);
    }, []);

    return { loading, request, noteRefreshAnswered };
}
