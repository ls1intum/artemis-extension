import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createAnnotationController,
    type AnnotationController,
    type AnnotationToast,
} from '../src/hooks/annotationController';
import type { Annotation, AnnotationLabel } from '../src/types';

interface PendingFetch {
    url: string;
    init: RequestInit | undefined;
    resolve: (res: Response) => void;
    reject: (err: unknown) => void;
}

interface Harness {
    ctrl: AnnotationController;
    annotations: Annotation[];
    setAnnotations: ReturnType<typeof vi.fn>;
    onToast: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    pending: PendingFetch[];
    setSessionId: (id: string | null) => void;
}

function makeHarness(initialSessionId: string | null = 'sess-1'): Harness {
    let currentSessionId = initialSessionId;
    const pending: PendingFetch[] = [];
    const setAnnotations = vi.fn((next: Annotation[]) => {
        harness.annotations = next;
    });
    const onToast = vi.fn();
    const onError = vi.fn();

    const fetcher: typeof fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input as URL).toString();
        return new Promise<Response>((resolve, reject) => {
            pending.push({ url, init: init as RequestInit | undefined, resolve, reject });
        });
    };

    const ctrl = createAnnotationController({
        getSessionId: () => currentSessionId,
        getRaterName: () => undefined,
        setAnnotations,
        onToast,
        onError,
        getFetcher: () => fetcher,
    });

    const harness: Harness = {
        ctrl,
        annotations: [],
        setAnnotations,
        onToast,
        onError,
        pending,
        setSessionId: (id) => { currentSessionId = id; },
    };
    return harness;
}

