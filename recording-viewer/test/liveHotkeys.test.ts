import { describe, it, expect, vi } from 'vitest';
import { handleLiveHotkey } from '../src/hooks/useLiveHotkeys';
import type { AnnotationLabel } from '../src/types';

interface KeyEventInit {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    repeat?: boolean;
    target?: { tagName?: string; isContentEditable?: boolean } | null;
}

function makeEvent(init: KeyEventInit): KeyboardEvent {
    const preventDefault = vi.fn();
    return {
        key: init.key,
        ctrlKey: init.ctrlKey ?? false,
        metaKey: init.metaKey ?? false,
        shiftKey: init.shiftKey ?? false,
        altKey: init.altKey ?? false,
        repeat: init.repeat ?? false,
        target: init.target ?? null,
        preventDefault,
    } as unknown as KeyboardEvent;
}

function makeHandlers(): {
    onLabel: ReturnType<typeof vi.fn<[AnnotationLabel], void>>;
    onUndo: ReturnType<typeof vi.fn>;
    onRedo: ReturnType<typeof vi.fn>;
} {
    return {
        onLabel: vi.fn<[AnnotationLabel], void>(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
    };
}

describe('handleLiveHotkey — undo/redo', () => {
    it('Cmd+Z fires onUndo and prevents default', () => {
        const h = makeHandlers();
        const e = makeEvent({ key: 'z', metaKey: true });
        handleLiveHotkey(e, h);
        expect(h.onUndo).toHaveBeenCalledTimes(1);
        expect(h.onRedo).not.toHaveBeenCalled();
        expect(h.onLabel).not.toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('Ctrl+Z fires onUndo', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'z', ctrlKey: true }), h);
        expect(h.onUndo).toHaveBeenCalledTimes(1);
    });

    it('Cmd+Shift+Z fires onRedo', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'z', metaKey: true, shiftKey: true }), h);
        expect(h.onRedo).toHaveBeenCalledTimes(1);
        expect(h.onUndo).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+Z fires onRedo', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'z', ctrlKey: true, shiftKey: true }), h);
        expect(h.onRedo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y fires onRedo (Windows/Linux idiom)', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'y', ctrlKey: true }), h);
        expect(h.onRedo).toHaveBeenCalledTimes(1);
    });

    it('Cmd+Y does NOT fire onRedo (macOS history shortcut, leave to browser)', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'y', metaKey: true }), h);
        expect(h.onRedo).not.toHaveBeenCalled();
        expect(h.onUndo).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+Z does not fire either (alt guard)', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'z', ctrlKey: true, altKey: true }), h);
        expect(h.onUndo).not.toHaveBeenCalled();
        expect(h.onRedo).not.toHaveBeenCalled();
    });

    it('Cmd+Z with onUndo undefined is a no-op (no crash, no preventDefault)', () => {
        const e = makeEvent({ key: 'z', metaKey: true });
        handleLiveHotkey(e, { onLabel: vi.fn() });
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('held Cmd+Z (repeat=true) still fires onUndo (text-editor parity)', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'z', metaKey: true, repeat: true }), h);
        expect(h.onUndo).toHaveBeenCalledTimes(1);
    });
});

describe('handleLiveHotkey — input-focus guards', () => {
    for (const tag of ['INPUT', 'TEXTAREA']) {
        it(`${tag} target suppresses ALL hotkeys (browser-native should run)`, () => {
            const h = makeHandlers();
            const target = { tagName: tag };
            handleLiveHotkey(makeEvent({ key: '1', target }), h);
            handleLiveHotkey(makeEvent({ key: 'z', metaKey: true, target }), h);
            handleLiveHotkey(makeEvent({ key: 'y', ctrlKey: true, target }), h);
            expect(h.onLabel).not.toHaveBeenCalled();
            expect(h.onUndo).not.toHaveBeenCalled();
            expect(h.onRedo).not.toHaveBeenCalled();
        });
    }

    it('contentEditable target suppresses ALL hotkeys', () => {
        const h = makeHandlers();
        const target = { tagName: 'DIV', isContentEditable: true };
        handleLiveHotkey(makeEvent({ key: '1', target }), h);
        handleLiveHotkey(makeEvent({ key: 'z', metaKey: true, target }), h);
        expect(h.onLabel).not.toHaveBeenCalled();
        expect(h.onUndo).not.toHaveBeenCalled();
    });
});

describe('handleLiveHotkey — label hotkeys still work', () => {
    it.each([
        ['1', 'confident'],
        ['2', 'light-struggle'],
        ['3', 'medium-struggle'],
        ['4', 'high-struggle'],
        ['5', 'blocked'],
        ['q', 'idle'],
        ['w', 'trial-error'],
        ['e', 'reading'],
        ['r', 'off-task'],
        ['t', 'using-ai'],
        ['i', 'iris-moment'],
        ['u', 'reading-test-results'],
    ] as Array<[string, AnnotationLabel]>)('"%s" → onLabel("%s")', (key, expected) => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key }), h);
        expect(h.onLabel).toHaveBeenCalledWith(expected);
    });

    it('label key with e.repeat=true is suppressed', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: '1', repeat: true }), h);
        expect(h.onLabel).not.toHaveBeenCalled();
    });

    it('label key with any modifier is suppressed', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: '1', ctrlKey: true }), h);
        handleLiveHotkey(makeEvent({ key: '1', metaKey: true }), h);
        handleLiveHotkey(makeEvent({ key: '1', altKey: true }), h);
        expect(h.onLabel).not.toHaveBeenCalled();
    });

    it('unknown key is a no-op', () => {
        const h = makeHandlers();
        handleLiveHotkey(makeEvent({ key: 'p' }), h);
        expect(h.onLabel).not.toHaveBeenCalled();
    });
});
