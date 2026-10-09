import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('branchline', {
  chooseRepository: () => ipcRenderer.invoke('repo:choose'),
  listRepositories: () => ipcRenderer.invoke('repo:list'),
  saveRepository: (repoPath: string) => ipcRenderer.invoke('repo:save', repoPath),
  removeRepository: (repoPath: string) => ipcRenderer.invoke('repo:remove', repoPath),
  inspectRepository: (repoPath: string) => ipcRenderer.invoke('repo:inspect', repoPath),
  getHistory: (repoPath: string, limit = 50, skip = 0, search = '') => ipcRenderer.invoke('repo:history', repoPath, limit, skip, search),
  getStashes: (repoPath: string) => ipcRenderer.invoke('repo:stashes', repoPath),
  getCommitDetails: (repoPath: string, commitId: string) => ipcRenderer.invoke('repo:commit-details', repoPath, commitId),
  getCommitDiff: (repoPath: string, commitId: string, filePath: string) => ipcRenderer.invoke('repo:commit-diff', repoPath, commitId, filePath),
  getBranches: (repoPath: string) => ipcRenderer.invoke('repo:branches', repoPath),
  getMergePreview: (repoPath: string, source: string) => ipcRenderer.invoke('repo:merge-preview', repoPath, source),
  getGitHubStatus: (repoPath: string) => ipcRenderer.invoke('github:status', repoPath),
  connectGitHub: (token: string) => ipcRenderer.invoke('github:connect', token),
  disconnectGitHub: () => ipcRenderer.invoke('github:disconnect'),
  getGitHubPullRequests: (repoPath: string, state: 'open' | 'closed' | 'all', page: number) => ipcRenderer.invoke('github:pull-requests', repoPath, state, page),
  getGitHubActivity: (repoPath: string, page: number) => ipcRenderer.invoke('github:activity', repoPath, page),
  getGitHubPullRequestDetails: (repoPath: string, pullNumber: number) => ipcRenderer.invoke('github:pull-request-details', repoPath, pullNumber),
  getGitHubPullRequestReadiness: (repoPath: string, pullNumber: number) => ipcRenderer.invoke('github:pull-request-readiness', repoPath, pullNumber),
  getGitHubPullRequestSection: (repoPath: string, pullNumber: number, section: string, page: number) => ipcRenderer.invoke('github:pull-request-section', repoPath, pullNumber, section, page),
  getGitHubPullRequestChecks: (repoPath: string, pullNumber: number) => ipcRenderer.invoke('github:pull-request-checks', repoPath, pullNumber),
  openGitHubUrl: (url: string) => ipcRenderer.invoke('github:open-url', url),
  getDiff: (repoPath: string, options: unknown) => ipcRenderer.invoke('repo:diff', repoPath, options),
  getOperations: (repoPath: string) => ipcRenderer.invoke('repo:operations', repoPath),
  operateGit: (repoPath: string, operation: unknown) => ipcRenderer.invoke('git:operate', repoPath, operation)
});
