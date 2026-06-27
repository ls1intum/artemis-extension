import type { ChatMessage } from '@webview/views/IrisChat/types';

/**
 * One renderable row in the chat list.
 *
 * `single` is any message rendered as its own bubble. `proactive-run` is a
 * maximal run of consecutive proactive Iris messages (no student turn between
 * them): the run collapses to its latest suggestion, with the earlier ones
 * tucked behind an expandable toggle so repeated nags about the same situation
 * do not clutter the chat. The engine intentionally re-alerts while a struggle
 * persists; this only changes the *display*, never the detection.
 */
export type ChatRenderItem =
    | { kind: 'single'; message: ChatMessage }
    | { kind: 'proactive-run'; earlier: ChatMessage[]; latest: ChatMessage };

const isProactive = (m: ChatMessage): boolean =>
    m.role === 'assistant' && m.origin === 'proactive';

/**
 * Groups consecutive proactive messages into a single collapsible run. Any
 * non-proactive message (a user turn or a normal assistant reply) breaks the
 * run, so distinct help episodes the student actually engaged with stay
 * separate. Pure and order-preserving; never mutates the input.
 */
export function groupProactiveMessages(messages: ChatMessage[]): ChatRenderItem[] {
    const items: ChatRenderItem[] = [];
    let run: ChatMessage[] = [];

    const flushRun = (): void => {
        if (run.length === 0) {
            return;
        }
        if (run.length === 1) {
            items.push({ kind: 'single', message: run[0] });
        } else {
            items.push({
                kind: 'proactive-run',
                earlier: run.slice(0, -1),
                latest: run[run.length - 1],
            });
        }
        run = [];
    };

    for (const message of messages) {
        if (isProactive(message)) {
            run.push(message);
        } else {
            flushRun();
            items.push({ kind: 'single', message });
        }
    }
    flushRun();

    return items;
}
