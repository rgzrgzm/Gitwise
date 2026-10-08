export {};

declare global {
  interface Window {
    branchline?: {
      chooseRepository: () => Promise<string | null>;
      inspectRepository: (repoPath: string) => Promise<unknown>;
      runGit: (repoPath: string, args: string[]) => Promise<unknown>;
    };
  }
}
