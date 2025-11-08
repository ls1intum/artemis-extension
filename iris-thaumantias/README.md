# Artemis VS Code Extension

> 📋 [View Changelog](../CHANGELOG.md) | [Installation](#installation) | [Features](#features)

Seamlessly integrate **Artemis: Interactive Learning with Individual Feedback** directly into your VS Code environment. This extension brings the power of Artemis—an innovative platform for interactive learning, programming exercises, and AI-powered tutoring—right to your IDE, enabling students to access personalized support, exercise materials, and intelligent feedback without leaving their development workspace.

## Screenshots

### Dashboard & Course Overview
![Dashboard](https://raw.githubusercontent.com/ls1intum/artemis-extension/main/iris-thaumantias/media/screenshots/dashboard.png)
*Access your courses, exercises, and get started with Iris AI tutor from the main dashboard*

### Iris AI Chat - Intelligent Tutoring
![Iris Chat](https://raw.githubusercontent.com/ls1intum/artemis-extension/main/iris-thaumantias/media/screenshots/iris-chat.png)
*Get context-aware help from Iris AI tutor without leaving VS Code*

### Real-Time Build Status & Test Results
![Test Results](https://raw.githubusercontent.com/ls1intum/artemis-extension/main/iris-thaumantias/media/screenshots/test-results.png)
*Monitor your submission results and test case performance in real-time*


## Features

### 🎓 Artemis Integration

- **Activity Bar Icons**: Quick access to Artemis and Iris AI tutor from the activity bar
- **Secure Authentication**: Login directly with your Artemis credentials
- **Course Browser**: View your enrolled courses and exercise details
- **Interactive Dashboard**: Overview of exercises, deadlines, and course activities
- **Exercise Management**: Clone repositories, submit solutions, and track your progress
- **Real-Time Updates**: WebSocket integration for live notifications and updates
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

- **Health Status Dashboard**: Monitor Artemis and Iris service availability
- **WebSocket Status**: Check real-time connection status
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
- Access to an **Artemis** server (e.g., artemis.tum.de)
- Valid Artemis account (student or instructor)

### Installation

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/)
2. Click the Artemis logo in the activity bar
3. Login with your credentials

### Quick Start

1. **Login**: Click the Artemis icon → Enter your server URL and credentials
2. **Browse Courses**: Navigate your enrolled courses from the dashboard
3. **Select Exercise**: Click on an exercise to view details and instructions
4. **Clone Repository**: Use the "Clone Repository" button to start working locally
5. **Get AI Help**: Click the Iris chat icon to ask questions about your exercise
6. **Submit Solution**: Use "Submit & Push" to submit your work

## Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- `Artemis: Login to Artemis` - Open the login interface
- `Artemis: Check Iris Health Status` - View Iris availability and rate limits
- `Artemis: Check WebSocket Connection Status` - Verify real-time connection
- `Artemis: Connect to Artemis WebSocket` - Manually connect to WebSocket

## Extension Settings

Configure through VS Code settings (`Cmd+,` or `Ctrl+,`):

- `artemis.serverUrl` - Artemis server URL (default: `https://artemis.tum.de`)
- `artemis.theme` - Visual theme: `vscode`, `modern`, or `synthwave`
- `artemis.showIrisExplanation` - Show/hide Iris usage explanation on dashboard
- `artemis.hideDeveloperTools` - Hide developer debugging tools
- `artemis.defaultCommitMessage` - Default message for automatic submissions
- `artemis.showUnsavedChangesWarning` - Warn before submitting with unsaved changes

## About Artemis

Artemis is an interactive learning platform with instant, individual feedback on programming exercises, quizzes, modeling tasks, and more. It offers:

### Key Capabilities

- **Programming Exercises**: Support for Java, Python, C, Swift, Kotlin, and many more languages
- **Automatic Feedback**: Instant feedback based on test cases and static code analysis
- **Multiple Exercise Types**: Programming, quiz, modeling, text, and file upload exercises
- **Exam Mode**: Online exams with variants and plagiarism detection
- **Learning Analytics**: Track competencies and progress with **Atlas**
- **AI Assessment**: Automated assessment support with **Athena**

### Used By Leading Universities

- Technical University of Munich (TUM)
- University of Stuttgart
- Karlsruhe Institute of Technology (KIT)
- TU Wien, JKU Linz, LFU Innsbruck
- And many more...

Learn more at [https://artemisapp.github.io](https://artemisapp.github.io)

## EduTelligence Integration

This extension integrates **Iris**, an AI-powered virtual tutor from the EduTelligence suite, providing intelligent assistance for students through context-aware guidance and personalized learning support.

## Privacy & Data

- Your credentials are stored securely in VS Code's secret storage
- Communication with Artemis servers uses HTTPS encryption
- Iris interactions may be logged for quality improvement (per your institution's policies)

## Support

### Resources

- **Artemis Documentation**: [https://docs.artemis.cit.tum.de](https://docs.artemis.cit.tum.de)
- **Artemis Platform**: [https://artemisapp.github.io](https://artemisapp.github.io)
- **GitHub Repository**: [https://github.com/ls1intum/artemis-extension](https://github.com/ls1intum/artemis-extension)

### Getting Help

- Open an issue on [GitHub](https://github.com/ls1intum/artemis-extension/issues)
- Check the [Artemis documentation](https://docs.artemis.cit.tum.de)
- Contact your institution's Artemis support team

## Development Notes

### Theme system

- All palette, typography, spacing, radius, and shadow primitives live in [`src/theme/index.ts`](src/theme/index.ts).
- The module exposes a `ThemeManager`, CSS bootstrap script, and semantic tokens (e.g., `theme.background.surface`, `theme.text.muted`).
- Themes derive from the same primitive tokens and emit CSS variables prefixed with `--iris-*` (e.g., `--iris-bg-surface`, `--iris-text-muted`).
- Webviews should call `ThemeManager.getThemeBootstrapScript` and inject the returned script in the `<head>` so VS Code theme changes propagate via the shared store.

### UI primitives

- Shared UI helpers live in [`src/components`](src/components) (`Button`, `IconButton`, `TextField`, `SearchField`) and [`src/components/layout`](src/components/layout) (`Panel`, `Toolbar`, `Header`).
- Components render semantic HTML, expose `variant`/`size` props, and rely on CSS variables instead of inline styles.
- The corresponding styles are defined in [`media/styles/components/primitives.css`](media/styles/components/primitives.css) and consume the new `--iris-*` variables, ensuring consistent theming.
- Feature views (e.g., chat, dashboard) should compose these primitives instead of hand-rolled markup for consistent spacing, borders, and focus rings.

## Contributing

We welcome contributions! See the [GitHub repository](https://github.com/ls1intum/artemis-extension) for development setup and contribution guidelines.

## License

MIT License - See LICENSE file for details

---

**Enjoy enhanced learning with Artemis in VS Code! 🚀**
