export {};

declare global {
  interface Window {
    branchline?: {
      chooseRepository: () => Promise<string | null>;
      inspectRepository: (repoPath: string) => Promise<unknown>;
      operateGit: (repoPath: string, operation: unknown) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
    };
  }
}
