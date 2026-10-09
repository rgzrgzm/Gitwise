import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import https from 'node:https';

const execFileAsync = promisify(execFile);

type GitOperation =
  | { type: 'fetch'; remote?: string }
  | { type: 'pull'; strategy?: 'ff-only' | 'merge' | 'rebase' }
  | { type: 'push'; setUpstream?: boolean }
  | { type: 'stage'; paths: string[] }
  | { type: 'unstage'; paths: string[] }
  | { type: 'discard'; paths: string[] }
  | { type: 'trash-untracked'; paths: string[] }
  | { type: 'commit'; message: string }
  | { type: 'stash'; message?: string }
  | { type: 'stash-pop' }
  | { type: 'stash-apply'; stashId: string }
  | { type: 'stash-pop-selected'; stashId: string }
  | { type: 'apply-hunk'; path: string; staged: boolean; hunkIndex: number }
  | { type: 'create-branch'; name: string; startPoint?: string }
  | { type: 'switch-branch'; name: string }
  | { type: 'rename-branch'; oldName: string; newName: string }
  | { type: 'delete-local-branch'; name: string; force?: boolean }
  | { type: 'delete-remote-branch'; remote: string; name: string }
  | { type: 'merge'; source: string }
  | { type: 'merge-continue' }
  | { type: 'merge-abort' }
  | { type: 'continue-operation' }
  | { type: 'abort-operation' };

const activeOperations = new Set<string>();
const operationLog: Array<{ id: string; repositoryPath: string; label: string; ok: boolean; at: string; detail: string }> = [];

async function resolveRepository(candidate: unknown) {
  if (typeof candidate !== 'string' || !candidate.trim()) return { ok: false as const, error: 'Choose a repository before continuing.' };
  try {
    if (!(await fs.stat(candidate)).isDirectory()) return { ok: false as const, error: 'The selected path is not a folder.' };
  } catch { return { ok: false as const, error: 'This repository folder is missing or unavailable.' }; }
  const root = await git(['rev-parse', '--show-toplevel'], candidate);
  if (!root.ok) return { ok: false as const, error: 'This folder is not a Git repository.' };
  return { ok: true as const, path: path.resolve(root.stdout.trim()) };
}

function validRef(value: unknown) { return typeof value === 'string' && value.length > 0 && value.length < 250 && !value.startsWith('-') && !/[\0~^:?*\\\[\s]/.test(value) && !value.includes('..') && !value.endsWith('.') && !value.endsWith('/'); }
function validPaths(paths: unknown): paths is string[] { return Array.isArray(paths) && paths.length > 0 && paths.every((item) => typeof item === 'string' && item.length > 0 && !path.isAbsolute(item) && !item.includes('\0') && !item.split(/[\\/]/).includes('..')); }
function cleanGitError(value: string) { return value.replace(/(https?:\/\/)[^\s/@]+@/gi, '$1***@').replace(/(gh[pousr]_[A-Za-z0-9_]+)/g, '***').trim(); }
function recordOperation(repositoryPath: string, label: string, ok: boolean, detail: string) { operationLog.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, repositoryPath, label, ok, at: new Date().toISOString(), detail: cleanGitError(detail) }); operationLog.splice(30); }
function validateOperation(value: unknown): GitOperation | null {
  if (!value || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string') return null;
  const operation = value as Record<string, unknown>;
  switch (operation.type) {
    case 'fetch': return { type: 'fetch' };
    case 'pull': return ['ff-only', 'merge', 'rebase'].includes(String(operation.strategy || 'ff-only')) ? { type: 'pull', strategy: (operation.strategy || 'ff-only') as 'ff-only' | 'merge' | 'rebase' } : null;
    case 'push': return typeof operation.setUpstream === 'boolean' || operation.setUpstream === undefined ? { type: 'push', setUpstream: Boolean(operation.setUpstream) } : null;
    case 'stage': case 'unstage': case 'discard': case 'trash-untracked': return validPaths(operation.paths) ? { type: operation.type, paths: operation.paths } as GitOperation : null;
    case 'commit': return typeof operation.message === 'string' ? { type: 'commit', message: operation.message } : null;
    case 'stash': return operation.message === undefined || typeof operation.message === 'string' ? { type: 'stash', message: operation.message as string | undefined } : null;
    case 'stash-pop': return { type: 'stash-pop' };
    case 'stash-apply': case 'stash-pop-selected': return typeof operation.stashId === 'string' && /^[0-9a-f]{40,64}$/i.test(operation.stashId) ? { type: operation.type, stashId: operation.stashId } as GitOperation : null;
    case 'apply-hunk': {
      const hunkIndex = operation.hunkIndex;
      return typeof operation.path === 'string' && validPaths([operation.path]) && typeof operation.staged === 'boolean' && typeof hunkIndex === 'number' && Number.isInteger(hunkIndex) && hunkIndex >= 0 && hunkIndex < 10000 ? { type: 'apply-hunk', path: operation.path, staged: operation.staged, hunkIndex } : null;
    }
    case 'create-branch': return typeof operation.name === 'string' && (operation.startPoint === undefined || typeof operation.startPoint === 'string') ? { type: 'create-branch', name: operation.name, startPoint: operation.startPoint as string | undefined } : null;
    case 'switch-branch': return typeof operation.name === 'string' ? { type: 'switch-branch', name: operation.name } : null;
    case 'rename-branch': return typeof operation.oldName === 'string' && typeof operation.newName === 'string' ? { type: 'rename-branch', oldName: operation.oldName, newName: operation.newName } : null;
    case 'delete-local-branch': return typeof operation.name === 'string' && (operation.force === undefined || typeof operation.force === 'boolean') ? { type: 'delete-local-branch', name: operation.name, force: Boolean(operation.force) } : null;
    case 'delete-remote-branch': return typeof operation.remote === 'string' && typeof operation.name === 'string' ? { type: 'delete-remote-branch', remote: operation.remote, name: operation.name } : null;
    case 'merge': return typeof operation.source === 'string' ? { type: 'merge', source: operation.source } : null;
    case 'merge-continue': return { type: 'merge-continue' };
    case 'merge-abort': return { type: 'merge-abort' };
    case 'continue-operation': return { type: 'continue-operation' };
    case 'abort-operation': return { type: 'abort-operation' };
    default: return null;
  }
}

async function git(args: string[], cwd: string) {
  try {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 4 });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout?.trim() ?? '', stderr: e.stderr?.trim() || e.message || 'Git operation failed' };
  }
}

