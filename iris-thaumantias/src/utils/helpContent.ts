export const IRIS_CHAT_HELP_MARKDOWN = `
# Iris Chat Context Guide

## Context Selection
Iris Chat operates within a specific **context** - either a course or an exercise. Your context determines what information Iris has access to and what help it can provide.

## How Context Works

**Exercise Context:**
- Iris can see the exercise description, test cases, and your code
- Get help with the specific requirements
- Ask about failing tests
- Request code review and suggestions

**Course Context:**
- Iris can see the overall course information
- Ask general questions about course topics
- Get help understanding concepts covered in the course

**Workspace Detection:**
- If you have an Artemis exercise open in your workspace, Iris will automatically detect it
- You'll see a lock icon indicating this is your workspace exercise

## Tips for Best Results

1. **Be specific:** Ask about particular parts of your code or specific test failures
2. **Provide context:** Mention which file or function you're working on
3. **Ask follow-ups:** Iris remembers your conversation, so you can build on previous questions

## Session Management

- Each context has multiple sessions - like separate conversations
- Create a new session to start fresh while keeping your old conversations
- Switch between sessions using the context selector dropdown

## Referenced Files

Iris can see files from your workspace (configurable in settings). Check the "Referenced Files" section to see which files Iris has access to for the current message.
`.trim();
