import { useEffect } from 'react';
import type { AnnotationLabel, StruggleLevel, ContextMarker } from '../types';

const STRUGGLE_KEYS: Record<string, StruggleLevel> = {
    '1': 'confident', '2': 'light-struggle', '3': 'medium-struggle', '4': 'high-struggle', '5': 'blocked',
};
export const CONTEXT_KEYS: Record<string, ContextMarker> = {
    'q': 'idle', 'w': 'trial-error', 'e': 'reading', 'r': 'off-task', 't': 'using-ai', 'i': 'iris-moment', 'u': 'reading-test-results', 'b': 'waiting-for-build-results',
};

export interface LiveHotkeyHandlers {
    onLabel: (label: AnnotationLabel) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onEscape?: () => boolean; // returns true if it consumed the Escape (had something to clear)
}

/** Pure function form of the keydown handler. Exported for unit testing.
 *  Returns true if the event was handled (so caller can decide whether to
 *  call preventDefault — we do it inline here). */
export function handleLiveHotkey(e: KeyboardEvent, handlers: LiveHotkeyHandlers): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    if (e.key === 'Escape') {
        if (handlers.onEscape?.()) e.preventDefault();
        return;
    }

    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey;
    const meta = e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;

    // Undo / redo: handle BEFORE the label-key branch and BEFORE the
    // generic modifier early-return. `e.repeat` is intentionally NOT blocked
    // here so holding Cmd+Z walks history (text-editor parity).
    if ((ctrl || meta) && !alt && key === 'z') {
        if (shift) {
            if (handlers.onRedo) { e.preventDefault(); handlers.onRedo(); }
        } else {
            if (handlers.onUndo) { e.preventDefault(); handlers.onUndo(); }
        }
        return;
    }
    // Ctrl+Y is redo on Windows/Linux. Cmd+Y on macOS is "history" in
    // browsers, so guard with !meta.
    if (ctrl && !meta && !alt && !shift && key === 'y') {
        if (handlers.onRedo) { e.preventDefault(); handlers.onRedo(); }
        return;
    }

    // Label hotkeys DO suppress repeat (don't want to flood markers from key-held).
    if (e.repeat) return;
    if (meta || ctrl || alt) return;
    const struggle = STRUGGLE_KEYS[key];
    if (struggle) { e.preventDefault(); handlers.onLabel(struggle); return; }
    const ctx = CONTEXT_KEYS[key];
    if (ctx) { e.preventDefault(); handlers.onLabel(ctx); }
}

export function useLiveHotkeys(
    enabled: boolean,
    onLabel: (label: AnnotationLabel) => void,
    onUndo?: () => void,
    onRedo?: () => void,
    onEscape?: () => boolean,
): void {
    useEffect(() => {
        if (!enabled) return;
        const handler = (e: KeyboardEvent) => handleLiveHotkey(e, { onLabel, onUndo, onRedo, onEscape });
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [enabled, onLabel, onUndo, onRedo, onEscape]);
}
