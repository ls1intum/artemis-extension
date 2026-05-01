# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Live mode (researcher remote observation)

The viewer can stream a currently-recording session over the LAN to a second
laptop running only a browser, intended for user-study observation.

### Start (recording laptop)

```bash
export IRIS_LIVE_TOKEN=$(openssl rand -hex 24)
echo "Token: $IRIS_LIVE_TOKEN"
cd artemis-extension/recording-viewer
npm run dev:live
```

### Connect (observer laptop)

Open `http://<recording-laptop-IP>:5173` in any browser. Enter the token.
Active sessions show a red **LIVE** badge.

### Hotkeys (when viewing a live session)

- `1`-`5`: Struggle level (confident, light, medium, high, blocked)
- `q`-`t`: Context marker (idle, trial-error, reading, off-task, using-ai)
- The reaction-delay slider (0-1000ms) tunes the offset added to the last
  observed event timestamp before the annotation is stamped (default 300ms).

### Security

- `IRIS_LIVE_TOKEN` must be set when binding to a non-local interface.
  Without it the server only listens on `127.0.0.1`.
- Mutating endpoints (delete/rename/upload) are blocked in live mode. Set
  `IRIS_LIVE_ALLOW_WRITE=1` to opt in.
- Pin to a specific LAN interface: `IRIS_LIVE_BIND=192.168.1.42 npm run dev:live`.
- Cookies are HttpOnly + SameSite=Strict, valid for 7 days.
