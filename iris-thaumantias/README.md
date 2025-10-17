# Artemis VS Code Extension

Seamlessly integrate **Artemis: Interactive Learning with Individual Feedback** directly into your VS Code environment. This extension brings the power of Artemis—an innovative platform for interactive learning, programming exercises, and AI-powered tutoring—right to your IDE, enabling students to access personalized support, exercise materials, and intelligent feedback without leaving their development workspace.

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

## Contributing

We welcome contributions from the community! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes following our coding guidelines
4. Submit a pull request

Please use your real name and an authentic profile picture when contributing. We adhere to [GitHub's Open Source Guides](https://opensource.guide/) and [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies).

## Known Issues

- Some Iris AI tutoring features are still under development
- Certain features may require specific Artemis server configurations
- Exercise submission and grading features are in progress

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
