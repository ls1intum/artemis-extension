# Contributing to Artemis VS Code Extension

Thank you for your interest in contributing! This guide will help you get started.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/ls1intum/artemis-extension.git
cd artemis-extension

# Install dependencies
cd extension
npm install
cd ..

# Open in VS Code and press F5
# OR run full build first
./build-extension.sh
```

**Then in VS Code:**
1. Press `F5` to start debugging
2. Choose "Run Extension" (with watch mode)
3. Test your changes in the Extension Development Host window

## Development Workflow

### 1. Make Changes
- Edit TypeScript files in `src/`
- Modify styles in `media/styles/`
- Update views in `src/views/templates/`

### 2. Test Changes
- Press `F5` in VS Code to launch Extension Development Host
- Test your changes in the new window
- Check Debug Console for errors

### 3. Verify Quality
```bash
# Type checking
npm run check-types

# Linting
npm run lint

# Build production bundle
npm run package
```

### 4. Submit Changes
```bash
git checkout -b feature/your-feature-name
git add .
git commit -m "Add: your feature description"
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Code Guidelines

### TypeScript
- Use TypeScript strict mode features
- Define proper types (avoid `any`)
- Use meaningful variable names
- Add JSDoc comments for public APIs

### Styling
- Follow existing CSS structure
- Use VS Code theme tokens exposed via CSS variables
- Keep styles scoped to components
- Test in both light and dark VS Code themes

### Commits
- Use conventional commit format
- Examples:
  - `feat: add WebSocket reconnection logic`
  - `fix: resolve authentication token refresh issue`
  - `docs: update installation instructions`
  - `refactor: simplify view routing logic`

## Project Structure Guide

```
src/
├── extension.ts           # Start here - extension activation
├── api/                   # Add new API endpoints here
├── auth/                  # Authentication logic
├── services/              # Background services
├── views/
│   ├── provider/         # Webview container classes
│   ├── templates/        # HTML generators
│   ├── app/              # State management & routing
│   └── commands/         # Command handlers
├── types/                # TypeScript definitions
└── utils/                # Helper functions
```

## Common Tasks

### Adding a New View
1. Create template in `src/views/templates/yourView.ts`
2. Add route in `src/views/app/viewRouter.ts`
3. Add command handler in `src/views/app/commands/`
4. Create styles in `media/styles/views/your-view.css`

### Adding a New Command
1. Define in `package.json` under `contributes.commands`
2. Register in `extension.ts`
3. Implement handler in `src/views/app/commands/`

### Adding API Endpoint
1. Add method to `src/api/artemisApi.ts`
2. Define types in `src/types/artemis.ts`
3. Use in your view or command handler

## Testing

### Manual Testing
1. Press `F5` to launch Extension Development Host
2. Test all views and commands
3. Check Developer Tools console
4. Verify WebSocket connection

### Automated Tests
```bash
npm run test
```

## Documentation

### When to Update Docs

**Update `/README.md` (developer docs) if you**:
- Change build process
- Add new scripts
- Modify project structure
- Change development workflow

**Update `/extension/README.md` (user docs) if you**:
- Add new features
- Add new commands
- Add new settings
- Change user-facing behavior

See [DOCUMENTATION.md](DOCUMENTATION.md) for more details.

## Getting Help

- 📖 Check [documentation](https://docs.artemis.cit.tum.de)
- 🐛 Open an [issue](https://github.com/ls1intum/artemis-extension/issues)
- 💬 Ask in project discussions

## Code of Conduct

- Use your real name and authentic profile
- Be respectful and inclusive
- Follow [GitHub's Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- Adhere to [Open Source Guides](https://opensource.guide/)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Happy coding! 🚀**
