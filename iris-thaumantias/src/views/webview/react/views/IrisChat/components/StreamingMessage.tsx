import { useMemo } from 'react';
// @ts-expect-error - streamdown is ESM but TypeScript Node16 resolution complains. esbuild handles at bundle time.
import { Streamdown } from 'streamdown';
import { CodeBlock } from './CodeBlock';
import styles from './StreamingMessage.module.css';

interface StreamingMessageProps {
    chunks: string[];
}

export function StreamingMessage({ chunks }: StreamingMessageProps) {
    // Join all chunks into a single content string
    const content = useMemo(() => chunks.join(''), [chunks]);

    return (
        <div className={styles.streamingMessage}>
            <Streamdown
                mode="streaming"
                parseIncompleteMarkdown={true}
                animated={{
                    animation: 'fadeIn',
                    duration: 150,
                }}
                components={{
                    code: ({ node, className, children, ...props }) => {
                        // Check if this is a fenced code block (has language class)
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : undefined;

                        // If it's a fenced code block, render with CodeBlock
                        if (language || className?.includes('language-')) {
                            return (
                                <CodeBlock language={language}>
                                    {String(children).replace(/\n$/, '')}
                                </CodeBlock>
                            );
                        }

                        // Otherwise, render as inline code
                        return (
                            <code className={className} {...props}>
                                {children}
                            </code>
                        );
                    },
                }}
            >
                {content}
            </Streamdown>
        </div>
    );
}