function annot(id: string, overrides: Partial<Annotation> = {}): Annotation {
    return {
        id,
        timestamp: 1_000,
        text: '',
        label: 'confident',
        createdAt: 1_000,
        ...overrides,
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

let h: Harness;
beforeEach(() => { h = makeHarness(); });
afterEach(() => { h.ctrl.dispose(); });

describe('addLabel', () => {
    it('optimistically inserts temp annotation then replaces with server response', async () => {
        h.ctrl.addLabel('confident', 1_000);
        // Optimistic insert happens inside the queue body; drain one microtask cycle.
        await Promise.resolve();
        await Promise.resolve();
        expect(h.annotations).toHaveLength(1);
        expect(h.annotations[0].id).toMatch(/^temp-/);
        expect(h.annotations[0].label).toBe('confident');

        expect(h.pending).toHaveLength(1);
        const real = annot('real-1', { timestamp: 1_300 });
        h.pending[0].resolve(jsonResponse({ annotation: real }));
        await h.ctrl.drain();

        expect(h.annotations).toHaveLength(1);
        expect(h.annotations[0].id).toBe('real-1');
        expect(h.onToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'add', label: 'confident' }));
        expect(h.onError).not.toHaveBeenCalled();
    });

    it('removes the temp annotation on POST failure and reports error', async () => {
        h.ctrl.addLabel('blocked', null);
        await Promise.resolve(); await Promise.resolve();
        expect(h.annotations).toHaveLength(1);
        h.pending[0].resolve(new Response('nope', { status: 500 }));
        await h.ctrl.drain();
        expect(h.annotations).toHaveLength(0);
        expect(h.onError).toHaveBeenCalledWith('Failed to add marker');
        expect(h.onToast).not.toHaveBeenCalled();
    });

    it('uses Date.now() when referenceTs is null', async () => {
        const before = Date.now();
        h.ctrl.addLabel('idle', null);
        await Promise.resolve(); await Promise.resolve();
        expect(h.annotations).toHaveLength(1);
        expect(h.annotations[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(h.annotations[0].timestamp).toBeLessThanOrEqual(Date.now() + 10);
    });
});

describe('addLabel persistTimestamp (offline click-to-place regression guard)', () => {
    it('persistTimestamp: true sends timestamp === referenceTs in the POST body', async () => {
        h.ctrl.addLabel('medium-struggle', 1_234_567, { persistTimestamp: true });
        await Promise.resolve(); await Promise.resolve();
        expect(h.pending).toHaveLength(1);
        expect(h.pending[0].init?.method).toBe('POST');
        const body = JSON.parse(h.pending[0].init?.body as string);
        expect(body.timestamp).toBe(1_234_567);
        expect(body.label).toBe('medium-struggle');
        // Resolve so the queue drains cleanly.
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-ts', { timestamp: 1_234_567 }) }));
        await h.ctrl.drain();
        expect(h.onError).not.toHaveBeenCalled();
    });

    it('default add (no options) omits timestamp from the POST body', async () => {
        h.ctrl.addLabel('confident', 1_234_567);
        await Promise.resolve(); await Promise.resolve();
        expect(h.pending).toHaveLength(1);
        const body = JSON.parse(h.pending[0].init?.body as string);
        expect(body).not.toHaveProperty('timestamp');
        expect(body.label).toBe('confident');
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-live') }));
        await h.ctrl.drain();
    });

    it('persistTimestamp: false omits timestamp from the POST body', async () => {
        h.ctrl.addLabel('blocked', 1_234_567, { persistTimestamp: false });
        await Promise.resolve(); await Promise.resolve();
        expect(h.pending).toHaveLength(1);
        const body = JSON.parse(h.pending[0].init?.body as string);
        expect(body).not.toHaveProperty('timestamp');
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-live-2') }));
        await h.ctrl.drain();
    });

    it('persistTimestamp: true but referenceTs null still omits timestamp (guarded by referenceTs != null)', async () => {
        h.ctrl.addLabel('idle', null, { persistTimestamp: true });
        await Promise.resolve(); await Promise.resolve();
        expect(h.pending).toHaveLength(1);
        const body = JSON.parse(h.pending[0].init?.body as string);
        expect(body).not.toHaveProperty('timestamp');
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-null') }));
        await h.ctrl.drain();
    });
});

describe('temp-id race (codex r2 critical)', () => {
    it('undoLast queued during in-flight addLabel uses the REAL id', async () => {
        h.ctrl.addLabel('confident', 1_000);
        await Promise.resolve(); await Promise.resolve();
        expect(h.annotations).toHaveLength(1);
        const tempIdAtCall = h.annotations[0].id;

        // Enqueue undo BEFORE resolving the POST.
        h.ctrl.undoLast();

        h.pending[0].resolve(jsonResponse({ annotation: annot('real-A', { timestamp: 1_300 }) }));

        // Let the chain advance: the post-add map happens, then the undo body
        // runs and captures the now-real `last`, which issues the DELETE.
        for (let i = 0; i < 20 && h.pending.length < 2; i++) {
            await new Promise(r => setTimeout(r, 0));
        }
        expect(h.pending).toHaveLength(2);
        const deleteCall = h.pending[1];
        expect(deleteCall.url).toBe('/api/recordings/sess-1/annotations/real-A');
        expect(deleteCall.url).not.toContain(tempIdAtCall);
        deleteCall.resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();
        expect(h.annotations).toHaveLength(0);
        expect(h.ctrl.hasRedo()).toBe(true);
    });
});

describe('undoLast', () => {
    beforeEach(() => {
        h.ctrl.reset([annot('a1'), annot('a2'), annot('a3')]);
    });

    it('removes last annotation and pushes to redo on success', async () => {
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        // The remove is optimistic: it lands before the DELETE resolves below.
        expect(h.annotations.map(a => a.id)).toEqual(['a1', 'a2']);
        expect(h.pending[0].url).toBe('/api/recordings/sess-1/annotations/a3');
        expect(h.pending[0].init?.method).toBe('DELETE');
        h.pending[0].resolve(jsonResponse({ ok: true, deletedId: 'a3' }));
        await h.ctrl.drain();
        expect(h.annotations.map(a => a.id)).toEqual(['a1', 'a2']);
        expect(h.ctrl.hasRedo()).toBe(true);
        expect(h.onToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'undo' }));
    });

    it('restores annotation on DELETE failure and does NOT push to redo', async () => {
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(new Response('gone', { status: 404 }));
        await h.ctrl.drain();
        expect(h.annotations.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
        expect(h.ctrl.hasRedo()).toBe(false);
        expect(h.onError).toHaveBeenCalledWith('Failed to undo marker');
    });

    it('no-ops when there are no annotations', async () => {
        h.ctrl.reset([]);
        h.ctrl.undoLast();
        await h.ctrl.drain();
        expect(h.pending).toHaveLength(0);
        expect(h.onError).not.toHaveBeenCalled();
    });
});

describe('failed-undo-then-redo (codex r2 critical)', () => {
    it('redo queued behind a failed undo sees empty redo-stack and no-ops', async () => {
        h.ctrl.reset([annot('a1'), annot('a2')]);
        h.ctrl.undoLast();
        // Enqueue redo before undo fails.
        h.ctrl.redoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(new Response('boom', { status: 500 }));
        await h.ctrl.drain();
        // Undo restored a2; redo body found stack empty and was a no-op.
        expect(h.annotations.map(a => a.id)).toEqual(['a1', 'a2']);
        // Only the failed DELETE; redo issued no POST of its own.
        expect(h.pending).toHaveLength(1);
        expect(h.onError).toHaveBeenCalledTimes(1);
        expect(h.onError).toHaveBeenCalledWith('Failed to undo marker');
    });
});

describe('redoLast', () => {
    beforeEach(async () => {
        h.ctrl.reset([annot('a1'), annot('a2')]);
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(jsonResponse({ ok: true, deletedId: 'a2' }));
        await h.ctrl.drain();
        h.pending.length = 0; // clear for the redo test
        h.onToast.mockClear();
    });

    it('re-adds the most recently undone annotation with a new id', async () => {
        h.ctrl.redoLast();
        await Promise.resolve(); await Promise.resolve();
        expect(h.annotations).toHaveLength(2);
        expect(h.annotations[1].id).toMatch(/^temp-/);
        expect(h.pending[0].init?.method).toBe('POST');
        const body = JSON.parse((h.pending[0].init?.body as string));
        expect(body.timestamp).toBe(annot('a2').timestamp);
        const real = annot('real-redone', { timestamp: 1_000 });
        h.pending[0].resolve(jsonResponse({ annotation: real }));
        await h.ctrl.drain();
        expect(h.annotations[1].id).toBe('real-redone');
        expect(h.onToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'redo' }));
        expect(h.ctrl.hasRedo()).toBe(false);
    });

    it('restores redo-stack on POST failure', async () => {
        h.ctrl.redoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(new Response('no', { status: 500 }));
        await h.ctrl.drain();
        expect(h.annotations).toHaveLength(1); // a1 only
        expect(h.ctrl.hasRedo()).toBe(true);
        expect(h.onError).toHaveBeenCalledWith('Failed to redo marker');
    });
});

