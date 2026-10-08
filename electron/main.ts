import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
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
  ipcMain.handle('repo:inspect', (_, repoPath: string) => inspectRepository(repoPath));
  ipcMain.handle('git:run', (_, payload: { repoPath: string; args: string[] }) => git(payload.args, payload.repoPath));
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
  return { branch: branch.stdout, status: status.stdout, remotes: remotes.stdout, counts: counts.stdout, log: log.stdout, ok: branch.ok };
}
