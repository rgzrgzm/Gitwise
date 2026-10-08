import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('branchline', {
  chooseRepository: () => ipcRenderer.invoke('repo:choose'),
  inspectRepository: (repoPath: string) => ipcRenderer.invoke('repo:inspect', repoPath),
  operateGit: (repoPath: string, operation: unknown) => ipcRenderer.invoke('git:operate', { repoPath, operation })
});