describe('redo invalidation on intent', () => {
    it('addLabel clears the redo stack inside the queue body BEFORE POSTing', async () => {
        h.ctrl.reset([annot('a1')]);
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();
        expect(h.ctrl.hasRedo()).toBe(true);

        h.ctrl.addLabel('blocked', 5_000);
        await Promise.resolve(); await Promise.resolve();
        expect(h.ctrl.hasRedo()).toBe(false); // cleared at queue body entry
        h.pending[1].resolve(jsonResponse({ annotation: annot('new-1') }));
        await h.ctrl.drain();

        h.ctrl.redoLast();
        await h.ctrl.drain();
        expect(h.pending).toHaveLength(2);
    });
});

describe('reset and generation counter', () => {
    it('reset replaces annotations and emits via setAnnotations', () => {
        h.ctrl.reset([annot('x1'), annot('x2')]);
        expect(h.annotations.map(a => a.id)).toEqual(['x1', 'x2']);
        expect(h.ctrl.hasRedo()).toBe(false);
        expect(h.ctrl.hasUndo()).toBe(true);
    });

    it('reset mid-flight (queued not started): later queued add does no UI work', async () => {
        h.ctrl.addLabel('confident', 100);
        h.ctrl.addLabel('blocked', 200);
        // enqueue schedules the body via Promise.then, so neither has run yet.
        // Resetting here bumps gen, so both queued bodies see a stale gen and
        // bail.
        h.ctrl.reset([annot('seed-1')]);

        await h.ctrl.drain();
        // The seeded state is intact; no POST was issued because the queue
        // bodies bailed at the gen check (before doing optimistic inserts or
        // fetch calls).
        expect(h.pending).toHaveLength(0);
        expect(h.annotations.map(a => a.id)).toEqual(['seed-1']);
    });

    it('reset mid-flight (started, optimistic already applied): post-await UI updates are skipped', async () => {
        h.ctrl.addLabel('confident', 100);
        // Let the queue body start and apply its optimistic insert.
        await Promise.resolve(); await Promise.resolve();
        expect(h.annotations).toHaveLength(1);
        expect(h.pending).toHaveLength(1);

        // Reset to a fresh set while POST is awaiting.
        h.ctrl.reset([annot('after-1')]);
        expect(h.annotations.map(a => a.id)).toEqual(['after-1']);

        // Resolve the POST that was issued before reset.
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-zombie') }));
        await h.ctrl.drain();

        // Annotations remain the reset value; the zombie POST result was
        // discarded by the gen check.
        expect(h.annotations.map(a => a.id)).toEqual(['after-1']);
        expect(h.onToast).not.toHaveBeenCalled();
        expect(h.onError).not.toHaveBeenCalled();
    });
});

