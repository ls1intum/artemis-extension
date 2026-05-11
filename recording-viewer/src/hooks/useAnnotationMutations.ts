import { useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationLabel } from '../types';
import {
    createAnnotationController,
    type AnnotationControllerArgs,
    type AnnotationMutator,
} from './annotationController';

export type { AnnotationMutator, AnnotationToast } from './annotationController';

interface UseAnnotationMutationsArgs {
    sessionId: string | null;
    setAnnotations: (next: Annotation[]) => void;
    onToast: AnnotationControllerArgs['onToast'];
    onError: (message: string) => void;
    /** Optional fetch override for tests. Defaults to global `fetch` with
     *  `credentials: 'include'`. */
    fetcher?: typeof fetch;
}

/** Thin React adapter. The actual logic lives in createAnnotationController
 *  so it can be tested in node without a DOM/testing-library setup.
 *
 *  The controller is created lazily via `useState(initFn)` so it's stable
 *  across renders without touching refs during render (which the
 *  `react-hooks/refs` rule rightly rejects). Args are forwarded through a
 *  mutable holder updated in an effect, so the controller's closures always
 *  see the latest callbacks. */
export function useAnnotationMutations(args: UseAnnotationMutationsArgs): AnnotationMutator {
    // Args ref is updated in an effect AFTER commit (never during render), so
    // the controller's callbacks see the freshest props/handlers when they
    // actually fire (during a user event, not while React is computing the
    // tree). The first-render args are seeded by the lazy initializer.
    const argsRef = useRef<UseAnnotationMutationsArgs>(args);
    useEffect(() => {
        argsRef.current = args;
    });

    // The argsRef-reading callbacks below only fire from inside the
    // controller's enqueued queue bodies, never during React's render phase.
    // The lint rule is statically unable to prove that, so we silence it on
    // this specific construction site.
    // eslint-disable-next-line react-hooks/refs
    const [controller] = useState(() => createAnnotationController({
        getSessionId: () => argsRef.current.sessionId,
        setAnnotations: (a) => argsRef.current.setAnnotations(a),
        onToast: (t) => argsRef.current.onToast(t),
        onError: (m) => argsRef.current.onError(m),
        getFetcher: () => argsRef.current.fetcher,
    }));

    // Dispose on unmount.
    useEffect(() => {
        return () => { controller.dispose(); };
    }, [controller]);

    return controller;
}

export type { Annotation, AnnotationLabel };
