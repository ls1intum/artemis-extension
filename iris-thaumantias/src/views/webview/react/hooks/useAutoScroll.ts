import { useCallback } from 'react';
// @ts-expect-error - ES module import handled by esbuild at bundle time
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

    // Scroll to bottom when user sends a message (explicit intent to follow conversation)
    const scrollOnSend = useCallback(() => {
        scrollToBottom();
    }, [scrollToBottom]);

    return {
        scrollRef,       // Attach to scroll container div
        contentRef,      // Attach to content wrapper div inside scroll container
        isAtBottom,      // Whether user is near bottom (for UI indicators)
        scrollOnSend,    // Call after sending a message
        scrollToBottom,  // Manual scroll to bottom
    };
}