describe('serialization', () => {
    it('add → add → undo → undo resolves in order; final state empty, redo holds both', async () => {
        h.ctrl.addLabel('confident', 100);
        h.ctrl.addLabel('blocked', 200);
        h.ctrl.undoLast();
        h.ctrl.undoLast();

        // Resolve each pending request in the order the queue issues them.
        for (let i = 0; i < 20 && h.pending.length < 1; i++) await new Promise(r => setTimeout(r, 0));
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-1', { label: 'confident', timestamp: 100 }) }));
        for (let i = 0; i < 20 && h.pending.length < 2; i++) await new Promise(r => setTimeout(r, 0));
        h.pending[1].resolve(jsonResponse({ annotation: annot('real-2', { label: 'blocked', timestamp: 200 }) }));
        for (let i = 0; i < 20 && h.pending.length < 3; i++) await new Promise(r => setTimeout(r, 0));
        expect(h.pending[2].url).toBe('/api/recordings/sess-1/annotations/real-2');
        h.pending[2].resolve(jsonResponse({ ok: true }));
        for (let i = 0; i < 20 && h.pending.length < 4; i++) await new Promise(r => setTimeout(r, 0));
        expect(h.pending[3].url).toBe('/api/recordings/sess-1/annotations/real-1');
        h.pending[3].resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();

        expect(h.annotations).toHaveLength(0);
        expect(h.ctrl.hasRedo()).toBe(true);
    });
});

describe('real-load ordering (codex r3 high)', () => {
    it('queueable mutations applied to a list loaded asynchronously via reset', async () => {
        // Simulates App.tsx: session id is set, then annotations arrive later
        // via reset(loaded). undoLast must operate on the loaded last item.
        expect(h.ctrl.hasUndo()).toBe(false);
        h.ctrl.reset([annot('loaded-1'), annot('loaded-2')]);
        expect(h.ctrl.hasUndo()).toBe(true);

        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        expect(h.pending[0].url).toBe('/api/recordings/sess-1/annotations/loaded-2');
        h.pending[0].resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();
        expect(h.annotations.map(a => a.id)).toEqual(['loaded-1']);
    });
});

describe('no-session and dispose', () => {
    it('addLabel is a no-op when sessionId is null', async () => {
        h.setSessionId(null);
        h.ctrl.addLabel('confident', 0);
        await h.ctrl.drain();
        expect(h.pending).toHaveLength(0);
    });

    it('dispose() causes subsequent queued bodies to bail', async () => {
        h.ctrl.addLabel('confident', 100);
        await Promise.resolve(); await Promise.resolve();
        expect(h.annotations).toHaveLength(1);
        h.ctrl.dispose();
        h.pending[0].resolve(jsonResponse({ annotation: annot('real-x') }));
        await h.ctrl.drain();
        // No further setAnnotations call because gen bumped during dispose.
        // Last value of h.annotations is whatever dispose left (we don't emit
        // on dispose). The assertion that matters: no real-x leaked.
        expect(h.annotations.find(a => a.id === 'real-x')).toBeUndefined();
    });
});