async function gitWithInput(args: string[], cwd: string, input: string) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    const process = spawn('git', args, { cwd, windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (result: { ok: boolean; stdout: string; stderr: string }) => { if (!settled) { settled = true; resolve(result); } };
    process.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    process.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    process.on('error', (error) => finish({ ok: false, stdout: '', stderr: error.message || 'Git operation failed' }));
    process.on('close', (code) => finish({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    process.stdin.end(input, 'utf8');
  });
}

function githubTokenFile() { return path.join(app.getPath('userData'), 'github-token.bin'); }
function githubProfileFile() { return path.join(app.getPath('userData'), 'github-profile.json'); }

async function readGitHubToken() {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false as const, error: 'Secure credential storage is unavailable on this device.' };
  try { return { ok: true as const, token: safeStorage.decryptString(await fs.readFile(githubTokenFile())) }; }
  catch { return { ok: true as const, token: null as string | null }; }
}

async function readGitHubProfile() {
  try {
    const profile = JSON.parse(await fs.readFile(githubProfileFile(), 'utf8')) as { login?: unknown; name?: unknown; avatarUrl?: unknown; htmlUrl?: unknown; connectedAt?: unknown };
    return typeof profile.login === 'string' ? { login: profile.login, name: typeof profile.name === 'string' ? profile.name : null, avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : null, htmlUrl: typeof profile.htmlUrl === 'string' ? profile.htmlUrl : null, connectedAt: typeof profile.connectedAt === 'string' ? profile.connectedAt : null } : null;
  } catch { return null; }
}

function githubRequest(pathname: string, token: string) {
  return new Promise<{ ok: boolean; status: number; body: unknown; hasNextPage: boolean }>((resolve) => {
    const request = https.request({ hostname: 'api.github.com', path: pathname, method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'Gitwise', 'X-GitHub-Api-Version': '2026-03-10' } }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => { let body: unknown = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; } resolve({ ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300), status: response.statusCode || 0, body, hasNextPage: /rel="next"/.test(String(response.headers.link || '')) }); });
    });
    request.on('error', () => resolve({ ok: false, status: 0, body: null, hasNextPage: false }));
    request.end();
  });
}

function parseGitHubRemote(value: string) {
  const match = value.trim().match(/^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? { host: 'github.com', owner: match[1], name: match[2], url: value.trim() } : null;
}

async function getGitHubRemote(repositoryPath: string) {
  const remotes = await git(['remote'], repositoryPath);
  if (!remotes.ok) return null;
  for (const remote of remotes.stdout.split(/\r?\n/).filter(Boolean)) {
    const url = await git(['remote', 'get-url', remote], repositoryPath);
    const parsed = url.ok ? parseGitHubRemote(url.stdout) : null;
    if (parsed) return { remote, ...parsed };
  }
  return null;
}

async function getGitHubStatus(candidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error, connected: false, account: null, remote: null };
  const [token, profile, remote] = await Promise.all([readGitHubToken(), readGitHubProfile(), getGitHubRemote(repository.path)]);
  return { ok: true, connected: token.ok && Boolean(token.token), secureStorageAvailable: safeStorage.isEncryptionAvailable(), account: profile, remote, error: token.ok ? null : token.error };
}

async function connectGitHub(candidate: unknown) {
  if (typeof candidate !== 'string' || candidate.length < 20 || candidate.length > 300 || /\s/.test(candidate)) return { ok: false, error: 'Paste a valid GitHub personal access token.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Secure credential storage is unavailable on this device.' };
  const response = await githubRequest('/user', candidate);
  const user = response.body as { login?: unknown; name?: unknown; avatar_url?: unknown; html_url?: unknown } | null;
  if (!response.ok || !user || typeof user.login !== 'string') {
    const error = response.status === 401 ? 'GitHub rejected that token. Check that it is valid and has not expired.' : response.status === 403 ? 'GitHub denied this request. Check token permissions or try again later.' : response.status === 0 ? 'GitHub could not be reached. Check your network connection and try again.' : 'GitHub could not verify that token.';
    return { ok: false, error };
  }
  await fs.mkdir(path.dirname(githubTokenFile()), { recursive: true });
  await fs.writeFile(githubTokenFile(), safeStorage.encryptString(candidate));
  const profile = { login: user.login, name: typeof user.name === 'string' ? user.name : null, avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null, htmlUrl: typeof user.html_url === 'string' ? user.html_url : null, connectedAt: new Date().toISOString() };
  await fs.writeFile(githubProfileFile(), JSON.stringify(profile), 'utf8');
  return { ok: true, account: profile };
}

async function disconnectGitHub() {
  await Promise.all([fs.rm(githubTokenFile(), { force: true }), fs.rm(githubProfileFile(), { force: true })]);
  return { ok: true };
}

function githubApiError(status: number, body: unknown) {
  const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : '';
  if (status === 401) return 'GitHub rejected the saved token. Disconnect and connect a valid token again.';
  if (status === 403 && /rate limit/i.test(message)) return 'GitHub API rate limit reached. Wait for GitHub to reset the limit, then refresh.';
  if (status === 429) return 'GitHub is temporarily limiting API requests. Wait a moment, then refresh.';
  if (status === 403) return 'GitHub denied access to this repository. Check the token permissions and repository access.';
  if (status === 404) return 'This GitHub repository is unavailable to the connected account. Check the remote and token access.';
  if (status === 0) return 'GitHub could not be reached. Check your network connection and try again.';
  return 'GitHub could not load pull requests for this repository.';
}

