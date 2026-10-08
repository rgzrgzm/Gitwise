import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('branchline', {
  chooseRepository: () => ipcRenderer.invoke('repo:choose'),
  inspectRepository: (repoPath: string) => ipcRenderer.invoke('repo:inspect', repoPath),
  runGit: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:run', { repoPath, args })
});