describe('toast describeAnnotation fallback', () => {
    it('uses text when no label is present (free-text annotation)', async () => {
        const free: Annotation = { id: 'free-1', timestamp: 1, text: 'reading the spec', createdAt: 1 };
        h.ctrl.reset([free]);
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();
        const toast = (h.onToast.mock.calls[0]?.[0] ?? {}) as AnnotationToast;
        expect(toast.kind).toBe('undo');
        expect(toast.text).toBe('reading the spec'); // <= 20 chars unchanged
    });

    it('truncates long text to 20 chars', async () => {
        const free: Annotation = {
            id: 'free-2',
            timestamp: 1,
            text: 'a really very long annotation text that should be truncated',
            createdAt: 1,
        };
        h.ctrl.reset([free]);
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();
        const toast = (h.onToast.mock.calls[0]?.[0] ?? {}) as AnnotationToast;
        expect(toast.text).toBe('a really very long a');
        expect(toast.text!.length).toBe(20);
    });

    it('falls back to "annotation" when both label and text are empty', async () => {
        const empty: Annotation = { id: 'e-1', timestamp: 1, text: '   ', createdAt: 1 };
        h.ctrl.reset([empty]);
        h.ctrl.undoLast();
        await Promise.resolve(); await Promise.resolve();
        h.pending[0].resolve(jsonResponse({ ok: true }));
        await h.ctrl.drain();
        const toast = (h.onToast.mock.calls[0]?.[0] ?? {}) as AnnotationToast;
        expect(toast.text).toBe('annotation');
    });
});

describe('redo with rater identity mismatch', () => {
    it('refuses to redo a marker whose raterName differs from the current session', async () => {
        let pending: PendingFetch[] = [];
        const fakeFetch: typeof fetch = (url, init) => new Promise((resolve, reject) => {
            pending.push({ url: String(url), init, resolve, reject });
        });
        const setAnnotations = vi.fn();
        const onToast = vi.fn();
        const onError = vi.fn();
        const ctrl = createAnnotationController({
            getSessionId: () => 'sess1',
            getRaterName: () => 'Alice',
            setAnnotations,
            onToast,
            onError,
            getFetcher: () => fakeFetch,
        });

        ctrl.reset([
            { id: 'a1', timestamp: 1000, text: '', label: 'confident', createdAt: 1100, raterName: 'Bob' },
        ]);
        ctrl.undoLast();
        await Promise.resolve();
        pending[0]?.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        await ctrl.drain();
        pending = [];

        ctrl.redoLast();
        await ctrl.drain();

        expect(onError).toHaveBeenCalledWith(
            expect.stringMatching(/different rater session/i),
        );
        expect(pending).toHaveLength(0);
        expect(ctrl.hasRedo()).toBe(false);
    });

    it('allows redo when raterName matches', async () => {
        let pending: PendingFetch[] = [];
        const fakeFetch: typeof fetch = (url, init) => new Promise((resolve) => {
            pending.push({ url: String(url), init, resolve, reject: () => {} });
        });
        const setAnnotations = vi.fn();
        const onToast = vi.fn();
        const onError = vi.fn();
        const ctrl = createAnnotationController({
            getSessionId: () => 'sess1',
            getRaterName: () => 'Alice',
            setAnnotations,
            onToast,
            onError,
            getFetcher: () => fakeFetch,
        });
        ctrl.reset([
            { id: 'a1', timestamp: 1000, text: '', label: 'confident', createdAt: 1100, raterName: 'Alice' },
        ]);
        ctrl.undoLast();
        await Promise.resolve();
        pending[0]?.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        await ctrl.drain();
        pending = [];

        ctrl.redoLast();
        await new Promise(r => setTimeout(r, 0));
        expect(pending).toHaveLength(1);
        expect(pending[0].init?.method).toBe('POST');
        pending[0].resolve(new Response(JSON.stringify({
            annotation: { id: 'srv-1', timestamp: 1000, text: '', label: 'confident', createdAt: 9999, raterName: 'Alice' },
        }), { status: 200 }));
        await ctrl.drain();
        expect(onError).not.toHaveBeenCalled();
    });
});

// Sanity: cover the unused AnnotationLabel import explicitly so eslint
// doesn't flag the type-only import.
const _typeAnchor: AnnotationLabel = 'confident';
void _typeAnchor;