async function getGitHubPullRequests(candidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error, pullRequests: [] };
  const [token, remote] = await Promise.all([readGitHubToken(), getGitHubRemote(repository.path)]);
  if (!token.ok || !token.token) return { ok: false, error: token.error || 'Connect GitHub before loading pull requests.', pullRequests: [] };
  if (!remote) return { ok: false, error: 'No github.com remote is configured for this repository.', pullRequests: [] };
  const response = await githubRequest(`/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.name)}/pulls?state=open&sort=updated&direction=desc&per_page=50`, token.token);
  if (!response.ok || !Array.isArray(response.body)) return { ok: false, error: githubApiError(response.status, response.body), pullRequests: [] };
  const pullRequests = response.body.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const pull = item as Record<string, unknown>;
    const number = pull.number; const title = pull.title; const url = pull.html_url;
    const user = pull.user as Record<string, unknown> | null;
    const head = pull.head as Record<string, unknown> | null;
    const base = pull.base as Record<string, unknown> | null;
    if (typeof number !== 'number' || typeof title !== 'string' || typeof url !== 'string') return [];
    return [{ number, title, url, draft: Boolean(pull.draft), updatedAt: typeof pull.updated_at === 'string' ? pull.updated_at : null, author: typeof user?.login === 'string' ? user.login : 'Unknown author', authorAvatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : null, head: typeof head?.label === 'string' ? head.label : 'Unknown branch', base: typeof base?.label === 'string' ? base.label : 'Unknown branch', comments: typeof pull.comments === 'number' ? pull.comments : 0, reviewComments: typeof pull.review_comments === 'number' ? pull.review_comments : 0 }];
  });
  return { ok: true, pullRequests, checkedAt: new Date().toISOString() };
}

type PullRequestSection = 'commits' | 'files' | 'reviews' | 'comments' | 'review-comments';
const pullRequestSectionPath: Record<PullRequestSection, (prefix: string, number: number, page: number) => string> = {
  commits: (prefix, number, page) => `${prefix}/pulls/${number}/commits?per_page=30&page=${page}`,
  files: (prefix, number, page) => `${prefix}/pulls/${number}/files?per_page=30&page=${page}`,
  reviews: (prefix, number, page) => `${prefix}/pulls/${number}/reviews?per_page=30&page=${page}`,
  comments: (prefix, number, page) => `${prefix}/issues/${number}/comments?per_page=30&page=${page}`,
  'review-comments': (prefix, number, page) => `${prefix}/pulls/${number}/comments?per_page=30&page=${page}`
};

function normalizePullRequestSection(section: PullRequestSection, body: unknown) {
  if (!Array.isArray(body)) return [];
  return body.flatMap<unknown>((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const user = value.user as Record<string, unknown> | null;
    const author = typeof user?.login === 'string' ? user.login : 'Unknown author';
    const url = typeof value.html_url === 'string' ? value.html_url : null;
    if (section === 'commits') {
      const commit = value.commit as Record<string, unknown> | null;
      const authorInfo = commit?.author as Record<string, unknown> | null;
      const message = typeof commit?.message === 'string' ? commit.message.split(/\r?\n/, 1)[0] : 'Commit';
      return [{ id: typeof value.sha === 'string' ? value.sha : String(value.node_id || Math.random()), title: message, author: typeof authorInfo?.name === 'string' ? authorInfo.name : author, date: typeof authorInfo?.date === 'string' ? authorInfo.date : null, url }];
    }
    if (section === 'files') return [{ id: typeof value.filename === 'string' ? value.filename : String(value.sha || ''), title: typeof value.filename === 'string' ? value.filename : 'Changed file', status: typeof value.status === 'string' ? value.status : 'modified', additions: typeof value.additions === 'number' ? value.additions : 0, deletions: typeof value.deletions === 'number' ? value.deletions : 0, patch: typeof value.patch === 'string' ? value.patch : null, url: typeof value.blob_url === 'string' ? value.blob_url : url }];
    if (section === 'reviews') return [{ id: typeof value.id === 'number' ? value.id : String(value.node_id || ''), title: typeof value.state === 'string' ? value.state.replace(/_/g, ' ').toLowerCase() : 'Review', author, body: typeof value.body === 'string' ? value.body : '', date: typeof value.submitted_at === 'string' ? value.submitted_at : null, url }];
    return [{ id: typeof value.id === 'number' ? value.id : String(value.node_id || Math.random()), title: section === 'review-comments' ? `${typeof value.path === 'string' ? value.path : 'File'}${typeof value.line === 'number' ? `:${value.line}` : ''}` : 'Discussion', author, body: typeof value.body === 'string' ? value.body : '', date: typeof value.created_at === 'string' ? value.created_at : null, url }];
  });
}

async function getPullRequestApiContext(candidate: unknown, pullNumber: unknown) {
  if (typeof pullNumber !== 'number' || !Number.isInteger(pullNumber) || pullNumber < 1 || pullNumber > 100000000) return { ok: false as const, error: 'Choose a valid pull request.' };
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false as const, error: repository.error };
  const [token, remote] = await Promise.all([readGitHubToken(), getGitHubRemote(repository.path)]);
  if (!token.ok || !token.token) return { ok: false as const, error: token.error || 'Connect GitHub before loading pull request details.' };
  if (!remote) return { ok: false as const, error: 'No github.com remote is configured for this repository.' };
  return { ok: true as const, token: token.token, prefix: `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.name)}` };
}

