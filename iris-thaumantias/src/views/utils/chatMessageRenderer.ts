import { IconDefinitions } from '../../utils/iconDefinitions';

/**
 * Generates the JavaScript functions for chat message rendering in webview scripts.
 * Includes message display, feedback handling, and thinking indicators.
 * 
 * @returns JavaScript code string containing chat message rendering functions
 */
export function getChatMessageRendererScript(): string {
    const thumbsUpIcon = IconDefinitions.getIcon('thumbs-up');
    const thumbsDownIcon = IconDefinitions.getIcon('thumbs-down');

    return `
        // Chat message handling
        function handleFeedbackClick(button, message) {
            const feedbackType = button.getAttribute('data-feedback');
            const parentMessage = button.closest('.chat-message');
            const feedbackContainer = parentMessage.querySelector('.message-feedback');
            const allButtons = parentMessage.querySelectorAll('.feedback-button');

            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Iris Chat] Feedback clicked: ' + feedbackType + ' for message: ' + JSON.stringify(message) });

            // Don't allow clicking the same button again (no undo, only change)
            if (button.classList.contains('selected')) {
                return;
            }

            // Check if we have the required IDs
            const activeSession = irisState.sessions.find(session => session.id === irisState.activeSessionId);
            if (!activeSession || !activeSession.artemisSessionId) {
                vscode.postMessage({ command: 'webviewLog', level: 'warn', message: 'No active Artemis session found' });
                return;
            }

            if (!message.id) {
                vscode.postMessage({ command: 'webviewLog', level: 'warn', message: 'Message has no ID, cannot submit feedback' });
                return;
            }

            // Remove selection from all buttons
            allButtons.forEach(btn => {
                btn.classList.remove('selected');
            });

            // Select the clicked button
            button.classList.add('selected');

            // Add has-feedback class to keep buttons visible
            if (feedbackContainer) {
                feedbackContainer.classList.add('has-feedback');
            }

            // Update the message object's helpful field
            message.helpful = feedbackType === 'positive' ? true : false;

            // Send feedback to extension
            vscode.postMessage({
                command: 'messageFeedback',
                sessionId: activeSession.artemisSessionId,
                messageId: message.id,
                feedback: feedbackType,
                message: message
            });
        }

        function generateFeedbackButtons() {
            return \`
                <div class="message-feedback">
                    <button class="feedback-button thumbs-up" data-feedback="positive" title="This was helpful">
                        ${thumbsUpIcon}
                    </button>
                    <button class="feedback-button thumbs-down" data-feedback="negative" title="This could be better">
                        ${thumbsDownIcon}
                    </button>
                </div>
            \`;
        }

        function addMessageToChat(message) {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 📩 addMessageToChat called: ' + JSON.stringify({ role: message.role, contentLength: message.content?.length, timestamp: message.timestamp }) });
            const chatMessages = document.getElementById('chatMessages');

            // Remove welcome message if present
            const welcomeMsg = chatMessages.querySelector('.welcome-message');
            if (welcomeMsg) {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🗑️ Removing welcome message' });
                welcomeMsg.remove();
            }

            const messageDiv = document.createElement('div');
            messageDiv.className = \`chat-message \${message.role}\`;

            const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const feedbackButtons = message.role === 'assistant' ? generateFeedbackButtons() : '';

            messageDiv.innerHTML = \`
                <div class="message-header">
                    <span class="message-sender">\${message.role === 'user' ? 'You' : 'Iris'}</span>
                    <span class="message-time">\${time}</span>
                </div>
                <div class="message-content">\${formatMessageContent(message.content)}</div>
                \${feedbackButtons}
            \`;

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Add event listeners for feedback buttons if this is an assistant message
            if (message.role === 'assistant') {
                const feedbackContainer = messageDiv.querySelector('.message-feedback');
                const feedbackBtns = messageDiv.querySelectorAll('.feedback-button');
                
                // Apply existing feedback state if present
                if (message.helpful === true) {
                    const thumbsUpBtn = messageDiv.querySelector('.thumbs-up');
                    if (thumbsUpBtn) {
                        thumbsUpBtn.classList.add('selected');
                        if (feedbackContainer) {
                            feedbackContainer.classList.add('has-feedback');
                        }
                    }
                } else if (message.helpful === false) {
                    const thumbsDownBtn = messageDiv.querySelector('.thumbs-down');
                    if (thumbsDownBtn) {
                        thumbsDownBtn.classList.add('selected');
                        if (feedbackContainer) {
                            feedbackContainer.classList.add('has-feedback');
                        }
                    }
                }
                
                feedbackBtns.forEach(button => {
                    button.addEventListener('click', function(event) {
                        event.stopPropagation();
                        handleFeedbackClick(this, message);
                    });
                });
            }

            // Show thinking indicator after user message, hide after assistant message
            if (message.role === 'user') {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 👤 User message - showing thinking indicator' });
                showThinkingIndicator();
            } else {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🤖 Assistant message - hiding thinking indicator' });
                hideThinkingIndicator();
            }

            // Update new session button state
            updateNewSessionButtonState();
        }

        function loadMessages(messages) {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Iris Chat] Loading messages: ' + JSON.stringify(messages) });
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = '';
            
            if (!messages || messages.length === 0) {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[Iris Chat] No messages to load' });
                updateNewSessionButtonState();
                return;
            }
            
            messages.forEach(msg => addMessageToChat(msg));
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: 'Loaded ' + messages.length + ' messages' });
        }

        function showThinkingIndicator() {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🔄 showThinkingIndicator called' });
            const chatMessages = document.getElementById('chatMessages');

            // Remove any existing thinking indicator
            const existing = chatMessages.querySelector('.thinking-indicator');
            if (existing) {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🗑️ Removing existing thinking indicator' });
                existing.remove();
            }

            // Create thinking indicator
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'message assistant-message thinking-indicator';
            thinkingDiv.innerHTML = \`
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            \`;

            chatMessages.appendChild(thinkingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ✅ Thinking indicator added to chat' });
        }

        function hideThinkingIndicator() {
            vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🚫 hideThinkingIndicator called' });
            const chatMessages = document.getElementById('chatMessages');
            const existing = chatMessages.querySelector('.thinking-indicator');
            if (existing) {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] 🗑️ Removing thinking indicator' });
                existing.remove();
            } else {
                vscode.postMessage({ command: 'webviewLog', level: 'info', message: '[WebsocketLog] ℹ️ No thinking indicator to remove' });
            }
        }
    `;
}
