import { useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '../stores/useChatStore';

/**
 * Token buffering hook with RAF-based flushing at sentence boundaries.
 *
 * Buffers incoming tokens in a mutable ref (no re-render per token),
 * then flushes chunks to the store via requestAnimationFrame at 60Hz.
 *
 * Applies sentence boundary detection: flushes when buffer exceeds
 * ~50 tokens (200 chars) OR ends with sentence terminators (.!?\n).
 */
export function useStreamingMessage() {
    const bufferRef = useRef<string[]>([]);
    const rafIdRef = useRef<number | null>(null);
    const appendStreamChunk = useChatStore(state => state.appendStreamChunk);

    const appendToken = useCallback((token: string) => {
        bufferRef.current.push(token);
    }, []);

    // Sentence boundary detection
    const shouldFlush = useCallback((buffer: string): boolean => {
        if (buffer.length > 200) {
            return true;  // ~50 tokens
        }
        if (/[.!?\n]$/.test(buffer)) {
            return true;
        }
        return false;
    }, []);

    // RAF flush loop
    useEffect(() => {
        const flush = () => {
            if (bufferRef.current.length > 0) {
                const accumulated = bufferRef.current.join('');
                if (shouldFlush(accumulated)) {
                    bufferRef.current = [];
                    appendStreamChunk(accumulated);
                }
            }
            rafIdRef.current = requestAnimationFrame(flush);
        };
        rafIdRef.current = requestAnimationFrame(flush);

        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
            // Flush remaining buffer on cleanup
            if (bufferRef.current.length > 0) {
                const remaining = bufferRef.current.join('');
                bufferRef.current = [];
                appendStreamChunk(remaining);
            }
        };
    }, [shouldFlush, appendStreamChunk]);

    // Force flush (used when streaming ends)
    const forceFlush = useCallback(() => {
        if (bufferRef.current.length > 0) {
            const remaining = bufferRef.current.join('');
            bufferRef.current = [];
            appendStreamChunk(remaining);
        }
    }, [appendStreamChunk]);

    return { appendToken, forceFlush };
}
