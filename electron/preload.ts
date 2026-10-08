import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('branchline', {
  chooseRepository: () => ipcRenderer.invoke('repo:choose'),
  listRepositories: () => ipcRenderer.invoke('repo:list'),
  saveRepository: (repoPath: string) => ipcRenderer.invoke('repo:save', repoPath),
  removeRepository: (repoPath: string) => ipcRenderer.invoke('repo:remove', repoPath),
  inspectRepository: (repoPath: string) => ipcRenderer.invoke('repo:inspect', repoPath),
  operateGit: (repoPath: string, operation: unknown) => ipcRenderer.invoke('git:operate', { repoPath, operation })
});
