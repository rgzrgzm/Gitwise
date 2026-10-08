export {};

declare global {
  interface Window {
    branchline?: {
      chooseRepository: () => Promise<string | null>;
      listRepositories: () => Promise<string[]>;
      saveRepository: (repoPath: string) => Promise<{ ok: boolean; error?: string; repositories: string[] }>;
      removeRepository: (repoPath: string) => Promise<string[]>;
      inspectRepository: (repoPath: string) => Promise<unknown>;
      getHistory: (repoPath: string, limit?: number, skip?: number, search?: string) => Promise<unknown>;
      getStashes: (repoPath: string) => Promise<unknown>;
      getCommitDetails: (repoPath: string, commitId: string) => Promise<unknown>;
      getCommitDiff: (repoPath: string, commitId: string, filePath: string) => Promise<unknown>;
      getBranches: (repoPath: string) => Promise<unknown>;
      getMergePreview: (repoPath: string, source: string) => Promise<unknown>;
      getDiff: (repoPath: string, options: unknown) => Promise<unknown>;
      getOperations: (repoPath: string) => Promise<unknown>;
      operateGit: (repoPath: string, operation: unknown) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
    };
  }
}
