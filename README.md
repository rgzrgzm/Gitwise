# Branchline

Branchline is a desktop Git workspace built with Electron, React, and TypeScript. It is designed around one question: “what is happening in this repository, and what should I do next?”

## Run locally

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

The project uses Electron with `contextIsolation: true` and `nodeIntegration: false`. Renderer code can only call the small preload bridge for repository selection, repository inspection, and validated Git argument arrays.

## Current functionality

- Open an existing local repository folder through the native folder picker.
- Inspect the current branch, working-tree status, remotes, ahead/behind counts, and recent commits through Electron’s main process.
- Browse repository Home, Changes, Branches, Pull requests, and Activity workspaces.
- Review staged/unstaged/untracked concepts, readable diffs, branch comparisons, pull request states, and contributor activity.
- Use light/dark themes, keyboard-visible focus, responsive overflow handling, and explicit Git-language labels.

The home screen currently uses realistic, clearly labeled demo collaboration data until GitHub authentication and API integration are connected. Fetch, pull, push, stash, commit, and pull-request actions are presented as demo-mode feedback in this checkpoint; they do not mutate the active repository yet.

## Authentication setup

GitHub authentication is intentionally not stored in renderer state or local storage. The next integration should use an Electron-safe OAuth/device flow and OS credential storage (for example, Keychain on macOS, Credential Manager on Windows, and Secret Service/libsecret on Linux). Git transport authentication remains separate from GitHub API authentication and should be configured through Git’s existing credential helpers or SSH agent.

## Design direction

The interface follows `PRODUCT_DESIGN_SYSTEM.md`: neutral layered surfaces, indigo as a restrained product accent, compact sidebar navigation, explicit status language, selected cards only where useful, visible focus states, and light/dark semantic tokens. The primary visual checkpoint is the repository Home view.

## Known limitations

- GitHub API authentication, pull-request mutations, reviews, checks, and remote activity are not connected yet.
- Git mutations are not enabled in this checkpoint; local inspection is wired and safe.
- Visual screenshot capture could not be performed in the current automation session; the renderer and Electron TypeScript build were both validated successfully.
