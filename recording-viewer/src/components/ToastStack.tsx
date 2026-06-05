/* eslint-disable react-refresh/only-export-components */
import { useEffect } from 'react';
import { ALL_LABELS } from '../types';
import type { AnnotationToast } from '../hooks/annotationController';

/** How long each toast stays on screen before it auto-dismisses. Drives both the
 *  per-item dismissal timer and the inline `animationDuration`; the CSS keyframe is
 *  percentage-based, so the fade scales to this single value. */
export const TOAST_DURATION_MS = 2500;
/** Max simultaneously visible toasts; a burst beyond this drops the oldest. */
export const MAX_TOASTS = 5;

export type ActiveToast = AnnotationToast & { id: number };

/** Append `toast`, trimming the oldest entries so the list never exceeds `max`. */
export function appendToast(list: ActiveToast[], toast: ActiveToast, max: number): ActiveToast[] {
    const next = [...list, toast];
    return next.length > max ? next.slice(next.length - max) : next;
}

function renderToast(toast: AnnotationToast): string {
    const labelName = toast.label
        ? (ALL_LABELS.find(l => l.value === toast.label)?.label ?? toast.label)
        : null;
    const body = labelName ?? toast.text ?? 'annotation';
    switch (toast.kind) {
        case 'add': return `+ ${body}`;
        case 'undo': return `↶ ${body}`;
        case 'redo': return `↷ ${body}`;
        case 'error': return `⚠ ${body}`;
    }
    // Compile-time exhaustiveness guard: if a new toast kind is added, this fails to type-check.
    const _exhaustive: never = toast.kind;
    return _exhaustive;
}

interface ToastItemProps {
    toast: ActiveToast;
    durationMs: number;
    onDismiss: (id: number) => void;
}

function ToastItem({ toast, durationMs, onDismiss }: ToastItemProps) {
    useEffect(() => {
        const timer = setTimeout(() => onDismiss(toast.id), durationMs);
        return () => clearTimeout(timer);
    }, [toast.id, durationMs, onDismiss]);

    // animationDuration is driven from the single durationMs source so the CSS fade
    // cannot drift from the JS removal timer.
    return (
        <div
            className={`annotation-toast annotation-toast-${toast.kind}`}
            style={{ animationDuration: `${durationMs}ms` }}
        >
            {renderToast(toast)}
        </div>
    );
}

interface ToastStackProps {
    toasts: ActiveToast[];
    durationMs: number;
    onDismiss: (id: number) => void;
}

/** Fixed bottom-right overlay. Toasts are passed oldest-first; the newest renders
 *  last so it sits closest to the corner, with older ones stacked above it. */
export function ToastStack({ toasts, durationMs, onDismiss }: ToastStackProps) {
    if (toasts.length === 0) return null;
    return (
        <div className="annotation-toast-stack">
            {toasts.map(t => (
                <ToastItem key={t.id} toast={t} durationMs={durationMs} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
