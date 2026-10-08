import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
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
  | { type: 'commit'; message: string }
  | { type: 'stash'; message?: string }
  | { type: 'stash-pop' }
  | { type: 'create-branch'; name: string; startPoint?: string }
  | { type: 'switch-branch'; name: string }
  | { type: 'rename-branch'; oldName: string; newName: string }
  | { type: 'delete-local-branch'; name: string; force?: boolean }
  | { type: 'delete-remote-branch'; remote: string; name: string }
  | { type: 'merge'; source: string }
  | { type: 'merge-continue' }
  | { type: 'merge-abort' };

const activeOperations = new Set<string>();

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

async function git(args: string[], cwd: string) {
  try {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 4 });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout?.trim() ?? '', stderr: e.stderr?.trim() || e.message || 'Git operation failed' };
  }
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
  ipcMain.handle('repo:history', (_, repoPath: unknown, limit?: number, skip?: number) => getHistory(repoPath, limit, skip));
  ipcMain.handle('repo:branches', (_, repoPath: unknown) => getBranches(repoPath));
  ipcMain.handle('repo:diff', (_, repoPath: unknown, options?: { path?: string; staged?: boolean; base?: string; compare?: string }) => getDiff(repoPath, options));
  ipcMain.handle('git:operate', (_, repoPath: unknown, operation: GitOperation) => operateGit(repoPath, operation));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function inspectRepository(candidate: unknown) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const [branch, status, upstream, remotes, identity, mergeHead, log] = await Promise.all([
    git(['branch', '--show-current'], repository.path),
    git(['status', '--porcelain=v1', '-z'], repository.path),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repository.path),
    git(['remote'], repository.path),
    git(['config', '--get-regexp', '^user\\.(name|email)$'], repository.path),
    git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repository.path),
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
    operation: mergeHead.ok ? 'merge' : null,
    log: log.stdout,
    checkedAt: new Date().toISOString()
  };
}

async function operateGit(candidate: unknown, operation: GitOperation) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, stdout: '', stderr: repository.error };
  if (!operation || typeof operation !== 'object' || !('type' in operation)) return { ok: false, stdout: '', stderr: 'Unknown Git operation.' };
  if (activeOperations.has(repository.path)) return { ok: false, stdout: '', stderr: 'Another Git operation is already running for this repository.' };
  activeOperations.add(repository.path);
  try {
    const snapshot = await inspectRepository(repository.path);
    if (!snapshot.ok || !snapshot.identity || !snapshot.files) return { ok: false, stdout: '', stderr: snapshot.ok ? 'Unable to inspect this repository.' : snapshot.error };
    let args: string[];
    switch (operation.type) {
      case 'fetch': args = ['fetch', '--all', '--prune']; break;
      case 'pull':
        if (!snapshot.upstream) return { ok: false, stdout: '', stderr: 'This branch has no upstream. Publish it before pulling.' };
        args = operation.strategy === 'rebase' ? ['pull', '--rebase'] : operation.strategy === 'merge' ? ['pull', '--no-rebase'] : ['pull', '--ff-only']; break;
      case 'push':
        if (!snapshot.branch) return { ok: false, stdout: '', stderr: 'Cannot push while HEAD is detached. Switch to a branch first.' };
        args = operation.setUpstream ? ['push', '--set-upstream', 'origin', snapshot.branch] : ['push']; break;
      case 'stage': if (!validPaths(operation.paths)) return { ok: false, stdout: '', stderr: 'Choose valid files to stage.' }; args = ['add', '--', ...operation.paths]; break;
      case 'unstage': if (!validPaths(operation.paths)) return { ok: false, stdout: '', stderr: 'Choose valid files to unstage.' }; args = ['restore', '--staged', '--', ...operation.paths]; break;
      case 'discard': if (!validPaths(operation.paths)) return { ok: false, stdout: '', stderr: 'Choose valid files to discard.' }; args = ['restore', '--worktree', '--', ...operation.paths]; break;
      case 'commit':
        if (!operation.message.trim()) return { ok: false, stderr: 'Commit message cannot be empty.' };
        if (!snapshot.identity.name || !snapshot.identity.email) return { ok: false, stdout: '', stderr: 'Configure your Git author name and email before committing.' };
        if (!snapshot.files.some((file) => file.index !== ' ' && file.index !== '?')) return { ok: false, stdout: '', stderr: 'Stage at least one change before committing.' };
        args = ['commit', '-m', operation.message.trim()]; break;
      case 'stash': args = ['stash', 'push', '-u', ...(operation.message?.trim() ? ['-m', operation.message.trim()] : [])]; break;
      case 'stash-pop': args = ['stash', 'pop']; break;
      case 'create-branch':
        if (!validRef(operation.name) || (operation.startPoint && !validRef(operation.startPoint))) return { ok: false, stdout: '', stderr: 'Use valid branch names.' };
        args = ['switch', '-c', operation.name, ...(operation.startPoint ? [operation.startPoint] : [])]; break;
      case 'switch-branch': if (!validRef(operation.name)) return { ok: false, stdout: '', stderr: 'Choose a valid branch.' }; args = ['switch', operation.name]; break;
      case 'rename-branch': if (!validRef(operation.oldName) || !validRef(operation.newName)) return { ok: false, stdout: '', stderr: 'Use valid branch names.' }; args = ['branch', '-m', operation.oldName, operation.newName]; break;
      case 'delete-local-branch': if (!validRef(operation.name) || operation.name === snapshot.branch) return { ok: false, stdout: '', stderr: 'Switch branches before deleting this branch.' }; args = ['branch', operation.force ? '-D' : '-d', operation.name]; break;
      case 'delete-remote-branch': if (!validRef(operation.remote) || !validRef(operation.name)) return { ok: false, stdout: '', stderr: 'Choose a valid remote branch.' }; args = ['push', operation.remote, '--delete', operation.name]; break;
      case 'merge': if (!validRef(operation.source)) return { ok: false, stdout: '', stderr: 'Choose a valid source branch.' }; if (snapshot.operation) return { ok: false, stdout: '', stderr: 'Finish or abort the current merge first.' }; args = ['merge', '--no-edit', operation.source]; break;
      case 'merge-continue': args = ['merge', '--continue']; break;
      case 'merge-abort': args = ['merge', '--abort']; break;
    }
    return await git(args, repository.path);
  } finally { activeOperations.delete(repository.path); }
}

async function getHistory(candidate: unknown, limit = 50, skip = 0) {
  const repository = await resolveRepository(candidate);
  if (!repository.ok) return { ok: false, error: repository.error };
  const result = await git(['log', `--max-count=${Math.min(Math.max(Number(limit) || 50, 1), 200)}`, `--skip=${Math.max(Number(skip) || 0, 0)}`, '--date=iso-strict', '--decorate=short', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s'], repository.path);
  if (!result.ok) return { ok: false, error: result.stderr };
  return { ok: true, commits: result.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [id, shortId, author, email, date, refs, subject] = line.split('\x1f'); return { id, shortId, author, email, date, refs: refs ? refs.split(', ').filter(Boolean) : [], subject }; }) };
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
