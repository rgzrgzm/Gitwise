export {};

declare global {
  interface Window {
    branchline?: {
      chooseRepository: () => Promise<string | null>;
      listRepositories: () => Promise<string[]>;
      saveRepository: (repoPath: string) => Promise<string[]>;
      removeRepository: (repoPath: string) => Promise<string[]>;
      inspectRepository: (repoPath: string) => Promise<unknown>;
      operateGit: (repoPath: string, operation: unknown) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
    };
  }
}