async function getGitHubPullRequestDetails(candidate: unknown, pullNumber: unknown) {
  const context = await getPullRequestApiContext(candidate, pullNumber);
  if (!context.ok) return { ok: false, error: context.error };
  const number = pullNumber as number;
  const [pullResponse, ...sectionResponses] = await Promise.all([
    githubRequest(`${context.prefix}/pulls/${number}`, context.token),
    ...(Object.keys(pullRequestSectionPath) as PullRequestSection[]).map((section) => githubRequest(pullRequestSectionPath[section](context.prefix, number, 1), context.token))
  ]);
  if (!pullResponse.ok) return { ok: false, error: githubApiError(pullResponse.status, pullResponse.body) };
  const pull = pullResponse.body as Record<string, unknown> | null;
  if (!pull || typeof pull.title !== 'string') return { ok: false, error: 'GitHub returned incomplete pull request details.' };
  const sections = Object.keys(pullRequestSectionPath) as PullRequestSection[];
  const data: Record<string, { items: unknown[]; hasMore: boolean; page: number }> = {};
  for (let index = 0; index < sections.length; index += 1) {
    const response = sectionResponses[index];
    if (!response.ok || !Array.isArray(response.body)) return { ok: false, error: githubApiError(response.status, response.body) };
    const section = sections[index];
    data[section] = { items: normalizePullRequestSection(section, response.body), hasMore: response.hasNextPage, page: 1 };
  }
  return { ok: true, pullRequest: { number, title: pull.title, body: typeof pull.body === 'string' ? pull.body : '', state: typeof pull.state === 'string' ? pull.state : 'unknown', draft: Boolean(pull.draft), updatedAt: typeof pull.updated_at === 'string' ? pull.updated_at : null, head: typeof (pull.head as Record<string, unknown> | null)?.label === 'string' ? (pull.head as { label: string }).label : 'Unknown branch', base: typeof (pull.base as Record<string, unknown> | null)?.label === 'string' ? (pull.base as { label: string }).label : 'Unknown branch', url: typeof pull.html_url === 'string' ? pull.html_url : null }, sections: data, checkedAt: new Date().toISOString() };
}

async function getGitHubPullRequestSection(candidate: unknown, pullNumber: unknown, sectionCandidate: unknown, pageCandidate: unknown) {
  const context = await getPullRequestApiContext(candidate, pullNumber);
  if (!context.ok) return { ok: false, error: context.error, items: [], hasMore: false };
  if (typeof sectionCandidate !== 'string' || !Object.prototype.hasOwnProperty.call(pullRequestSectionPath, sectionCandidate)) return { ok: false, error: 'Choose a valid pull request section.', items: [], hasMore: false };
  if (typeof pageCandidate !== 'number' || !Number.isInteger(pageCandidate) || pageCandidate < 1 || pageCandidate > 1000) return { ok: false, error: 'Choose a valid page.', items: [], hasMore: false };
  const section = sectionCandidate as PullRequestSection;
  const response = await githubRequest(pullRequestSectionPath[section](context.prefix, pullNumber as number, pageCandidate), context.token);
  if (!response.ok || !Array.isArray(response.body)) return { ok: false, error: githubApiError(response.status, response.body), items: [], hasMore: false };
  return { ok: true, items: normalizePullRequestSection(section, response.body), hasMore: response.hasNextPage };
}

async function getGitHubPullRequestChecks(candidate: unknown, pullNumber: unknown) {
  if (typeof pullNumber !== 'number' || !Number.isInteger(pullNumber) || pullNumber < 1 || pullNumber > 100000000) return { ok: false, error: 'Choose a valid pull request.', checks: [] };
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error, checks: [] };
  const [token, remote] = await Promise.all([readGitHubToken(), getGitHubRemote(repository.path)]);
  if (!token.ok || !token.token) return { ok: false, error: token.error || 'Connect GitHub before loading checks.', checks: [] };
  if (!remote) return { ok: false, error: 'No github.com remote is configured for this repository.', checks: [] };
  const prefix = `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.name)}`;
  const pullResponse = await githubRequest(`${prefix}/pulls/${pullNumber}`, token.token);
  const pull = pullResponse.body as { head?: { sha?: unknown } } | null;
  const headSha = pull?.head?.sha;
  if (!pullResponse.ok || typeof headSha !== 'string') return { ok: false, error: githubApiError(pullResponse.status, pullResponse.body), checks: [] };
  const response = await githubRequest(`${prefix}/commits/${encodeURIComponent(headSha)}/check-runs?filter=latest&per_page=100`, token.token);
  const payload = response.body as { check_runs?: unknown } | null;
  if (!response.ok || !Array.isArray(payload?.check_runs)) return { ok: false, error: githubApiError(response.status, response.body), checks: [] };
  const checks = payload.check_runs.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const check = item as Record<string, unknown>; const appInfo = check.app as Record<string, unknown> | null;
    if (typeof check.id !== 'number' || typeof check.name !== 'string' || typeof check.status !== 'string') return [];
    return [{ id: check.id, name: check.name, status: check.status, conclusion: typeof check.conclusion === 'string' ? check.conclusion : null, startedAt: typeof check.started_at === 'string' ? check.started_at : null, completedAt: typeof check.completed_at === 'string' ? check.completed_at : null, url: typeof check.html_url === 'string' ? check.html_url : null, app: typeof appInfo?.name === 'string' ? appInfo.name : null }];
  });
  return { ok: true, checks, checkedAt: new Date().toISOString() };
}

