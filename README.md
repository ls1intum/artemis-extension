# Artemis VS Code Extension - Developer Documentation

> [View Changelog](CHANGELOG.md)

> **Documentation Guide**:
> - **This README**: Development setup and contributor guide
> - **[Extension README](iris-thaumantias/README.md)**: User-facing documentation (VS Code Marketplace)


This repository contains the VS Code extension for **Artemis: Interactive Learning with Individual Feedback**. The extension integrates Artemis—an innovative platform for interactive learning, programming exercises, and AI-powered tutoring—directly into the VS Code IDE, enabling students to access personalized support, exercise materials, and intelligent feedback without leaving their development workspace.

## About Artemis

Artemis brings interactive learning to life with instant, individual feedback on programming exercises, quizzes, modeling tasks, and more. Offering customization for instructors and real-time collaboration for students, this platform bridges creativity and education. Embrace a new era of engaging, adaptive learning and artificial intelligence support with Artemis, where innovation meets inclusivity. Find out more on [https://artemisapp.github.io](https://artemisapp.github.io)

### Main Goals

- **User experience**: Provide an intuitive and engaging interface that enhances the learning experience for both students and instructors
- **Scalable infrastructure**: Build a robust platform capable of supporting large-scale courses with thousands of participants simultaneously
- **Constructive alignment**: Align learning goals, activities, and assessments through well-integrated features such as the exam mode
- **Learning analytics**: Leverage data to provide actionable insights into student performance and engagement

### Key Features

- **Programming Exercises**: Version control integration, automatic individual feedback based on test cases and static code analysis, support for any programming language
- **AI-Powered Support**: Integration with **Iris**, a LLM-based virtual assistant that supports students with questions, pro-active assistance, and personalized guidance
- **Instant Feedback**: Students receive immediate and individual feedback on submissions with customizable feedback messages
- **Interactive Instructions**: Task-based and UML diagram integration directly into dynamic problem statements
- **Multiple Exercise Types**: Programming, quiz, modeling, text, and file upload exercises
- **Exam Mode**: Create online exams with exercise variants, integrated plagiarism checks, and student reviews
- **Learning Analytics**: Track competencies, monitor progress, and receive personalized learning paths with **Atlas**
- **AI Assessment**: Automated assessment support with **Athena** for text, modeling, and programming exercises

## Extension Features

### Artemis Integration

- **Activity Bar Icon**: Click the Artemis logo in the activity bar to open the Artemis sidebar
- **Secure Login**: Authenticate directly with your Artemis Learning Management System from VS Code
- **Course Access**: Browse your courses, view exercise details, and access learning materials
- **Dashboard View**: Overview of your current exercises, deadlines, and course activities
- **Responsive Design**: Adapts seamlessly to VS Code themes (light/dark mode)
- **Multiple Themes**: Choose from VSCode-native, modern, or synthwave visual themes

### Iris AI Tutoring

The extension integrates **Iris**, Artemis's intelligent virtual tutor, directly into your coding environment:

- **Context-Aware Assistance**: Get help with programming exercises based on your current work
- **Exercise-Specific Guidance**: Receive personalized hints and explanations for your active exercises
- **Instant Q&A**: Ask questions about lectures, exercises, and your learning performance
- **Pro-Active Support**: Iris can proactively suggest next steps and motivate continued learning
- **Health Status Monitoring**: Check Iris availability and rate limits to ensure optimal assistance

### Service Monitoring

- **Real-Time Status**: Monitor the health and availability of Artemis services
- **Rate Limit Information**: View your current API usage and remaining quotas
- **Service Diagnostics**: Check connectivity and troubleshoot integration issues

## Getting Started

### Requirements

- **VS Code** version 1.104.0 or higher
- Access to an **Artemis Learning Management System** server
- Valid Artemis user credentials (student or instructor account)

### Installation

1. Install the extension from the VS Code Marketplace
2. Click the Artemis logo in the activity bar
3. Configure your Artemis server URL in settings if different from the default

### How to Use

1. **Login**: Click the Artemis logo in the activity bar and enter your credentials
2. **Browse Courses**: Navigate your enrolled courses from the dashboard
3. **View Exercises**: Select exercises to view details, deadlines, and instructions
4. **Access Iris**: Click the chat icon to open the Iris AI tutor for assistance
5. **Monitor Services**: Use "Artemis: Check Iris Health Status" command to verify service availability

To access commands, open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type "Artemis".

## Available Commands

- `Artemis: Login to Artemis` - Opens the Artemis login interface
- `Artemis: Check Iris Health Status` - Checks if the Iris AI tutoring system is active and shows rate limit information

## Extension Settings

Configure the extension through VS Code settings:

- `artemis.serverUrl`: The URL of the Artemis server to connect to (default: `https://artemis.tum.de`)
- `artemis.theme`: Choose the visual theme for Artemis views (`vscode`, `modern`, or `synthwave`)

## EduTelligence Integration

This extension integrates **Iris**, an AI-powered virtual tutor from the EduTelligence suite. Iris provides intelligent student assistance, answering questions about exercises, lectures, and learning performance directly within your VS Code environment.

## Artemis Platform Features

The Artemis platform, which this extension connects to, offers extensive capabilities:

### Exercise Types

- **Programming Exercises**: Java, Python, C, Haskell, Kotlin, VHDL, Assembler, Swift, OCaml, and more
- **Quiz Exercises**: Multiple choice, drag and drop, short answer, and modeling quizzes
- **Modeling Exercises**: UML diagrams with the Apollon editor and semi-automatic assessment
- **Text Exercises**: Manual and semi-automatic assessment with NLP support
- **File Upload Exercises**: Flexible submission format for any file type

### Assessment & Grading

- Double-blind grading with structured grading criteria
- Assessment training process with example submissions
- Student rating of assessments and complaint mechanism
- Automated grading and grade key configuration
- Bonus configurations for final exams

### Communication & Collaboration

- Course announcements and notifications
- Question channels and private chats
- Customizable web and email notifications
- Mobile app support for iOS and Android

### Learning & Analytics

- **Atlas**: Competency-based management system with adaptive learning
- Progress tracking toward learning objectives
- Performance comparison with course averages
- Personalized learning paths based on individual progress

### Additional Features

- **Lectures**: Upload slides, video integration, and competency definitions
- **Exam Mode**: Online exams with variants, plagiarism checks, and test runs
- **Tutorial Groups**: Session planning, tutor assignment, and attendance tracking
- **Plagiarism Detection**: Integrated checks for programming, text, and modeling exercises
- **LTI Integration**: Connect with Moodle, edX, and other learning management systems

## Architecture

The extension connects to the Artemis application server via REST APIs, providing seamless integration between your local development environment and the Artemis platform. The server architecture includes:

- **Application Server**: Spring Boot-based backend with REST interfaces
- **Version Control System**: Git repository management for programming exercises
- **Continuous Integration**: Automated testing and feedback generation
- **Build Agents**: Docker-based execution environments for secure code testing

## Universities Using Artemis

Artemis is actively used by numerous universities worldwide, including:

- Technical University of Munich (TUM)
- LFU Innsbruck, Uni Salzburg, JKU Linz, AAU Klagenfurt, TU Wien
- University of Stuttgart
- Universität Passau
- Karlsruhe Institute of Technology (KIT)
- Hochschule München
- Technische Universität Dresden
- Hochschule Heilbronn

For a complete list and more information, visit [https://artemisapp.github.io](https://artemisapp.github.io)

## Development Setup

### Prerequisites

- Node.js (v22.x or higher)
- npm
- VS Code (version 1.97.0 or higher)
- (Optional) vsce: `npm install -g @vscode/vsce`

### Building the Extension

#### Using Build Script

**Full Build with Validation:**
```bash
./build-extension.sh
```
This script will:
- Clean previous builds
- Install dependencies
- Run type checking
- Run linting
- Build the production bundle
- Package as .vsix (if vsce is installed)

#### Manual Build

1. Clone the repository:
   ```bash
   git clone https://github.com/ls1intum/artemis-extension.git
   cd artemis-extension/iris-thaumantias
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Watch for changes during development:
   ```bash
   npm run watch
   ```

5. Package the extension:
   ```bash
   npm run package
   ```

#### Packaging for Distribution

To create a `.vsix` file for distribution:
```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package the extension
cd iris-thaumantias
vsce package
```

### Project Structure

```
artemis-extension/
├── README.md                  # This file (developer documentation)
├── DOCUMENTATION.md           # Documentation strategy guide
└── iris-thaumantias/          # Extension package directory
    ├── README.md              # User documentation (Marketplace)
    ├── package.json           # Extension manifest
    ├── tsconfig.json          # TypeScript configuration
    ├── esbuild.js             # Build configuration
    ├── eslint.config.mjs      # Linting configuration
    ├── src/
    │   ├── extension.ts       # Extension entry point & activation
    │   ├── api/               # Artemis REST API client
    │   │   └── artemisApi.ts  # API methods for courses, exercises, etc.
    │   ├── auth/              # Authentication handling
    │   │   └── auth.ts        # Login, token management, secret storage
    │   ├── services/          # Core services
    │   │   └── artemisWebsocketService.ts  # WebSocket for real-time updates
    │   ├── views/             # Webview UI layer
    │   │   ├── provider/      # Webview provider classes
    │   │   │   ├── artemisWebviewProvider.ts  # Main Artemis view
    │   │   │   └── chatWebviewProvider.ts     # Iris chat view
    │   │   ├── templates/     # HTML template generators
    │   │   │   ├── loginView.ts
    │   │   │   ├── dashboardView.ts
    │   │   │   ├── courseListView.ts
    │   │   │   ├── exerciseDetailView.ts
    │   │   │   └── irisChatView.ts
    │   │   └── app/           # Application state & routing
    │   │       ├── appStateManager.ts     # Global state management
    │   │       ├── viewRouter.ts          # View navigation
    │   │       ├── webViewMessageHandler.ts  # Message passing
    │   │       └── commands/              # Command handlers
    │   ├── themes/            # UI theme definitions
    │   │   └── themes/        # Theme configurations (vscode, modern, synthwave)
    │   ├── types/             # TypeScript type definitions
    │   │   ├── artemis.ts     # Artemis domain types
    │   │   └── stomp.d.ts     # WebSocket/STOMP types
    │   └── utils/             # Utility functions
    │       ├── constants.ts
    │       ├── plantUmlProcessor.ts
    │       └── recommendedExtensions.ts
    ├── media/
    │   ├── artemis-logo.png   # Extension icons
    │   └── styles/            # CSS stylesheets
    │       ├── base.css
    │       ├── themes/        # Theme-specific styles
    │       └── views/         # View-specific styles
    └── dist/                  # Compiled output (generated)
        └── extension.js       # Bundled extension
```

### Key Architecture Components

#### Extension Entry Point
- **`extension.ts`**: Activates the extension, registers commands, and initializes webview providers

#### API Layer
- **`artemisApi.ts`**: Handles all REST API communication with Artemis server
- Supports authentication, course retrieval, exercise management, and Iris interactions

#### Authentication
- **`auth.ts`**: Manages user login, JWT tokens, and secure credential storage
- Uses VS Code's Secret Storage API for security

#### Services
- **`artemisWebsocketService.ts`**: Maintains WebSocket connection for real-time notifications
- Uses STOMP protocol over WebSocket for message handling

#### Views
- **Providers**: Create and manage webview panels
- **Templates**: Generate HTML for different views
- **App State**: Manages application state and view routing
- **Commands**: Handle user actions from webviews

#### Themes
- Three built-in themes: VSCode (native), Modern (cards), Synthwave (neon)
- Theme system allows for easy addition of new visual styles

### Available Scripts

- `npm run compile` - Compile TypeScript and run linting
- `npm run watch` - Watch mode for development
- `npm run package` - Build production bundle
- `npm run lint` - Run ESLint
- `npm run check-types` - Type check without emitting
- `npm run test` - Run tests

### Running the Extension Locally

#### Quick Start
1. Open the project in VS Code
2. Press `F5` (or click Run → Start Debugging)
3. Select "Run Extension" from the dropdown (if prompted)
4. A new Extension Development Host window will open with your extension loaded
5. Click the Artemis icon in the activity bar to test functionality

#### Available Launch Configurations

The project includes three launch configurations (press `F5` and select):

1. **Run Extension** (Recommended for development)
   - Automatically starts watch mode
   - Recompiles on file changes
   - Best for active development

2. **Run Extension (No Watch)**
   - Runs the extension without watch mode
   - Use when you just want to test without auto-recompilation

3. **Extension Tests**
   - Runs the extension test suite
   - Automatically compiles tests before running

#### Development Workflow

**Option 1: Automatic (Recommended)**
```bash
# Just press F5 in VS Code
# Watch mode starts automatically
# Make changes → See them reflected automatically
```

**Option 2: Manual Watch Mode**
```bash
cd iris-thaumantias
npm run watch
# Then press F5 in VS Code
```

### Debugging

- **Set breakpoints**: Click in the gutter next to line numbers in TypeScript files
- **Debug Console**: View and execute code in the debug context
- **Variables panel**: Inspect variables and their values
- **Call Stack**: See the execution path
- **Output panel**: Check "Artemis" or "Extension Host" for logs
- **Problems panel**: View TypeScript and ESLint errors

#### Debug Tips
- Use `console.log()` for quick debugging (appears in Debug Console)
- Set conditional breakpoints for specific scenarios
- Use "Restart" (Ctrl+Shift+F5) to reload the extension with changes
- Check the "Extension Host" output panel for extension errors

## Contributing

We welcome contributions from the community! 

**📖 See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.**

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes following our coding guidelines
4. Ensure all tests pass and code is properly linted
5. Submit a pull request with a clear description

### Code Guidelines

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Maintain existing code style (enforced by ESLint)
- Update documentation when adding new features
- Use conventional commit messages

Please use your real name and an authentic profile picture when contributing. We adhere to [GitHub's Open Source Guides](https://opensource.guide/) and [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies).

## Resources

- **Artemis Platform**: [https://artemisapp.github.io](https://artemisapp.github.io)
- **Documentation**: [https://docs.artemis.cit.tum.de](https://docs.artemis.cit.tum.de)
- **GitHub Repository**: [https://github.com/ls1intum/Artemis](https://github.com/ls1intum/Artemis)
- **Extension Guidelines**: [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Support

For questions, issues, or feature requests:
- Open an issue on the GitHub repository
- Contact the Artemis development team via the communication channels listed on the main repository

---

**Enjoy enhanced learning with Artemis in VS Code!**
