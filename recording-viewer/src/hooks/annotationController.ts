import type { Annotation, AnnotationLabel } from '../types';

export interface AnnotationToast {
    kind: 'add' | 'undo' | 'redo' | 'error';
    label?: AnnotationLabel;
    text?: string;
    at: number;
}

export interface AnnotationMutator {
    /** Enqueue an add. Optimistic insertion happens inside the queue body so the
     *  redo-stack invalidation is atomic with the new entry. */
    addLabel: (label: AnnotationLabel, referenceTs: number | null, options?: { persistTimestamp?: boolean }) => void;
    /** Enqueue an undo of whatever is the last real annotation at the moment
     *  the queue reaches this operation (not at call time). */
    undoLast: () => void;
    /** Enqueue a redo of the most recently undone annotation. */
    redoLast: () => void;
    /** Replace the authoritative annotation list. Bumps the generation counter
     *  so any in-flight queue body bails before its post-await side effects. */
    reset: (annotations: Annotation[]) => void;
    hasUndo: () => boolean;
    hasRedo: () => boolean;
}

export interface AnnotationController extends AnnotationMutator {
    /** Tear down: bumps gen and clears refs. Idempotent. */
    dispose: () => void;
    /** Test-only: returns a promise that resolves when the queue chain drains. */
    drain: () => Promise<void>;
}

export interface AnnotationControllerArgs {
    getSessionId: () => string | null;
    getRaterName: () => string | undefined;
    setAnnotations: (next: Annotation[]) => void;
    onToast: (toast: AnnotationToast) => void;
    onError: (message: string) => void;
    getFetcher?: () => typeof fetch | undefined;
}

function describeAnnotation(a: Annotation): string {
    const trimmed = a.text?.trim();
    if (trimmed) return trimmed.slice(0, 20);
    return 'annotation';
}