async function openGitHubUrl(candidate: unknown) {
  if (typeof candidate !== 'string') return { ok: false };
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) return { ok: false };
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch { return { ok: false }; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f6f7f9',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!app.isPackaged) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('repo:choose', async () => {
    const selection = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle('repo:list', () => readSavedRepositories());
  ipcMain.handle('repo:save', (_, repoPath: string) => saveRepository(repoPath));
  ipcMain.handle('repo:remove', (_, repoPath: string) => removeRepository(repoPath));
  ipcMain.handle('repo:inspect', (_, repoPath: unknown) => inspectRepository(repoPath));
  ipcMain.handle('repo:history', (_, repoPath: unknown, limit?: number, skip?: number, search?: unknown) => getHistory(repoPath, limit, skip, search));
  ipcMain.handle('repo:stashes', (_, repoPath: unknown) => getStashes(repoPath));
  ipcMain.handle('repo:commit-details', (_, repoPath: unknown, commitId: unknown) => getCommitDetails(repoPath, commitId));
  ipcMain.handle('repo:commit-diff', (_, repoPath: unknown, commitId: unknown, filePath: unknown) => getCommitDiff(repoPath, commitId, filePath));
  ipcMain.handle('repo:branches', (_, repoPath: unknown) => getBranches(repoPath));
  ipcMain.handle('repo:merge-preview', (_, repoPath: unknown, source: unknown) => getMergePreview(repoPath, source));
  ipcMain.handle('github:status', (_, repoPath: unknown) => getGitHubStatus(repoPath));
  ipcMain.handle('github:connect', (_, token: unknown) => connectGitHub(token));
  ipcMain.handle('github:disconnect', () => disconnectGitHub());
  ipcMain.handle('github:pull-requests', (_, repoPath: unknown) => getGitHubPullRequests(repoPath));
  ipcMain.handle('github:pull-request-details', (_, repoPath: unknown, pullNumber: unknown) => getGitHubPullRequestDetails(repoPath, pullNumber));
  ipcMain.handle('github:pull-request-section', (_, repoPath: unknown, pullNumber: unknown, section: unknown, page: unknown) => getGitHubPullRequestSection(repoPath, pullNumber, section, page));
  ipcMain.handle('github:pull-request-checks', (_, repoPath: unknown, pullNumber: unknown) => getGitHubPullRequestChecks(repoPath, pullNumber));
  ipcMain.handle('github:open-url', (_, url: unknown) => openGitHubUrl(url));
  ipcMain.handle('repo:diff', (_, repoPath: unknown, options?: { path?: string; staged?: boolean; base?: string; compare?: string }) => getDiff(repoPath, options));
  ipcMain.handle('repo:operations', (_, repoPath: unknown) => typeof repoPath === 'string' ? operationLog.filter((item) => item.repositoryPath === path.resolve(repoPath)) : []);
  ipcMain.handle('git:operate', (_, repoPath: unknown, operation: GitOperation) => operateGit(repoPath, operation));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function inspectRepository(candidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const [branch, status, upstream, remotes, identity, mergeHead, rebaseHead, cherryPickHead, revertHead, log] = await Promise.all([
    git(['branch', '--show-current'], repository.path),
    git(['status', '--porcelain=v1', '-z'], repository.path),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repository.path),
    git(['remote'], repository.path),
    git(['config', '--get-regexp', '^user\\.(name|email)$'], repository.path),
    git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repository.path),
    git(['rev-parse', '-q', '--verify', 'REBASE_HEAD'], repository.path),
    git(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'], repository.path),
    git(['rev-parse', '-q', '--verify', 'REVERT_HEAD'], repository.path),
    git(['log', '-50', '--date=iso-strict', '--decorate=short', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s'], repository.path)
  ]);
  const upstreamName = upstream.ok ? upstream.stdout.trim() : null;
  const counts = upstreamName ? await git(['rev-list', '--left-right', '--count', `HEAD...${upstreamName}`], repository.path) : null;
  const [ahead, behind] = counts?.ok ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
  const chunks = status.stdout.split('\0').filter(Boolean);
  const files: Array<{ path: string; originalPath?: string; index: string; worktree: string; kind: 'tracked' | 'untracked' }> = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const entry = chunks[index];
    const xy = entry.slice(0, 2);
    if (xy === '!!') continue;
    const file = { path: entry.slice(3), index: xy[0], worktree: xy[1], kind: xy === '??' ? 'untracked' as const : 'tracked' as const };
    if ('RC'.includes(xy[0]) || 'RC'.includes(xy[1])) Object.assign(file, { originalPath: chunks[++index] });
    files.push(file);
  }
  const values = Object.fromEntries(identity.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/, 2)));
  return {
    ok: true,
    repositoryPath: repository.path,
    name: path.basename(repository.path),
    branch: branch.stdout.trim() || null,
    detached: !branch.stdout.trim(),
    upstream: upstreamName,
    remotes: remotes.stdout.split(/\r?\n/).filter(Boolean),
    counts: { ahead: ahead || 0, behind: behind || 0 },
    files,
    identity: { name: values['user.name'] || null, email: values['user.email'] || null },
    operation: mergeHead.ok ? 'merge' : rebaseHead.ok ? 'rebase' : cherryPickHead.ok ? 'cherry-pick' : revertHead.ok ? 'revert' : null,
    log: log.stdout,
    checkedAt: new Date().toISOString()
  };
}

