# Artemis VS Code Extension

> 📋 [Changelog](https://github.com/ls1intum/artemis-extension/blob/main/CHANGELOG.md) · [Installation](#installation) · [Features](#features) · [Developer docs](DEVELOPER.md)

Seamlessly integrate **Artemis: Interactive Learning with Individual Feedback** directly into your VS Code environment. This extension brings Artemis (an interactive platform for programming exercises, instant feedback, and AI-powered tutoring) right into your IDE, so you can access personalized support, exercise materials, and intelligent feedback without leaving your workspace.

> Are you a developer working on the extension itself? See **[DEVELOPER.md](DEVELOPER.md)** for build, architecture, and release docs, and **[CONTRIBUTING.md](CONTRIBUTING.md)** for the contribution workflow.

## Screenshots

### Dashboard & Course Overview
![Dashboard](https://raw.githubusercontent.com/ls1intum/artemis-extension/main/extension/media/screenshots/dashboard.png)
*Access your courses, exercises, and get started with Iris AI tutor from the main dashboard*

### Iris AI Chat - Intelligent Tutoring
![Iris Chat](https://raw.githubusercontent.com/ls1intum/artemis-extension/main/extension/media/screenshots/iris-chat.png)
*Get context-aware help from Iris AI tutor without leaving VS Code*

### Real-Time Build Status & Test Results
![Test Results](https://raw.githubusercontent.com/ls1intum/artemis-extension/main/extension/media/screenshots/test-results.png)
*Monitor your submission results and test case performance in real-time*

## Features

### 🎓 Artemis Integration

- **Activity Bar Icons**: Quick access to Artemis and the Iris AI tutor from the activity bar
- **Secure Authentication**: Log in directly with your Artemis credentials
- **Course Browser**: View your enrolled courses and exercise details
- **Interactive Dashboard**: Overview of exercises, deadlines, and course activities
- **Exercise Management**: Clone repositories, submit solutions, and track your progress
- **Real-Time Updates**: WebSocket integration for live build results and notifications
- **Theme Support**: Choose from VSCode-native, modern, or synthwave visual themes

### 🤖 Iris AI Tutoring

**Iris** is an intelligent virtual tutor integrated into the extension, providing personalized learning support:

- **Context-Aware Assistance**: Get help based on your current programming exercise
- **Personalized Guidance**: Receive hints and explanations tailored to your work
- **Exercise Q&A**: Ask questions about lectures, exercises, and learning performance
- **Smart Hints**: Iris provides subtle guidance without giving away full solutions
- **Pro-Active Support**: Receive motivational messages and learning suggestions
- **Rate Limit Monitoring**: View your API usage and Iris availability status

### 📊 Service Monitoring

- **Health Status**: Monitor Artemis and Iris service availability
- **WebSocket Status**: Check the real-time connection status
- **Rate Limit Information**: Track your API usage quotas
- **Service Diagnostics**: Troubleshoot connectivity issues

### 🎨 Customizable Themes

Choose your preferred visual style:
- **VSCode Theme**: Native styling that matches your editor
- **Modern Theme**: Clean, card-based design with contemporary aesthetics
- **Synthwave Theme**: Retro-futuristic neon aesthetic

## Getting Started

### Requirements

- **VS Code** version 1.97.0 or higher
- Access to an **Artemis** server (e.g., `artemis.tum.de`)
- A valid Artemis account (student or instructor)

### Installation

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/) or [Open VSX](https://open-vsx.org/extension/aet-tum/iris-thaumantias)
2. Click the Artemis logo in the activity bar
3. Log in with your credentials

### Quick Start

1. **Log in**: Click the Artemis icon, then enter your server URL and credentials
2. **Browse courses**: Navigate your enrolled courses from the dashboard
3. **Select an exercise**: Click an exercise to view its details and instructions
4. **Clone the repository**: Use the clone action to start working locally
5. **Get AI help**: Click the Iris chat icon to ask questions about your exercise
6. **Submit your solution**: Use submit & push to hand in your work

## Commands

Access these via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- `Artemis: Login` - Open the login interface
- `Artemis: Logout` - Sign out of Artemis
- `Artemis: Check Iris Health Status` - View Iris availability and rate limits
- `Artemis: Check WebSocket Connection Status` - Verify the real-time connection
- `Artemis: Connect WebSocket` - Manually connect to the Artemis WebSocket
- `Artemis: Set Server URL` - Change the connected Artemis server

## Extension Settings

Configure the extension through VS Code settings (`Cmd+,` or `Ctrl+,`):

- `artemis.serverUrl` - Artemis server URL (default: `https://artemis.tum.de`)
- `artemis.iris.sendUncommittedChanges` - Allow Iris to access your uncommitted file changes
- `artemis.defaultCommitMessage` - Default commit message for automatic exercise submissions
- `artemis.showUnsavedChangesWarning` - Warn when there are unsaved changes before submitting
- `artemis.defaultClonePath` - Default folder where exercise repositories are cloned
- `artemis.showSetDefaultClonePathPrompt` - Ask to set a default clone folder on first clone
- `artemis.startPage` - Which page to show after logging in
- `artemis.showStartPageSuggestion` - Suggest configuring the start page when an exercise is detected
- `artemis.developerMode` - Enable developer mode (debug tools, extra diagnostics, and an always-visible WebSocket status indicator)

## About Artemis

Artemis is an interactive learning platform with instant, individual feedback on programming exercises, quizzes, modeling tasks, and more. It offers:

- **Programming Exercises**: Support for Java, Python, C, Swift, Kotlin, and many more languages
- **Automatic Feedback**: Instant feedback based on test cases and static code analysis
- **Multiple Exercise Types**: Programming, quiz, modeling, text, and file upload exercises
- **Exam Mode**: Online exams with variants and plagiarism detection
- **Learning Analytics**: Track competencies and progress with **Atlas**
- **AI Assessment**: Automated assessment support with **Athena**

Used by the Technical University of Munich (TUM), University of Stuttgart, Karlsruhe Institute of Technology (KIT), TU Wien, JKU Linz, LFU Innsbruck, and many more. Learn more at [artemisapp.github.io](https://artemisapp.github.io).

### Iris & EduTelligence

This extension integrates **Iris**, an AI-powered virtual tutor from the EduTelligence suite, providing intelligent assistance through context-aware guidance and personalized learning support.

## Privacy & Data

- Your credentials are stored securely in VS Code's secret storage
- Communication with Artemis servers uses HTTPS encryption
- Iris interactions may be logged for quality improvement (per your institution's policies)

## Support

- **Artemis Documentation**: [docs.artemis.cit.tum.de](https://docs.artemis.cit.tum.de)
- **Artemis Platform**: [artemisapp.github.io](https://artemisapp.github.io)
- **Issues**: [GitHub Issues](https://github.com/ls1intum/artemis-extension/issues)

## Contributing

Contributions are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow and **[DEVELOPER.md](DEVELOPER.md)** for build and architecture docs.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Enjoy enhanced learning with Artemis in VS Code! 🚀**
