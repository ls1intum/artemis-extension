import { useEffect, useRef } from 'react';

import { postCommand, type VsCodeApi } from '@shared/messageContracts';
import type {
    ProblemStatementScrollPayload,
    ProblemStatementSelectionPayload,
} from '@shared/messageContracts/webviewCommands';

// Debounce windows follow the recorder's editor-side precedent
// (ObservationRegistry: 300ms visible-range, 200ms selection).
const SCROLL_DEBOUNCE_MS = 300;
const SELECTION_DEBOUNCE_MS = 200;
const MAX_SELECTION_LENGTH = 500;

function scrollPayloadsEqual(a: ProblemStatementScrollPayload, b: ProblemStatementScrollPayload): boolean {
    return a.scrollTop === b.scrollTop
        && a.scrollHeight === b.scrollHeight
        && a.viewportHeight === b.viewportHeight
        && a.statementTop === b.statementTop
        && a.statementHeight === b.statementHeight;
}

// Dedupe key: text + length + the four geometry integers. selectionLength is
// redundant for uncapped texts but discriminates selections that share the
// same capped 500-char prefix; `truncated` stays derived (selectionLength).
function selectionPayloadsEqual(a: ProblemStatementSelectionPayload, b: ProblemStatementSelectionPayload): boolean {
    return a.selectedText === b.selectedText
        && a.selectionLength === b.selectionLength
        && a.selectionTop === b.selectionTop
        && a.selectionLeft === b.selectionLeft
        && a.selectionWidth === b.selectionWidth
        && a.selectionHeight === b.selectionHeight;
}

/**
 * Records reading behavior in the problem statement for the session recorder
 * (issue #281): page scroll position + statement geometry, and text
 * selections inside the statement container.
 *
 * The whole ExerciseDetail page scrolls (the statement has no own scroll
 * container), so scroll events are window-level and carry the statement's
 * document-relative geometry, read fresh at emit time.
 *
 * Baseline geometry re-emits on: mount, `bodyHtml` change (SSR replacement
 * keeps the element identity), ResizeObserver on the statement AND
 * `document.body` (KaTeX/image resizes, upstream layout shifts), and window
 * resize (viewport-only changes). All routes share one trailing debounce and
 * identical payloads are suppressed, so no-op triggers emit nothing.
 *
 * Consent gating happens extension-side in the SessionRecorder (single gate);
 * the webview always posts. Pending emits are flushed on cleanup while the
 * element is still connected — detached geometry would be garbage, so a
 * disposed webview loses at most the last debounce window (accepted in spec).
 */
export function useProblemStatementTracking(
    element: HTMLElement | null,
    bodyHtml: string | undefined,
    vscodeApi: VsCodeApi,
): void {
    // Last EMITTED payloads survive effect re-runs so re-baselines and
    // re-fires with unchanged values stay suppressed.
    const lastScrollRef = useRef<ProblemStatementScrollPayload | null>(null);
    const lastSelectionRef = useRef<ProblemStatementSelectionPayload | null>(null);

    // ── Scroll + baseline ───────────────────────────────────────────────
    useEffect(() => {
        if (!element || bodyHtml === undefined) {
            return;
        }

        let pendingTimer: number | undefined;

        const emit = () => {
            pendingTimer = undefined;
            if (!element.isConnected) {
                return;
            }
            const rect = element.getBoundingClientRect();
            const payload: ProblemStatementScrollPayload = {
                scrollTop: Math.round(window.scrollY),
                scrollHeight: Math.round(document.documentElement.scrollHeight),
                viewportHeight: Math.round(window.innerHeight),
                statementTop: Math.round(rect.top + window.scrollY),
                statementHeight: Math.round(rect.height),
            };
            if (lastScrollRef.current && scrollPayloadsEqual(lastScrollRef.current, payload)) {
                return;
            }
            lastScrollRef.current = payload;
            postCommand(vscodeApi, 'problemStatementScroll', payload);
        };

        const schedule = () => {
            if (pendingTimer !== undefined) {
                window.clearTimeout(pendingTimer);
            }
            pendingTimer = window.setTimeout(emit, SCROLL_DEBOUNCE_MS);
        };

        // Baseline: mount / element change / bodyHtml change.
        schedule();
        window.addEventListener('scroll', schedule);
        window.addEventListener('resize', schedule);

        let observer: ResizeObserver | undefined;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(schedule);
            observer.observe(element);
            // Body resize is the proxy for layout shifts above the statement
            // that move statementTop without resizing the statement itself.
            observer.observe(document.body);
        }

        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            observer?.disconnect();
            if (pendingTimer !== undefined) {
                window.clearTimeout(pendingTimer);
                emit(); // flush — recorder-side gating makes this consent-safe
            }
        };
    }, [element, bodyHtml, vscodeApi]);

    // ── Selection ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!element) {
            return;
        }

        let pendingTimer: number | undefined;

        const emit = () => {
            pendingTimer = undefined;
            // Same detached-DOM hazard as the scroll flush: a cleanup-time
            // flush after the statement div unmounted would read stale
            // range geometry from a detached tree.
            if (!element.isConnected) {
                return;
            }
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                lastSelectionRef.current = null;
                return;
            }
            const { anchorNode, focusNode } = selection;
            if (!anchorNode || !focusNode || !element.contains(anchorNode) || !element.contains(focusNode)) {
                lastSelectionRef.current = null;
                return;
            }
            const text = selection.toString();
            if (text.length === 0) {
                lastSelectionRef.current = null;
                return;
            }
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            const payload: ProblemStatementSelectionPayload = {
                selectedText: text.slice(0, MAX_SELECTION_LENGTH),
                selectionLength: text.length,
                truncated: text.length > MAX_SELECTION_LENGTH,
                selectionTop: Math.round(rect.top + window.scrollY),
                selectionLeft: Math.round(rect.left + window.scrollX),
                selectionWidth: Math.round(rect.width),
                selectionHeight: Math.round(rect.height),
            };
            if (lastSelectionRef.current && selectionPayloadsEqual(lastSelectionRef.current, payload)) {
                return;
            }
            lastSelectionRef.current = payload;
            postCommand(vscodeApi, 'problemStatementSelection', payload);
        };

        const schedule = () => {
            if (pendingTimer !== undefined) {
                window.clearTimeout(pendingTimer);
            }
            pendingTimer = window.setTimeout(emit, SELECTION_DEBOUNCE_MS);
        };

        document.addEventListener('selectionchange', schedule);

        return () => {
            document.removeEventListener('selectionchange', schedule);
            if (pendingTimer !== undefined) {
                window.clearTimeout(pendingTimer);
                emit(); // flush
            }
        };
    }, [element, vscodeApi]);
}
