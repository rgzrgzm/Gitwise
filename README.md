# Gitwise

Gitwise is an Electron desktop workspace for understanding and acting on local Git repositories without exposing arbitrary shell execution to the renderer.

## Run

```powershell
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together. Development Electron loads the Vite server; packaged Electron loads the production build.

```powershell
npm run build
```

## Current local Git capabilities

- Open and persist validated local Git repositories.
- Inspect the current branch, upstream relationship, remotes, author identity, working-tree state, and freshness.
- Fetch, fast-forward pull, push, and publish a local branch.
- Browse actual local and remote branches, create/switch/delete local branches, merge a selected branch, and compare two local branches.
- Review real staged, unstaged, and untracked files; stage, unstage, discard with confirmation, create stashes, apply or restore a selected stash, and commit staged work.
- Search local commit messages, load history in pages, and inspect commit metadata, changed files, and file diffs.

GitHub authentication, pull requests, reviews, checks, and shared team activity are intentionally not connected yet. Those screens explicitly explain the unavailable integration instead of showing fabricated collaboration data.

## Security model

Electron uses `contextIsolation: true` and has Node integration disabled in the renderer. The preload bridge exposes only specific, validated repository queries and named Git operations. Git is run in Electron’s main process using argument arrays; no renderer-provided shell command is executed.

Git transport credentials remain managed by your existing Git credential helper or SSH agent. Gitwise does not store GitHub or transport credentials.
