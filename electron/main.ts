import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { promises as fs } from 'node:fs';

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
      case 'merge': if (!validRef(request.source)) return { ok: false, stdout: '', stderr: 'Choose a valid source branch.' }; args = ['merge', '--no-edit', request.source]; break;
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
