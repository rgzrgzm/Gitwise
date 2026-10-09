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
- Browse actual local and remote branches, create/switch/delete local branches, preview incoming commits, files, and predicted conflicts before a local merge, and compare two local branches.
- Review real staged, unstaged, and untracked files; stage or unstage whole files or individual text-diff hunks, discard with confirmation, create stashes, apply or restore a selected stash, and commit staged work.
- Search local commit messages, load history in pages, and inspect commit metadata, changed files, and file diffs.

GitHub account linking is available from the Pull requests and Activity workspaces. Gitwise validates a fine-grained personal access token, stores it using Electron's platform credential protection, and detects a matching github.com remote. The Pull requests workspace loads real open pull requests; selecting one loads its description, commits, changed files, reviews, conversation comments, inline review comments, and check runs. Long sections are paginated on demand and items link back to GitHub. Activity shows available pushed commits and pull-request events with contributor, branch, and date filters. Mergeability/ruleset evaluation and pull-request creation are not loaded yet; those workflows state that limitation instead of showing fabricated data.

## Security model

Electron uses `contextIsolation: true` and has Node integration disabled in the renderer. The preload bridge exposes only specific, validated repository queries and named Git operations. Git is run in Electron’s main process using argument arrays; no renderer-provided shell command is executed.

Git transport credentials remain managed by your existing Git credential helper or SSH agent. Gitwise stores a GitHub API token only after it is validated, using Electron's encrypted platform credential storage; it does not expose that token to renderer storage or operation logs.

## Connect GitHub

Create a fine-grained personal access token in GitHub **Settings → Developer settings → Personal access tokens**, then open **Pull requests** or **Activity** in Gitwise and connect it there. The token is verified against your GitHub account before Gitwise saves it. For private repositories, select the repository and grant **Metadata: Read** for activity, **Pull requests: Read** for PR details, and **Checks: Read** for check runs. Limit the token to the repositories and read permissions you intend to use. GitHub's repository event feed is delayed and has limited recent history; Gitwise shows that freshness limitation in Activity.
