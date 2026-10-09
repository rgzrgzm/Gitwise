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

Run merge-readiness regression tests with `npm run test:readiness`. These exercise blocker interpretation and mocked GitHub error/partial-response handling without changing repositories or contacting GitHub.

## Current local Git capabilities

- Open and persist validated local Git repositories.
- Inspect the current branch, upstream relationship, remotes, author identity, working-tree state, and freshness.
- Fetch, fast-forward pull, push, and publish a local branch.
- Browse actual local and remote branches, create/switch/delete local branches, preview incoming commits, files, and predicted conflicts before a local merge, and compare two local branches.
- Review real staged, unstaged, and untracked files; stage or unstage whole files or individual text-diff hunks, discard with confirmation, create stashes, apply or restore a selected stash, and commit staged work.
- Search local commit messages, load history in pages, and inspect commit metadata, changed files, and file diffs.

GitHub account linking is available from the Pull requests and Activity workspaces. Gitwise validates a fine-grained personal access token, stores it using Electron's platform credential protection, and detects a matching github.com remote. The Pull requests workspace loads real pull requests and supports open, closed, or all states, draft filtering, text search across loaded titles/authors/numbers/branches, and GitHub pagination; selecting one loads its description, commits, changed files, reviews, conversation comments (including posting new discussion comments), inline review comments, and check runs. Long sections are paginated on demand and items link back to GitHub. Changed-file diffs let reviewers post inline comments on added or deleted lines; Gitwise resolves the latest commit and lets GitHub validate the selected diff location. Open pull requests can request reviews from GitHub usernames and team slugs; the displayed reviewer list is confirmed from GitHub after submission. Reviewers can submit a comment, approval, or change request. Gitwise can merge eligible pull requests using only merge methods enabled in repository settings, after a fresh state/readiness check; GitHub rules remain authoritative, and queue acceptance is distinguished from a completed merge. Activity shows available pushed commits and pull-request events with contributor, branch, and date filters. PR details also show GitHub-reported merge readiness, combined check/status results, review decisions, and available classic branch-protection requirements. Missing or inaccessible requirements are not treated as approval. Additional rulesets, queues, deployments, and permissions may apply; Gitwise creates ready or draft pull requests from branches published to the same repository, after confirming both remote branches exist. Cross-repository forks are not supported yet.

## Security model

Electron uses `contextIsolation: true` and has Node integration disabled in the renderer. The preload bridge exposes only specific, validated repository queries and named Git operations. Git is run in Electron’s main process using argument arrays; no renderer-provided shell command is executed.

Git transport credentials remain managed by your existing Git credential helper or SSH agent. Gitwise stores a GitHub API token only after it is validated, using Electron's encrypted platform credential storage; it does not expose that token to renderer storage or operation logs.

## Connect GitHub

Create a fine-grained personal access token in GitHub **Settings → Developer settings → Personal access tokens**, then open **Pull requests** or **Activity** in Gitwise and connect it there. The token is verified against your GitHub account before Gitwise saves it. For private repositories, select the repository and grant **Metadata: Read** for activity, **Pull requests: Read** for PR details, and **Checks: Read** for check runs. To create pull requests, also grant **Contents: Read** to load remote branches and **Pull requests: Write** to create the PR. To merge pull requests, grant **Contents: Write**; Gitwise uses the repository’s enabled merge methods and never requests permission to bypass rules. Organization approval may be required. Limit the token to the repositories and permissions you intend to use. GitHub's repository event feed is delayed and has limited recent history; Gitwise shows that freshness limitation in Activity.