async function operateGit(candidate: unknown, operation: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, stdout: '', stderr: repository.error };
  const request = validateOperation(operation);
  if (!request) return { ok: false, stdout: '', stderr: 'This Git operation has invalid input.' };
  if (activeOperations.has(repository.path)) return { ok: false, stdout: '', stderr: 'Another Git operation is already running for this repository.' };
  activeOperations.add(repository.path);
  try {
    const snapshot = await inspectRepository(repository.path);
    if (!snapshot.ok || !snapshot.identity || !snapshot.files) return { ok: false, stdout: '', stderr: snapshot.ok ? 'Unable to inspect this repository.' : snapshot.error };
    if (snapshot.operation && !['merge-continue', 'merge-abort', 'continue-operation', 'abort-operation'].includes(request.type)) return { ok: false, stdout: '', stderr: `Finish or abort the active ${snapshot.operation} before starting another operation.` };
    let args: string[];
    switch (request.type) {
      case 'fetch': args = ['fetch', '--all', '--prune']; break;
      case 'pull':
        if (!snapshot.upstream) return { ok: false, stdout: '', stderr: 'This branch has no upstream. Publish it before pulling.' };
        args = request.strategy === 'rebase' ? ['pull', '--rebase'] : request.strategy === 'merge' ? ['pull', '--no-rebase'] : ['pull', '--ff-only']; break;
      case 'push':
        if (!snapshot.branch) return { ok: false, stdout: '', stderr: 'Cannot push while HEAD is detached. Switch to a branch first.' };
        args = request.setUpstream ? ['push', '--set-upstream', 'origin', snapshot.branch] : ['push']; break;
      case 'stage': args = ['add', '--', ...request.paths]; break;
      case 'unstage': args = ['restore', '--staged', '--', ...request.paths]; break;
      case 'discard':
        if (request.paths.some((filePath) => !snapshot.files.some((file) => file.path === filePath && file.kind === 'tracked' && file.worktree !== ' '))) return { ok: false, stdout: '', stderr: 'Only unstaged tracked changes can be discarded here. Unstage staged files or move untracked files to the Recycle Bin.' };
        args = ['restore', '--worktree', '--', ...request.paths]; break;
      case 'trash-untracked': {
        if (request.paths.some((filePath) => !snapshot.files.some((file) => file.path === filePath && file.kind === 'untracked'))) return { ok: false, stdout: '', stderr: 'Only untracked files can be moved to the Recycle Bin.' };
        try { for (const relativePath of request.paths) {
          const target = path.resolve(repository.path, relativePath);
          if (!target.startsWith(`${repository.path}${path.sep}`)) return { ok: false, stdout: '', stderr: 'Invalid untracked file path.' };
          await shell.trashItem(target);
        } } catch { return { ok: false, stdout: '', stderr: 'Gitwise could not move the selected untracked file to the Recycle Bin.' }; }
        recordOperation(repository.path, 'Move untracked files to Recycle Bin', true, request.paths.join(', '));
        return { ok: true, stdout: 'Moved selected untracked files to the Recycle Bin.', stderr: '' };
      }
      case 'commit':
        if (!request.message.trim()) return { ok: false, stdout: '', stderr: 'Commit message cannot be empty.' };
        if (!snapshot.identity.name || !snapshot.identity.email) return { ok: false, stdout: '', stderr: 'Configure your Git author name and email before committing.' };
        if (!snapshot.files.some((file) => file.index !== ' ' && file.index !== '?')) return { ok: false, stdout: '', stderr: 'Stage at least one change before committing.' };
        args = ['commit', '-m', request.message.trim()]; break;
      case 'stash': args = ['stash', 'push', '-u', ...(request.message?.trim() ? ['-m', request.message.trim()] : [])]; break;
      case 'stash-pop': args = ['stash', 'pop']; break;
      case 'stash-apply': case 'stash-pop-selected': {
        const list = await getStashes(repository.path);
        if (!list.ok) return { ok: false, stdout: '', stderr: list.error };
        const selected = list.stashes.find((stash) => stash.id === request.stashId);
        if (!selected) return { ok: false, stdout: '', stderr: 'That stash is no longer in this repository. Refresh the stash list and choose again.' };
        args = ['stash', request.type === 'stash-apply' ? 'apply' : 'pop', selected.selector];
        break;
      }
      case 'apply-hunk': {
        const diff = await git(['diff', '--no-ext-diff', '--unified=3', ...(request.staged ? ['--cached'] : []), '--', request.path], repository.path);
        if (!diff.ok) return { ok: false, stdout: '', stderr: cleanGitError(diff.stderr) };
        const patch = selectedHunkPatch(diff.stdout, request.hunkIndex);
        if (!patch) return { ok: false, stdout: '', stderr: 'This hunk no longer matches the current diff. Refresh the file and choose it again.' };
        const result = await gitWithInput(['apply', '--cached', '--recount', '--whitespace=nowarn', ...(request.staged ? ['-R'] : []), '-'], repository.path, patch);
        recordOperation(repository.path, request.type, result.ok, result.ok ? result.stdout : result.stderr);
        return { ...result, stderr: cleanGitError(result.stderr) };
      }
      case 'create-branch':
        if (!validRef(request.name) || (request.startPoint && !validRef(request.startPoint))) return { ok: false, stdout: '', stderr: 'Use valid branch names.' };
        args = ['switch', '-c', request.name, ...(request.startPoint ? [request.startPoint] : [])]; break;
      case 'switch-branch': if (!validRef(request.name)) return { ok: false, stdout: '', stderr: 'Choose a valid branch.' }; args = ['switch', request.name]; break;
      case 'rename-branch': if (!validRef(request.oldName) || !validRef(request.newName)) return { ok: false, stdout: '', stderr: 'Use valid branch names.' }; args = ['branch', '-m', request.oldName, request.newName]; break;
      case 'delete-local-branch': if (!validRef(request.name) || request.name === snapshot.branch) return { ok: false, stdout: '', stderr: 'Switch branches before deleting this branch.' }; args = ['branch', request.force ? '-D' : '-d', request.name]; break;
      case 'delete-remote-branch': if (!validRef(request.remote) || !validRef(request.name)) return { ok: false, stdout: '', stderr: 'Choose a valid remote branch.' }; args = ['push', request.remote, '--delete', request.name]; break;
      case 'merge': {
        if (!validRef(request.source)) return { ok: false, stdout: '', stderr: 'Choose a valid source branch.' };
        if (snapshot.files.length) return { ok: false, stdout: '', stderr: 'Commit, stash, or discard local changes before merging. Gitwise keeps unfinished work separate from a merge.' };
        const preview = await getMergePreview(repository.path, request.source);
        if (!preview.ok) return { ok: false, stdout: '', stderr: preview.error };
        if (preview.workingTreeDirty) return { ok: false, stdout: '', stderr: 'Local changes appeared while preparing the merge. Commit, stash, or discard them, then preview again.' };
        if (preview.relationship === 'already-merged') return { ok: false, stdout: '', stderr: `${request.source} is already included in ${preview.target}.` };
        args = ['merge', '--no-edit', request.source];
        break;
      }
      case 'merge-continue': args = ['merge', '--continue']; break;
      case 'merge-abort': args = ['merge', '--abort']; break;
      case 'continue-operation':
        if (!snapshot.operation) return { ok: false, stdout: '', stderr: 'There is no unfinished Git operation to continue.' };
        args = snapshot.operation === 'merge' ? ['merge', '--continue'] : snapshot.operation === 'rebase' ? ['rebase', '--continue'] : snapshot.operation === 'cherry-pick' ? ['cherry-pick', '--continue'] : ['revert', '--continue']; break;
      case 'abort-operation':
        if (!snapshot.operation) return { ok: false, stdout: '', stderr: 'There is no unfinished Git operation to abort.' };
        args = snapshot.operation === 'merge' ? ['merge', '--abort'] : snapshot.operation === 'rebase' ? ['rebase', '--abort'] : snapshot.operation === 'cherry-pick' ? ['cherry-pick', '--abort'] : ['revert', '--abort']; break;
    }
    const result = await git(args, repository.path);
    recordOperation(repository.path, request.type, result.ok, result.ok ? result.stdout : result.stderr);
    return { ...result, stderr: cleanGitError(result.stderr) };
  } finally { activeOperations.delete(repository.path); }
}

