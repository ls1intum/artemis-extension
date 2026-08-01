export const IRIS_CHAT_HELP_MARKDOWN = `
# Iris Chat Guide

## One conversation at a time
Iris chat shows one conversation, and it lives on Artemis. Everything you see here is what the server has: open the same conversation in the Artemis web client and it is the same messages.

## Topic
The topic is what your next message is about, shown as a chip above the input.

**Exercise topic:**
- Iris can see the exercise description, the test cases and your code
- Ask about failing tests, requirements, or your current approach

**Course chat (no topic):**
- Iris can see the course information
- Ask general questions about the course and its concepts

Use the **+** button beside the chip to choose a topic, or the small **x** on the chip to drop it and talk about the course instead. On an empty conversation the topic simply changes in place. Once the conversation has messages, choosing a different topic opens the conversation that belongs to it, or starts a new one, so what you have already written stays where it was written.

## Switching conversations
- The **course name** in the header opens your course list. Switching course opens that course's conversation.
- The **history** button lists every conversation in the current course, newest first, with the open one checked. Lecture and text-exercise conversations are listed too and can be continued, even though they cannot be chosen as a topic.
- The **+** button in the header starts a fresh conversation in the same course, carrying the current topic over.

## Workspace exercise
If you have an Artemis exercise open in your workspace, it is detected automatically and marked **Workspace** at the top of the topic list.

## Referenced files
Iris can see files from your workspace (configurable in settings). Check the "Referenced Files" section to see which files Iris has access to for the current message.

## If something looks stale
**Artemis: Reload Iris Chat** (also in the side menu) drops everything cached locally and re-reads the conversation from the server. Nothing is deleted on Artemis.

## Tips for best results
1. **Be specific:** ask about particular parts of your code or specific test failures
2. **Provide context:** mention which file or function you are working on
3. **Ask follow-ups:** Iris remembers the conversation, so you can build on previous questions
`.trim();
