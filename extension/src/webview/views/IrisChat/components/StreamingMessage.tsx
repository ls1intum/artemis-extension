import { useMemo } from 'react';
// @ts-expect-error - streamdown is ESM but TypeScript Node16 resolution complains (TS1479). esbuild handles at bundle time.
import { Streamdown } from 'streamdown';
import { useStreamdownConfig } from '@webview/hooks/useStreamdownConfig';
import styles from './StreamingMessage.module.css';

interface StreamingMessageProps {
    chunks: string[];
}

export function StreamingMessage({ chunks }: StreamingMessageProps) {
    // Join all chunks into a single content string
    const content = useMemo(() => chunks.join(''), [chunks]);
    const streamdownComponents = useStreamdownConfig();

    return (
        <div className={styles.streamingMessage}>
            <Streamdown
                mode="streaming"
                parseIncompleteMarkdown={true}
                animated={{
                    animation: 'fadeIn',
                    duration: 150,
                }}
                components={streamdownComponents}
            >
                {content}
            </Streamdown>
        </div>
    );
}