function selectedHunkPatch(diff: string, hunkIndex: number) {
  const lines = diff.split(/\r?\n/);
  const starts = lines.reduce<number[]>((indexes, line, index) => { if (line.startsWith('@@ ')) indexes.push(index); return indexes; }, []);
  if (hunkIndex < 0 || hunkIndex >= starts.length) return null;
  const header = lines.slice(0, starts[0]);
  if (!header.some((line) => line.startsWith('diff --git ')) || !header.some((line) => line.startsWith('--- ')) || !header.some((line) => line.startsWith('+++ '))) return null;
  const end = starts[hunkIndex + 1] ?? lines.length;
  return [...header, ...lines.slice(starts[hunkIndex], end)].join('\n').replace(/\n+$/, '\n');
}

async function getHistory(candidate: unknown, limit = 50, skip = 0, search: unknown = '') {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  if (typeof search !== 'string' || search.length > 200 || search.includes('\0')) return { ok: false, error: 'Search text must be 200 characters or fewer.' };
  const pageSize = Math.min(Math.max(Math.floor(Number(limit) || 50), 1), 100);
  const offset = Math.min(Math.max(Math.floor(Number(skip) || 0), 0), 10000000);
  const args = ['log', `--max-count=${pageSize + 1}`, `--skip=${offset}`];
  if (search.trim()) args.push('--fixed-strings', '--regexp-ignore-case', `--grep=${search.trim()}`);
  args.push('--date=iso-strict', '--decorate=short', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s');
  const result = await git(args, repository.path);
  if (!result.ok) return { ok: false, error: result.stderr };
  const rows = result.stdout.split(/\r?\n/).filter(Boolean);
  const hasMore = rows.length > pageSize;
  const commits = rows.slice(0, pageSize).map((line) => { const [id, shortId, author, email, date, refs, subject] = line.split('\x1f'); return { id, shortId, author, email, date, refs: refs ? refs.split(', ').filter(Boolean) : [], subject }; });
  return { ok: true, commits, hasMore };
}

async function getStashes(candidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error, stashes: [] };
  const result = await git(['stash', 'list', '--format=%H%x00%gd%x00%gs%x00%an%x00%aI'], repository.path);
  if (!result.ok) return { ok: false, error: result.stderr, stashes: [] };
  const fields = result.stdout.split('\0').map((field) => field.replace(/^[\r\n]+|[\r\n]+$/g, ''));
  const stashes: Array<{ id: string; selector: string; subject: string; author: string; date: string }> = [];
  for (let index = 0; index + 4 < fields.length; index += 5) {
    const [id, selector, subject, author, date] = fields.slice(index, index + 5);
    if (/^[0-9a-f]{40,64}$/i.test(id) && /^stash@\{\d+\}$/.test(selector)) stashes.push({ id, selector, subject, author, date });
  }
  return { ok: true, stashes };
}

async function resolveCommit(repositoryPath: string, candidate: unknown) {
  if (typeof candidate !== 'string' || !/^[0-9a-f]{7,40}$/i.test(candidate)) return { ok: false as const, error: 'Choose a valid commit from this repository.' };
  const resolved = await git(['rev-parse', '--verify', `${candidate}^{commit}`], repositoryPath);
  if (!resolved.ok) return { ok: false as const, error: 'That commit is not available in this repository.' };
  return { ok: true as const, id: resolved.stdout.trim() };
}

async function getCommitDetails(candidate: unknown, commitCandidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const commit = await resolveCommit(repository.path, commitCandidate);
  if (!commit.ok) return { ok: false, error: commit.error };
  const [metadata, changed] = await Promise.all([
    git(['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%aI%x1f%P%x1f%B', commit.id], repository.path),
    git(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '--first-parent', commit.id], repository.path)
  ]);
  if (!metadata.ok) return { ok: false, error: metadata.stderr };
  if (!changed.ok) return { ok: false, error: changed.stderr };
  const [id, shortId, author, authorEmail, committer, committerEmail, date, parents, ...message] = metadata.stdout.split('\x1f');
  const fields = changed.stdout.split('\0').filter(Boolean);
  const files: Array<{ path: string; originalPath?: string; status: string }> = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith('R') || status.startsWith('C')) {
      const originalPath = fields[index++];
      const filePath = fields[index++];
      if (originalPath && filePath) files.push({ path: filePath, originalPath, status });
    } else {
      const filePath = fields[index++];
      if (filePath) files.push({ path: filePath, status });
    }
  }
  return { ok: true, commit: { id, shortId, author, authorEmail, committer, committerEmail, date, parents: parents ? parents.split(' ').filter(Boolean) : [], message: message.join('\x1f').trim() }, files };
}

