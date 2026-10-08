import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('branchline', {
  chooseRepository: () => ipcRenderer.invoke('repo:choose'),
  listRepositories: () => ipcRenderer.invoke('repo:list'),
  saveRepository: (repoPath: string) => ipcRenderer.invoke('repo:save', repoPath),
  removeRepository: (repoPath: string) => ipcRenderer.invoke('repo:remove', repoPath),
  inspectRepository: (repoPath: string) => ipcRenderer.invoke('repo:inspect', repoPath),
  getHistory: (repoPath: string, limit = 50, skip = 0) => ipcRenderer.invoke('repo:history', repoPath, limit, skip),
  getBranches: (repoPath: string) => ipcRenderer.invoke('repo:branches', repoPath),
  getDiff: (repoPath: string, options: unknown) => ipcRenderer.invoke('repo:diff', repoPath, options),
  operateGit: (repoPath: string, operation: unknown) => ipcRenderer.invoke('git:operate', repoPath, operation)
});