function makeTempId(): string {
    const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoRef?.randomUUID) return `temp-${cryptoRef.randomUUID()}`;
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAnnotationController(args: AnnotationControllerArgs): AnnotationController {
    let annotations: Annotation[] = [];
    let redoStack: Annotation[] = [];
    let queue: Promise<void> = Promise.resolve();
    let gen = 0;

    function emit(): void {
        args.setAnnotations(annotations.slice());
    }

    function doFetch(url: string, init?: RequestInit): Promise<Response> {
        const f = args.getFetcher?.() ?? fetch;
        return f(url, { credentials: 'include', ...init });
    }

    function enqueue(body: (capturedGen: number, capturedSessionId: string) => Promise<void>): void {
        const capturedGen = gen;
        const capturedSessionId = args.getSessionId();
        if (!capturedSessionId) return;
        queue = queue.then(async () => {
            if (capturedGen !== gen) return;
            try {
                await body(capturedGen, capturedSessionId);
            } catch (err) {
                console.error('[annotationController] queue body threw:', err);
            }
        });
    }

    const addLabel: AnnotationMutator['addLabel'] = (label, referenceTs, options) => {
        enqueue(async (capturedGen, sessionId) => {
            // Intent invalidates redo, ATOMIC with the new entry insertion.
            redoStack = [];

            const tempId = makeTempId();
            // The optimistic temp annotation always uses referenceTs for LOCAL display,
            // positioning it on the timeline at the clicked/playhead moment while the
            // POST is in flight. LIVE adds (no persistTimestamp) omit `timestamp` from
            // the POST so the server stamps its own receive time; OFFLINE/archival adds
            // (persistTimestamp: true) send referenceTs so the marker persists at the
            // clicked position instead of snapping to the receive time.
            const optimistic: Annotation = {
                id: tempId,
                timestamp: referenceTs ?? Date.now(),
                text: '',
                label,
                createdAt: Date.now(),
            };
            annotations = annotations.concat(optimistic);
            if (capturedGen === gen) emit();

            try {
                const body: { label: AnnotationLabel; text: string; timestamp?: number } = { label, text: '' };
                if (options?.persistTimestamp && referenceTs != null) body.timestamp = referenceTs;
                const res = await doFetch(`/api/recordings/${encodeURIComponent(sessionId)}/annotations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (capturedGen !== gen) return;
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json() as { annotation: Annotation };
                if (capturedGen !== gen) return;
                annotations = annotations.map(a => a.id === tempId ? json.annotation : a);
                emit();
                args.onToast({ kind: 'add', label, at: Date.now() });
            } catch {
                if (capturedGen !== gen) return;
                // Failed add: pull the temp out. A later undo then picks the
                // previous real annotation (documented behavior).
                annotations = annotations.filter(a => a.id !== tempId);
                emit();
                args.onError('Failed to add marker');
            }
        });
    };

    const undoLast: AnnotationMutator['undoLast'] = () => {
        enqueue(async (capturedGen, sessionId) => {
            if (annotations.length === 0) return;
            const last = annotations[annotations.length - 1];
            // Defensive: temp ids shouldn't be present here because prior adds'
            // queue bodies have already settled.
            if (last.id.startsWith('temp-')) return;

            const prev = annotations;
            annotations = annotations.slice(0, -1);
            if (capturedGen === gen) emit();

            try {
                const res = await doFetch(
                    `/api/recordings/${encodeURIComponent(sessionId)}/annotations/${encodeURIComponent(last.id)}`,
                    { method: 'DELETE' },
                );
                if (capturedGen !== gen) return;
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                redoStack = redoStack.concat(last);
                args.onToast({
                    kind: 'undo',
                    label: last.label,
                    text: describeAnnotation(last),
                    at: Date.now(),
                });
            } catch {
                if (capturedGen !== gen) return;
                // Revert: queue serialization guarantees nothing else touched
                // `annotations` while we were awaiting.
                annotations = prev;
                emit();
                args.onError('Failed to undo marker');
            }
        });
    };

    const redoLast: AnnotationMutator['redoLast'] = () => {
        enqueue(async (capturedGen, sessionId) => {
            if (redoStack.length === 0) return;
            const popped = redoStack[redoStack.length - 1];
            const myName = args.getRaterName();
            if (popped.raterName && myName && popped.raterName !== myName) {
                redoStack = redoStack.slice(0, -1);
                args.onError("Marker belongs to a different rater session and won't be restored.");
                return;
            }
            redoStack = redoStack.slice(0, -1);

            const tempId = makeTempId();
            const optimistic: Annotation = { ...popped, id: tempId };
            annotations = annotations.concat(optimistic);
            if (capturedGen === gen) emit();

            try {
                const res = await doFetch(`/api/recordings/${encodeURIComponent(sessionId)}/annotations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        label: popped.label,
                        text: popped.text,
                        timestamp: popped.timestamp,
                    }),
                });
                if (capturedGen !== gen) return;
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json() as { annotation: Annotation };
                if (capturedGen !== gen) return;
                annotations = annotations.map(a => a.id === tempId ? json.annotation : a);
                emit();
                args.onToast({
                    kind: 'redo',
                    label: popped.label,
                    text: describeAnnotation(popped),
                    at: Date.now(),
                });
            } catch {
                if (capturedGen !== gen) return;
                annotations = annotations.filter(a => a.id !== tempId);
                emit();
                // Put it back so the user can retry.
                redoStack = redoStack.concat(popped);
                args.onError('Failed to redo marker');
            }
        });
    };

    const reset: AnnotationMutator['reset'] = (next) => {
        gen += 1;
        queue = Promise.resolve();
        annotations = next.slice();
        redoStack = [];
        args.setAnnotations(annotations.slice());
    };

    return {
        addLabel,
        undoLast,
        redoLast,
        reset,
        hasUndo: () => annotations.length > 0,
        hasRedo: () => redoStack.length > 0,
        dispose: () => {
            gen += 1;
            queue = Promise.resolve();
            annotations = [];
            redoStack = [];
        },
        drain: () => queue,
    };
}
