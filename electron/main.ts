import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const execFileAsync = promisify(execFile);

type GitOperation =
  | { type: 'fetch'; remote?: string }
  | { type: 'pull' }
  | { type: 'push' }
  | { type: 'stage'; paths: string[] }
  | { type: 'unstage'; paths: string[] }
  | { type: 'commit'; message: string }
  | { type: 'create-branch'; name: string; startPoint?: string }
  | { type: 'switch-branch'; name: string };

const activeOperations = new Set<string>();

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

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('repo:choose', async () => {
    const selection = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle('repo:list', () => readSavedRepositories());
  ipcMain.handle('repo:default', async () => {
    const result = await git(['rev-parse', '--show-toplevel'], process.cwd());
    return result.ok ? result.stdout : null;
  });
  ipcMain.handle('repo:save', (_, repoPath: string) => saveRepository(repoPath));
  ipcMain.handle('repo:remove', (_, repoPath: string) => removeRepository(repoPath));
  ipcMain.handle('repo:inspect', (_, repoPath: string) => inspectRepository(repoPath));
  ipcMain.handle('git:operate', (_, payload: { repoPath: string; operation: GitOperation }) => operateGit(payload.repoPath, payload.operation));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function inspectRepository(repoPath: string) {
  const [branch, status, remotes, counts, log] = await Promise.all([
    git(['branch', '--show-current'], repoPath),
    git(['status', '--porcelain=v1', '-b'], repoPath),
    git(['remote', '-v'], repoPath),
    git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], repoPath),
    git(['log', '-8', '--format=%H%x1f%h%x1f%an%x1f%ar%x1f%s'], repoPath)
  ]);
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  const files = lines.filter((line) => !line.startsWith('## ')).map((line) => ({ index: line[0], worktree: line[1], path: line.slice(3) }));
  const countParts = counts.ok ? counts.stdout.split(/\s+/).map(Number) : [0, 0];
  return {
    branch: branch.stdout,
    status: status.stdout,
    files,
    remotes: remotes.stdout,
    counts: { ahead: countParts[0] || 0, behind: countParts[1] || 0 },
    log: log.stdout,
    ok: branch.ok
  };
}

async function operateGit(repoPath: string, operation: GitOperation) {
  if (activeOperations.has(repoPath)) return { ok: false, stderr: 'Another Git operation is already running for this repository.' };
  activeOperations.add(repoPath);
  try {
    let args: string[];
    switch (operation.type) {
      case 'fetch': args = ['fetch', operation.remote || '--all', '--prune']; break;
      case 'pull': args = ['pull', '--ff-only']; break;
      case 'push': args = ['push']; break;
      case 'stage': args = ['add', '--', ...safePaths(operation.paths)]; break;
      case 'unstage': args = ['restore', '--staged', '--', ...safePaths(operation.paths)]; break;
      case 'commit':
        if (!operation.message.trim()) return { ok: false, stderr: 'Commit message cannot be empty.' };
        args = ['commit', '-m', operation.message.trim()]; break;
      case 'create-branch':
        if (!/^[A-Za-z0-9._/-]+$/.test(operation.name)) return { ok: false, stderr: 'Branch name contains unsupported characters.' };
        args = ['switch', '-c', operation.name, ...(operation.startPoint ? [operation.startPoint] : [])]; break;
      case 'switch-branch': args = ['switch', operation.name]; break;
    }
    return await git(args, repoPath);
  } finally { activeOperations.delete(repoPath); }
}

function safePaths(paths: string[]) {
  return paths.filter((value) => value && value !== '.' && value !== '..' && !value.includes('\0'));
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

async function saveRepository(repoPath: string) {
  const current = await readSavedRepositories();
  return writeSavedRepositories([repoPath, ...current.filter((value) => value !== repoPath)].slice(0, 12));
}

async function removeRepository(repoPath: string) {
  const current = await readSavedRepositories();
  return writeSavedRepositories(current.filter((value) => value !== repoPath));
}
