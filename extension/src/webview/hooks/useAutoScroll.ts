import { useCallback } from 'react';
// @ts-expect-error - ES module import handled by esbuild at bundle time (TS1479: Node16 module resolution vs ESM)
import { useStickToBottom } from 'use-stick-to-bottom';

/**
 * Smart auto-scroll hook with user intent detection.
 *
 * Wraps use-stick-to-bottom to provide:
 * - Auto-scroll when user is near bottom
 * - Stop scrolling when user scrolls up to read history
 * - Resume on new user message send
 *
 * Usage:
 *   const { scrollRef, contentRef, isAtBottom, scrollOnSend } = useAutoScroll();
 *
 *   <div ref={scrollRef} className={styles.scrollContainer}>
 *     <div ref={contentRef}>
 *       {messages.map(...)}
 *     </div>
 *   </div>
 */
export function useAutoScroll() {
    const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();

    // Sending a message is explicit intent to follow the conversation.
    const scrollOnSend = useCallback(() => {
        scrollToBottom();
    }, [scrollToBottom]);

    return {
        scrollRef,       // Attach to the scroll container div
        contentRef,      // Attach to the content wrapper inside the scroll container
        isAtBottom,
        scrollOnSend,    // Call after sending a message
        scrollToBottom,
    };
}