async function getCommitDiff(candidate: unknown, commitCandidate: unknown, fileCandidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const commit = await resolveCommit(repository.path, commitCandidate);
  if (!commit.ok) return { ok: false, error: commit.error };
  const files = [fileCandidate];
  if (!validPaths(files)) return { ok: false, error: 'Choose a valid file from this commit.' };
  const result = await git(['show', '--first-parent', '--format=', '--no-ext-diff', '--unified=3', commit.id, '--', files[0]], repository.path);
  return result.ok ? { ok: true, patch: result.stdout } : { ok: false, error: cleanGitError(result.stderr) };
}

async function getBranches(candidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const format = '%(refname:short)%1f%(refname)%1f%(upstream:short)%1f%(HEAD)%1f%(objectname:short)%1f%(authordate:iso-strict)%1f%(authorname)%1f%(subject)';
  const result = await git(['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'], repository.path);
  if (!result.ok) return { ok: false, error: result.stderr };
  return { ok: true, branches: result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => !line.includes('/HEAD\x1f')).map((line) => { const [name, fullName, upstream, head, shortId, date, author, subject] = line.split('\x1f'); return { name, fullName, upstream: upstream || null, current: head === '*', remote: fullName.startsWith('refs/remotes/'), shortId, date, author, subject }; }) };
}

async function getMergePreview(candidate: unknown, sourceCandidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  if (!validRef(sourceCandidate)) return { ok: false, error: 'Choose a valid source branch.' };
  const source = sourceCandidate as string;
  const [targetResult, sourceResult, statusResult] = await Promise.all([
    git(['branch', '--show-current'], repository.path),
    git(['rev-parse', '--verify', `${source}^{commit}`], repository.path),
    git(['status', '--porcelain=v1'], repository.path)
  ]);
  const target = targetResult.stdout.trim();
  if (!target) return { ok: false, error: 'Switch to a local branch before previewing a merge.' };
  if (!sourceResult.ok) return { ok: false, error: 'That source branch is no longer available in this repository.' };
  if (source === target) return { ok: true, source, target, relationship: 'already-merged', conflictPreview: 'clean', workingTreeDirty: Boolean(statusResult.stdout.trim()), commits: [], files: [], additions: 0, deletions: 0 };
  const [sourceAlreadyIncluded, targetAlreadyIncluded, commitResult, numstatResult] = await Promise.all([
    git(['merge-base', '--is-ancestor', source, 'HEAD'], repository.path),
    git(['merge-base', '--is-ancestor', 'HEAD', source], repository.path),
    git(['log', '--max-count=50', '--date=iso-strict', '--decorate=short', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s', `HEAD..${source}`], repository.path),
    git(['diff', '--numstat', 'HEAD...'+source], repository.path)
  ]);
  if (!commitResult.ok || !numstatResult.ok) return { ok: false, error: cleanGitError(commitResult.stderr || numstatResult.stderr) || 'Unable to compare these branches.' };
  const relationship = sourceAlreadyIncluded.ok ? 'already-merged' : targetAlreadyIncluded.ok ? 'fast-forward' : 'merge-commit';
  let conflictPreview: 'clean' | 'conflicts' | 'unavailable' = 'clean';
  if (relationship !== 'already-merged') {
    const tree = await git(['merge-tree', '--write-tree', 'HEAD', source], repository.path);
    if (!tree.ok) conflictPreview = /unknown option|usage:|not a valid object/i.test(tree.stderr) ? 'unavailable' : 'conflicts';
  }
  const commits = commitResult.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [id, shortId, author, email, date, refs, subject] = line.split('\x1f'); return { id, shortId, author, email, date, refs: refs ? refs.split(', ').filter(Boolean) : [], subject }; });
  let additions = 0; let deletions = 0;
  const files = numstatResult.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [added, deleted, ...pathParts] = line.split('\t'); const binary = added === '-' || deleted === '-'; const filePath = pathParts.join('\t'); if (!binary) { additions += Number(added) || 0; deletions += Number(deleted) || 0; } return { path: filePath, additions: binary ? null : Number(added) || 0, deletions: binary ? null : Number(deleted) || 0, binary }; }).filter((file) => file.path);
  return { ok: true, source, target, relationship, conflictPreview, workingTreeDirty: Boolean(statusResult.stdout.trim()), commits, files, additions, deletions };
}

async function getDiff(candidate: unknown, options: { path?: string; staged?: boolean; base?: string; compare?: string } = {}) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const args = ['diff', '--no-ext-diff', '--unified=3'];
  if (options.base && options.compare) {
    if (!validRef(options.base) || !validRef(options.compare)) return { ok: false, error: 'Choose valid branches to compare.' };
    args.push(`${options.base}...${options.compare}`);
  } else if (options.staged) args.push('--cached');
  if (options.path) { if (!validPaths([options.path])) return { ok: false, error: 'Choose a valid file.' }; args.push('--', options.path); }
  const [patch, stat] = await Promise.all([git(args, repository.path), git([...args.slice(0, 1), '--stat', ...args.slice(1)], repository.path)]);
  if (!patch.ok) return { ok: false, error: patch.stderr };
  return { ok: true, patch: patch.stdout, stat: stat.stdout };
}

function repositoriesFile() { return path.join(app.getPath('userData'), 'repositories.json'); }

async function readSavedRepositories(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(repositoriesFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch { return []; }
}

async function writeSavedRepositories(repositories: string[]) {
  await fs.mkdir(path.dirname(repositoriesFile()), { recursive: true });
  await fs.writeFile(repositoriesFile(), JSON.stringify(repositories, null, 2), 'utf8');
  return repositories;
}

async function saveRepository(repoPath: unknown) {
  const repository = await resolveRepository(repoPath);
  if (!repository.ok) return { ok: false, error: repository.error, repositories: await readSavedRepositories() };
  const current = await readSavedRepositories();
  const repositories = await writeSavedRepositories([repository.path, ...current.filter((value) => value !== repository.path)].slice(0, 12));
  return { ok: true, repositories };
}

async function removeRepository(repoPath: string) {
  const current = await readSavedRepositories();
  return writeSavedRepositories(current.filter((value) => value !== repoPath));
}
