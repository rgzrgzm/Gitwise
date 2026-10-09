import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, CloudOff, Code2, FileCode2, FolderOpen, GitBranch, GitCommitHorizontal, GitCompareArrows, History, Home, Layers3, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import './gitwise.css';
import { MergeReadinessPanel } from './components/MergeReadinessPanel';
import { CreatePullRequestDialog } from './components/CreatePullRequestDialog';
import { PullRequestCommentForm } from './components/PullRequestCommentForm';

type View = 'Home' | 'Changes' | 'Branches' | 'Compare' | 'Pull requests' | 'Activity';
type FileState = { path: string; originalPath?: string; index: string; worktree: string; kind: 'tracked' | 'untracked' };
type Snapshot = { ok: boolean; error?: string; repositoryPath?: string; name?: string; branch?: string | null; detached?: boolean; upstream?: string | null; remotes?: string[]; counts?: { ahead: number; behind: number }; files?: FileState[]; identity?: { name: string | null; email: string | null }; operation?: string | null; checkedAt?: string; log?: string };
type Commit = { id: string; shortId: string; author: string; email: string; date: string; refs: string[]; subject: string };
type CommitFile = { path: string; originalPath?: string; status: string };
type CommitDetails = { ok: boolean; error?: string; commit?: { id: string; shortId: string; author: string; authorEmail: string; committer: string; committerEmail: string; date: string; parents: string[]; message: string }; files?: CommitFile[] };
type CommitFileDiff = { commitId: string; path: string; patch: string; error?: string };
type Stash = { id: string; selector: string; subject: string; author: string; date: string };
type DiffHunk = { index: number; header: string; body: string };
type MergePreview = { ok: boolean; error?: string; source?: string; target?: string; relationship?: 'already-merged' | 'fast-forward' | 'merge-commit'; conflictPreview?: 'clean' | 'conflicts' | 'unavailable'; workingTreeDirty?: boolean; commits?: Commit[]; files?: Array<{ path: string; additions: number | null; deletions: number | null; binary: boolean }>; additions?: number; deletions?: number };
type GitHubConnection = { ok: boolean; error?: string | null; connected: boolean; secureStorageAvailable?: boolean; account?: { login: string; name: string | null; avatarUrl: string | null; htmlUrl: string | null; connectedAt: string | null } | null; remote?: { remote: string; host: string; owner: string; name: string; url: string } | null };
type PullRequest = { number: number; title: string; url: string; draft: boolean; updatedAt: string | null; author: string; authorAvatarUrl: string | null; head: string; base: string; comments: number; reviewComments: number };
type PullRequestCheck = { id: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null; url: string | null; app: string | null };
type PullRequestSection = 'commits' | 'files' | 'reviews' | 'comments' | 'review-comments';
type PullRequestEntry = { id: string | number; title: string; author?: string; date?: string | null; url?: string | null; body?: string; status?: string; additions?: number; deletions?: number; patch?: string | null };
type PullRequestDetail = { repositoryPath: string; number: number; title: string; body: string; state: string; draft: boolean; updatedAt: string | null; head: string; base: string; url: string | null; requestedReviewers: Array<{ login: string; avatarUrl: string | null }>; requestedTeams: Array<{ slug: string; name: string }>; sections: Record<PullRequestSection, { items: PullRequestEntry[]; hasMore: boolean; page: number }> };
type ActivityEvent = { id: string; kind: string; actor: string; title: string; summary: string; branch: string; branches: string[]; createdAt: string; url: string | null; avatarUrl: string | null; number: number | null };
type Branch = { name: string; fullName: string; upstream: string | null; current: boolean; remote: boolean; shortId: string; date: string; author: string; subject: string };
type OperationRecord = { id: string; label: string; ok: boolean; at: string; detail: string };
const HISTORY_PAGE_SIZE = 30;

const pages: Array<{ label: View; icon: typeof Home }> = [
  { label: 'Home', icon: Home }, { label: 'Changes', icon: FileCode2 }, { label: 'Branches', icon: GitBranch }, { label: 'Compare', icon: GitCompareArrows }, { label: 'Pull requests', icon: GitCompareArrows }, { label: 'Activity', icon: Activity }
];

function relativeTime(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60000));
  if (minutes < 1) return 'just now'; if (minutes < 60) return `${minutes} min ago`; if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`; return `${Math.floor(minutes / 1440)} days ago`;
}

function parseHunks(patch: string): DiffHunk[] {
  const lines = patch.split(/\r?\n/);
  const starts = lines.reduce<number[]>((indexes, line, index) => { if (line.startsWith('@@ ')) indexes.push(index); return indexes; }, []);
  return starts.map((start, index) => ({ index, header: lines[start], body: lines.slice(start + 1, starts[index + 1] ?? lines.length).join('\n').replace(/\n+$/, '') }));
}

export default function GitwiseApp() {
  const [view, setView] = useState<View>('Home');
  const [saved, setSaved] = useState<string[]>([]);
  const [repoPath, setRepoPath] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Commit[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historySearchDraft, setHistorySearchDraft] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequest = useRef(0);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null);
  const [commitDetailsLoading, setCommitDetailsLoading] = useState(false);
  const [commitFileDiff, setCommitFileDiff] = useState<CommitFileDiff | null>(null);
  const commitRequest = useRef(0);
  const commitFileRequest = useRef(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [stashError, setStashError] = useState('');
  const [github, setGitHub] = useState<GitHubConnection | null>(null);
  const [githubToken, setGitHubToken] = useState('');
  const [githubBusy, setGitHubBusy] = useState(false);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false);
  const [pullRequestsError, setPullRequestsError] = useState('');
  const [pullRequestsCheckedAt, setPullRequestsCheckedAt] = useState<string | null>(null);
  const [pullRequestsState, setPullRequestsState] = useState<'open' | 'closed' | 'all'>('open');
  const [pullRequestsPage, setPullRequestsPage] = useState(1);
  const [pullRequestsHasMore, setPullRequestsHasMore] = useState(false);
  const pullRequestsRequest = useRef(0);
  const [selectedPullRequest, setSelectedPullRequest] = useState<PullRequest | null>(null);
  const [pullRequestChecks, setPullRequestChecks] = useState<PullRequestCheck[]>([]);
  const [pullRequestChecksLoading, setPullRequestChecksLoading] = useState(false);
  const [pullRequestChecksError, setPullRequestChecksError] = useState('');
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activityPage, setActivityPage] = useState(0);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityCheckedAt, setActivityCheckedAt] = useState<string | null>(null);
  const [activityHistoryLimited, setActivityHistoryLimited] = useState(false);
  const activityRequest = useRef(0);
  const [pullRequestDetail, setPullRequestDetail] = useState<PullRequestDetail | null>(null);
  const [pullRequestDetailLoading, setPullRequestDetailLoading] = useState(false);
  const [pullRequestDetailError, setPullRequestDetailError] = useState('');
  const [pullRequestSectionLoading, setPullRequestSectionLoading] = useState<PullRequestSection | null>(null);
  const pullRequestDetailRequest = useRef(0);
  const pullRequestChecksRequest = useRef(0);
  const [notice, setNotice] = useState('Demo mode · open a local repository to refresh live status');
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileState | null>(null);
  const [diff, setDiff] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [branchDraft, setBranchDraft] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [compareBase, setCompareBase] = useState('');
  const [compareHead, setCompareHead] = useState('');
  const [compareDiff, setCompareDiff] = useState('');
  const [compareSummary, setCompareSummary] = useState<{ files: number; additions: number; deletions: number } | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string; confirmLabel: string; action: () => void } | null>(null);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);

  const connected = Boolean(snapshot?.ok && repoPath);
  const repoName = snapshot?.name || 'No repository selected';
  const currentBranch = snapshot?.branch || (snapshot?.detached ? 'Detached HEAD' : 'No branch');
  const files = snapshot?.files || [];
  const staged = files.filter((file) => file.index !== ' ' && file.index !== '?');
  const unstaged = files.filter((file) => file.worktree !== ' ' && file.worktree !== '?' && file.kind !== 'untracked');
  const untracked = files.filter((file) => file.kind === 'untracked');
  const localBranches = branches.filter((branch) => !branch.remote);

  const refresh = async (path = repoPath) => {
    if (!path) { historyRequest.current += 1; activityRequest.current += 1; pullRequestsRequest.current += 1; setPullRequestsPage(0); setPullRequestsHasMore(false); setPullRequestsLoading(false); setSnapshot(null); setHistory([]); setHistoryHasMore(false); setHistoryError(''); setBranches([]); setStashes([]); setStashError(''); setGitHub(null); setPullRequests([]); setPullRequestsError(''); setPullRequestsCheckedAt(null); setActivityEvents([]); setActivityPage(0); setActivityHasMore(false); setActivityError(''); setActivityCheckedAt(null); setNotice('Demo mode · open a local repository to refresh live status'); return; }
    const nextHistorySearch = path === repoPath ? historySearch : '';
    if (path !== repoPath) { setHistorySearch(''); setHistorySearchDraft(''); setSelectedCommit(null); setCommitDetails(null); setCommitDetailsLoading(false); setCommitFileDiff(null); setSelectedPullRequest(null); setPullRequestChecks([]); setPullRequestChecksError(''); setPullRequestDetail(null); setPullRequestDetailError(''); setActivityEvents([]); setActivityPage(0); setActivityHasMore(false); setActivityError(''); setActivityCheckedAt(null); activityRequest.current += 1; pullRequestsRequest.current += 1; setPullRequests([]); setPullRequestsPage(0); setPullRequestsHasMore(false); setPullRequestsLoading(false); pullRequestDetailRequest.current += 1; commitRequest.current += 1; commitFileRequest.current += 1; }
    setBusy('Refreshing repository');
    setHistoryLoading(false);
    const requestId = ++historyRequest.current;
    const [repoResult, historyResult, branchesResult, operationResult, stashResult, githubResult] = await Promise.all([
      window.branchline?.inspectRepository(path) as Promise<Snapshot>,
      window.branchline?.getHistory(path, HISTORY_PAGE_SIZE, 0, nextHistorySearch) as Promise<{ ok: boolean; commits?: Commit[]; error?: string; hasMore?: boolean }>,
      window.branchline?.getBranches(path) as Promise<{ ok: boolean; branches?: Branch[]; error?: string }>,
      window.branchline?.getOperations(path) as Promise<OperationRecord[]>,
      window.branchline?.getStashes(path) as Promise<{ ok: boolean; stashes?: Stash[]; error?: string }>,
      window.branchline?.getGitHubStatus(path) as Promise<GitHubConnection>
    ]);
    setBusy(null);
    if (!repoResult?.ok) { setSnapshot(null); setNotice(repoResult?.error || 'Unable to inspect this repository.'); return; }
    const resolved = repoResult.repositoryPath || path;
    setRepoPath(resolved); setSnapshot(repoResult); setBranches(branchesResult?.branches || []); setOperations(operationResult || []); setStashes(stashResult?.stashes || []); setStashError(stashResult?.ok ? '' : stashResult?.error || 'Unable to load saved stashes.'); setGitHub(githubResult || null);
    if (requestId === historyRequest.current) { setHistory(historyResult?.commits || []); setHistoryHasMore(Boolean(historyResult?.hasMore)); setHistoryError(historyResult?.ok ? '' : historyResult?.error || 'Unable to load local history.'); }
    setNotice(`Local status · ${repoResult.name || 'repository'} checked ${relativeTime(repoResult.checkedAt || new Date().toISOString())}`);
  };

  useEffect(() => { void (async () => setSaved(await window.branchline?.listRepositories() || []))(); }, []);

  const chooseRepository = async () => {
    const chosen = await window.branchline?.chooseRepository();
    if (!chosen) return;
    const savedResult = await window.branchline?.saveRepository(chosen);
    if (!savedResult?.ok) { setNotice(savedResult?.error || 'Unable to save this repository.'); return; }
    setSaved(savedResult.repositories); await refresh(chosen);
  };

  const operate = async (operation: unknown, label: string) => {
    if (!repoPath) { setNotice('Open a local repository before using Git actions.'); return false; }
    setBusy(label); setNotice(`${label}…`);
    const result = await window.branchline?.operateGit(repoPath, operation);
    setBusy(null);
    if (!result?.ok) { const message = result?.stderr || `${label} failed.`; await refresh(repoPath); setNotice(message); return false; }
    setNotice(`${label} completed.`); await refresh(repoPath);
    return true;
  };

  const openFile = async (file: FileState) => {
    setSelectedFile(file); setDiff('Loading diff…');
    const result = await window.branchline?.getDiff(repoPath, { path: file.path, staged: file.index !== ' ' && file.index !== '?' }) as { ok: boolean; patch?: string; error?: string };
    setDiff(result?.ok ? result.patch || 'No textual diff is available for this file.' : result?.error || 'Unable to load this diff.');
  };

  const applyHunk = async (hunkIndex: number, staged: boolean) => {
    if (!selectedFile) return;
    const file = selectedFile;
    const label = staged ? 'Unstage hunk' : 'Stage hunk';
    if (await operate({ type: 'apply-hunk', path: file.path, staged, hunkIndex }, label)) await openFile(file);
  };

  const previewMerge = async (source: string) => {
    setMergePreviewLoading(true); setMergePreview({ ok: true, source, target: currentBranch, commits: [], files: [] });
    try {
      const result = await window.branchline?.getMergePreview(repoPath, source) as MergePreview | undefined;
      setMergePreview(result || { ok: false, error: 'Unable to prepare this merge preview.' });
    } catch (error) { setMergePreview({ ok: false, error: error instanceof Error ? error.message : 'Unable to prepare this merge preview.' }); }
    finally { setMergePreviewLoading(false); }
  };

  const executePreviewedMerge = async () => {
    if (!mergePreview?.ok || !mergePreview.source) return;
    const source = mergePreview.source;
    if (await operate({ type: 'merge', source }, `Merge ${source}`)) setMergePreview(null);
  };

  const connectGitHub = async () => {
    const token = githubToken.trim();
    if (!token) return;
    setGitHubBusy(true);
    let result: { ok: boolean; error?: string } | undefined;
    try { result = await window.branchline?.connectGitHub(token) as { ok: boolean; error?: string } | undefined; }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'GitHub could not be connected.' }; }
    finally { setGitHubBusy(false); }
    if (!result?.ok) { setGitHub((current) => ({ ok: true, connected: false, account: current?.account || null, remote: current?.remote || null, error: result?.error || 'GitHub could not be connected.' })); return; }
    setGitHubToken(''); await refresh(repoPath);
  };

  const disconnectGitHub = async () => {
    setGitHubBusy(true);
    try { await window.branchline?.disconnectGitHub(); }
    finally { setGitHubBusy(false); }
    await refresh(repoPath);
  };

  const loadPullRequests = async (state = pullRequestsState, page = 1, append = false) => {
    if (!repoPath || !github?.connected || !github.remote) return;
    const requestId = ++pullRequestsRequest.current;
    setPullRequestsLoading(true); setPullRequestsError('');
    if (!append) { setPullRequests([]); setPullRequestsPage(0); setPullRequestsHasMore(false); }
    try {
      const result = await window.branchline?.getGitHubPullRequests(repoPath, state, page) as { ok: boolean; pullRequests?: PullRequest[]; hasMore?: boolean; error?: string; checkedAt?: string } | undefined;
      if (requestId !== pullRequestsRequest.current) return;
      if (!result?.ok) { setPullRequestsError(result?.error || 'Unable to load pull requests.'); return; }
      setPullRequests((current) => {
        const combined = append ? [...current, ...(result.pullRequests || [])] : (result.pullRequests || []);
        return [...new Map(combined.map((pull) => [pull.number, pull])).values()];
      });
      setPullRequestsPage(page); setPullRequestsHasMore(Boolean(result.hasMore)); setPullRequestsCheckedAt(result.checkedAt || new Date().toISOString());
    } catch (error) { if (requestId === pullRequestsRequest.current) setPullRequestsError(error instanceof Error ? error.message : 'Unable to load pull requests.'); }
    finally { if (requestId === pullRequestsRequest.current) setPullRequestsLoading(false); }
  };
  const changePullRequestsState = (state: 'open' | 'closed' | 'all') => {
    if (state === pullRequestsState) return;
    setPullRequestsState(state);
    void loadPullRequests(state, 1, false);
  };

  const loadPullRequestChecks = async (pullNumber: number) => {
    const requestId = ++pullRequestChecksRequest.current;
    if (!repoPath) return;
    setPullRequestChecksLoading(true); setPullRequestChecksError(''); setPullRequestChecks([]);
    try {
      const result = await window.branchline?.getGitHubPullRequestChecks(repoPath, pullNumber) as { ok: boolean; checks?: PullRequestCheck[]; error?: string } | undefined;
      if (requestId !== pullRequestChecksRequest.current) return;
      if (!result?.ok) { setPullRequestChecksError(result?.error || 'Unable to load checks.'); return; }
      setPullRequestChecks(result.checks || []);
    } catch (error) { if (requestId === pullRequestChecksRequest.current) setPullRequestChecksError(error instanceof Error ? error.message : 'Unable to load checks.'); }
    finally { if (requestId === pullRequestChecksRequest.current) setPullRequestChecksLoading(false); }
  };

  const loadPullRequestDetail = async (pullNumber: number) => {
    const requestId = ++pullRequestDetailRequest.current;
    setPullRequestDetail(null); setPullRequestDetailError(''); setPullRequestDetailLoading(true);
    try {
      const result = await window.branchline?.getGitHubPullRequestDetails(repoPath, pullNumber) as { ok: boolean; pullRequest?: PullRequestDetail; error?: string } | undefined;
      if (requestId !== pullRequestDetailRequest.current) return;
      if (!result?.ok || !result.pullRequest) { setPullRequestDetailError(result?.error || 'Unable to load pull request details.'); return; }
      setPullRequestDetail(result.pullRequest);
    } catch (error) { if (requestId === pullRequestDetailRequest.current) setPullRequestDetailError(error instanceof Error ? error.message : 'Unable to load pull request details.'); }
    finally { if (requestId === pullRequestDetailRequest.current) setPullRequestDetailLoading(false); }
  };

  const loadMorePullRequestSection = async (section: PullRequestSection) => {
    if (!selectedPullRequest || !pullRequestDetail) return;
    const requestId = pullRequestDetailRequest.current;
    const number = selectedPullRequest.number; const nextPage = pullRequestDetail.sections[section].page + 1;
    setPullRequestSectionLoading(section);
    try {
      const result = await window.branchline?.getGitHubPullRequestSection(repoPath, number, section, nextPage) as { ok: boolean; items?: PullRequestEntry[]; hasMore?: boolean; error?: string } | undefined;
      if (requestId !== pullRequestDetailRequest.current || selectedPullRequest?.number !== number) return;
      if (!result?.ok) { setPullRequestDetailError(result?.error || `Unable to load more ${section}.`); return; }
      setPullRequestDetail((current) => current?.number === number ? { ...current, sections: { ...current.sections, [section]: { items: [...current.sections[section].items, ...(result.items || [])], hasMore: Boolean(result.hasMore), page: nextPage } } } : current);
    } catch (error) { setPullRequestDetailError(error instanceof Error ? error.message : `Unable to load more ${section}.`); }
    finally { setPullRequestSectionLoading(null); }
  };

  const handlePullRequestCommentPosted = (number: number, comment: PullRequestEntry) => {
    setPullRequestDetail((current) => {
      if (current?.number !== number) return current;
      const discussion = current.sections.comments;
      return { ...current, sections: { ...current.sections, comments: { ...discussion, items: [comment, ...discussion.items.filter((item) => item.id !== comment.id)].slice(0, 30) } } };
    });
    setPullRequests((current) => current.map((pull) => pull.number === number ? { ...pull, comments: pull.comments + 1 } : pull));
    setSelectedPullRequest((current) => current?.number === number ? { ...current, comments: current.comments + 1 } : current);
  };

  const handlePullRequestReviewPosted = (number: number, review: PullRequestEntry) => {
    setPullRequestDetail((current) => {
      if (current?.number !== number) return current;
      const reviews = current.sections.reviews;
      return { ...current, sections: { ...current.sections, reviews: { ...reviews, items: [review, ...reviews.items.filter((item) => item.id !== review.id)].slice(0, 30) } } };
    });
  };

  const loadActivity = async (page = 1) => {
    if (!repoPath || !github?.connected || !github.remote) return;
    const requestId = ++activityRequest.current;
    setActivityLoading(true); setActivityError(''); if (page === 1) setActivityHasMore(false);
    try {
      const result = await window.branchline?.getGitHubActivity(repoPath, page) as { ok: boolean; events?: ActivityEvent[]; error?: string; hasMore?: boolean; checkedAt?: string; historyLimited?: boolean } | undefined;
      if (requestId !== activityRequest.current) return;
      if (!result?.ok) { if (page === 1) setActivityEvents([]); setActivityError(result?.error || 'Unable to load repository activity.'); return; }
      setActivityEvents((current) => page === 1 ? (result.events || []) : [...current, ...(result.events || []).filter((item) => !current.some((existing) => existing.id === item.id))]);
      setActivityPage(page); setActivityHasMore(Boolean(result.hasMore)); setActivityCheckedAt(result.checkedAt || new Date().toISOString()); setActivityHistoryLimited(Boolean(result.historyLimited));
    } catch (error) { if (requestId === activityRequest.current) setActivityError(error instanceof Error ? error.message : 'Unable to load repository activity.'); }
    finally { if (requestId === activityRequest.current) setActivityLoading(false); }
  };

  useEffect(() => { if (view === 'Pull requests') void loadPullRequests(); }, [view, repoPath, github?.connected, github?.remote?.url]);
  useEffect(() => { if (view === 'Activity' && github?.connected && github.remote) void loadActivity(1); }, [view, repoPath, github?.connected, github?.remote?.url]);
  useEffect(() => { if (selectedPullRequest) void loadPullRequestChecks(selectedPullRequest.number); }, [selectedPullRequest?.number]);
  useEffect(() => { if (selectedPullRequest) void loadPullRequestDetail(selectedPullRequest.number); else { pullRequestDetailRequest.current += 1; setPullRequestDetail(null); } }, [selectedPullRequest?.number, repoPath]);

  const loadComparison = async () => {
    if (!compareBase || !compareHead) return setNotice('Choose both a base and comparison branch.');
    setCompareDiff('Loading comparison…');
    setCompareSummary(null);
    const result = await window.branchline?.getDiff(repoPath, { base: compareBase, compare: compareHead }) as { ok: boolean; patch?: string; error?: string };
    if (!result?.ok) { setCompareDiff(result?.error || 'Unable to compare branches.'); return; }
    const patch = result.patch || '';
    setCompareDiff(patch || 'These branches have no textual differences.');
    setCompareSummary({ files: (patch.match(/^diff --git /gm) || []).length, additions: (patch.match(/^\+(?!\+\+)/gm) || []).length, deletions: (patch.match(/^-(?!---)/gm) || []).length });
  };

  const openCommit = async (commit: Commit) => {
    setSelectedCommit(commit); setCommitDetails(null); setCommitDetailsLoading(true); setCommitFileDiff(null);
    const requestId = ++commitRequest.current;
    commitFileRequest.current += 1;
    let result: CommitDetails | undefined;
    try { result = await window.branchline?.getCommitDetails(repoPath, commit.id) as CommitDetails | undefined; }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'Unable to load this commit.' }; }
    if (requestId !== commitRequest.current) return;
    setCommitDetails(result || { ok: false, error: 'Unable to load this commit.' });
    setCommitDetailsLoading(false);
  };

  const openCommitFile = async (file: CommitFile) => {
    if (!selectedCommit) return;
    const target = selectedCommit;
    const requestId = ++commitFileRequest.current;
    setCommitFileDiff({ commitId: target.id, path: file.path, patch: 'Loading file changes…' });
    let result: { ok: boolean; patch?: string; error?: string } | undefined;
    try { result = await window.branchline?.getCommitDiff(repoPath, target.id, file.path) as { ok: boolean; patch?: string; error?: string } | undefined; }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'Unable to load this file diff.' }; }
    if (requestId !== commitFileRequest.current) return;
    setCommitFileDiff({ commitId: target.id, path: file.path, patch: result?.patch || '', error: result?.ok ? undefined : result?.error || 'Unable to load this file diff.' });
  };

  const searchHistory = async (query: string) => {
    const normalized = query.trim();
    setHistorySearch(normalized); setHistoryLoading(true); setHistoryError(''); setSelectedCommit(null); setCommitDetails(null); setCommitFileDiff(null); setCommitDetailsLoading(false); commitRequest.current += 1; commitFileRequest.current += 1;
    const requestId = ++historyRequest.current;
    try {
      const result = await window.branchline?.getHistory(repoPath, HISTORY_PAGE_SIZE, 0, normalized) as { ok: boolean; commits?: Commit[]; hasMore?: boolean; error?: string } | undefined;
      if (requestId !== historyRequest.current) return;
      if (!result?.ok) { setHistory([]); setHistoryHasMore(false); setHistoryError(result?.error || 'Unable to search local history.'); }
      else { setHistory(result.commits || []); setHistoryHasMore(Boolean(result.hasMore)); }
    } catch (error) { if (requestId === historyRequest.current) { setHistory([]); setHistoryHasMore(false); setHistoryError(error instanceof Error ? error.message : 'Unable to search local history.'); } }
    finally { if (requestId === historyRequest.current) setHistoryLoading(false); }
  };

  const loadMoreHistory = async () => {
    if (!repoPath || !historyHasMore || historyLoading) return;
    setHistoryLoading(true); setHistoryError('');
    const requestId = ++historyRequest.current;
    const offset = history.length;
    try {
      const result = await window.branchline?.getHistory(repoPath, HISTORY_PAGE_SIZE, offset, historySearch) as { ok: boolean; commits?: Commit[]; hasMore?: boolean; error?: string } | undefined;
      if (requestId !== historyRequest.current) return;
      if (!result?.ok) setHistoryError(result?.error || 'Unable to load more history.');
      else {
        const seen = new Set(history.map((commit) => commit.id));
        setHistory((current) => [...current, ...(result.commits || []).filter((commit) => !seen.has(commit.id))]);
        setHistoryHasMore(Boolean(result.hasMore));
      }
    } catch (error) { if (requestId === historyRequest.current) setHistoryError(error instanceof Error ? error.message : 'Unable to load more history.'); }
    finally { if (requestId === historyRequest.current) setHistoryLoading(false); }
  };

  const statusText = busy ? `${busy}…` : notice;
  const confirm = (title: string, detail: string, confirmLabel: string, action: () => void) => setConfirmation({ title, detail, confirmLabel, action });
  const branchOptions = useMemo(() => localBranches.map((branch) => branch.name), [localBranches]);

  return <div className="app gitwise-app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><GitBranch size={18} /></div><span>Gitwise</span><span className="beta">LOCAL GIT</span></div>
      <button className="repo-switcher" onClick={chooseRepository}><div className="repo-avatar"><Code2 size={16} /></div><div className="repo-copy"><strong>{repoName}</strong><span>{connected ? repoPath : 'Choose a local repository'}</span></div><ChevronDown size={16} /></button>
      <div className="sidebar-label">Workspace</div>
      <nav className="nav-list">{pages.map(({ label, icon: Icon }) => <button key={label} className={view === label ? 'nav-item active' : 'nav-item'} onClick={() => setView(label)}><Icon size={18} /><span>{label}</span>{label === 'Changes' && connected && <span className="nav-count">{files.length}</span>}</button>)}</nav>
      <div className="sidebar-section"><div className="sidebar-label row-label"><span>Saved repositories</span><button className="icon-button tiny" onClick={chooseRepository} title="Add repository"><Plus size={14} /></button></div>{saved.length === 0 && <div className="saved-empty">Open a repository to save it here.</div>}{saved.map((item) => <div className={item === repoPath ? 'saved-repo-row selected' : 'saved-repo-row'} key={item}><button className="saved-repo" onClick={() => void refresh(item)}><span className="status-dot green" /><span>{item.split(/[\\/]/).filter(Boolean).pop()}</span></button><button className="saved-remove" onClick={async () => setSaved(await window.branchline?.removeRepository(item) || [])} title="Remove saved repository"><X size={12} /></button></div>)}</div>
    </aside>
    <main className="main">
      <header className="workspace-header"><div><span className="eyebrow">Repository</span><div className="header-repo"><span>{repoName}</span><span className="slash">/</span><span className="branch-readout"><GitBranch size={14} />{currentBranch}</span></div></div><div className="header-actions"><button className="ghost-button" disabled={!connected || Boolean(busy)} onClick={() => void operate({ type: 'fetch' }, 'Fetch')}><RefreshCw size={16} />Fetch</button><button className="ghost-button" disabled={!connected || !snapshot?.upstream || Boolean(busy)} onClick={() => void operate({ type: 'pull', strategy: 'ff-only' }, 'Pull')}><ArrowDown size={16} />Pull</button><button className="primary-button" disabled={!connected || !snapshot?.branch || Boolean(busy)} onClick={() => void operate({ type: snapshot?.upstream ? 'push' : 'push', setUpstream: !snapshot?.upstream }, snapshot?.upstream ? 'Push' : 'Publish branch')}><ArrowUp size={16} />{snapshot?.upstream ? 'Push' : 'Publish'}{snapshot?.counts?.ahead ? <span className="button-count">{snapshot.counts.ahead}</span> : null}</button></div></header>
      <div className="content-scroll"><div className={connected ? 'notice' : 'notice demo'}><div className="notice-icon"><CheckCircle2 size={15} /></div><span>{statusText}</span></div>
        {snapshot?.operation && <div className="notice operation-notice"><div className="notice-icon"><GitBranch size={15} /></div><span>An unfinished {snapshot.operation} needs attention before other Git actions can continue.</span>{snapshot.operation === 'merge' && <><button className="ghost-button compact" onClick={() => void operate({ type: 'merge-continue' }, 'Continue merge')}>Continue merge</button><button className="danger-outline compact" onClick={() => confirm('Abort current merge?', 'Gitwise will stop this local merge and restore the repository to its pre-merge state. No remote branch will change.', 'Abort merge', () => void operate({ type: 'merge-abort' }, 'Abort merge'))}>Abort merge</button></>}</div>}
        {snapshot?.operation && snapshot.operation !== 'merge' && <div className="notice operation-notice"><div className="notice-icon"><GitBranch size={15} /></div><span>Continue or abort the active {snapshot.operation} after resolving any conflicts.</span><button className="ghost-button compact" onClick={() => void operate({ type: 'continue-operation' }, `Continue ${snapshot.operation}`)}>Continue</button><button className="danger-outline compact" onClick={() => confirm(`Abort ${snapshot.operation}?`, 'Gitwise will restore the repository to the state before this operation began.', 'Abort operation', () => void operate({ type: 'abort-operation' }, `Abort ${snapshot.operation}`))}>Abort</button></div>}
        {view === 'Home' && (connected ? <HomeView snapshot={snapshot} history={history} setView={setView} openCommit={openCommit} selectedCommit={selectedCommit} commitDetails={commitDetails} commitDetailsLoading={commitDetailsLoading} commitFileDiff={commitFileDiff} openCommitFile={openCommitFile} closeCommit={() => { setSelectedCommit(null); setCommitDetails(null); setCommitFileDiff(null); setCommitDetailsLoading(false); commitRequest.current += 1; commitFileRequest.current += 1; }} searchDraft={historySearchDraft} setSearchDraft={setHistorySearchDraft} search={searchHistory} query={historySearch} historyHasMore={historyHasMore} historyLoading={historyLoading} historyError={historyError} loadMore={loadMoreHistory} /> : <Empty onOpen={chooseRepository} />)}
        {view === 'Changes' && <ChangesSafe connected={connected} onOpen={chooseRepository} confirm={confirm} staged={staged} unstaged={unstaged} untracked={untracked} stashes={stashes} stashError={stashError} identity={snapshot?.identity} selected={selectedFile} diff={diff} commitMessage={commitMessage} setCommitMessage={setCommitMessage} openFile={openFile} applyHunk={applyHunk} operate={operate} />}
        {view === 'Branches' && <Branches connected={connected} onOpen={chooseRepository} confirm={confirm} previewMerge={previewMerge} branches={branches} draft={branchDraft} setDraft={setBranchDraft} selected={selectedBranch} setSelected={setSelectedBranch} operate={operate} />}
        {view === 'Compare' && <Compare connected={connected} onOpen={chooseRepository} confirm={confirm} previewMerge={previewMerge} branches={branchOptions} base={compareBase} head={compareHead} setBase={setCompareBase} setHead={setCompareHead} diff={compareDiff} summary={compareSummary} load={loadComparison} operate={operate} />}
{view === 'Pull requests' && <PullRequestsView repoPath={repoPath} currentBranch={snapshot?.branch || ''} connected={connected} onOpen={chooseRepository} github={github} token={githubToken} setToken={setGitHubToken} busy={githubBusy} connect={connectGitHub} disconnect={disconnectGitHub} pullRequests={pullRequests} loading={pullRequestsLoading} listState={pullRequestsState} changeListState={changePullRequestsState} hasMore={pullRequestsHasMore} loadMore={() => void loadPullRequests(pullRequestsState, pullRequestsPage + 1, true)} error={pullRequestsError} checkedAt={pullRequestsCheckedAt} refresh={loadPullRequests} onCommentPosted={handlePullRequestCommentPosted} onReviewPosted={handlePullRequestReviewPosted} selected={selectedPullRequest} setSelected={setSelectedPullRequest} checks={pullRequestChecks} checksLoading={pullRequestChecksLoading} checksError={pullRequestChecksError} refreshChecks={loadPullRequestChecks} detail={pullRequestDetail} detailLoading={pullRequestDetailLoading} detailError={pullRequestDetailError} loadMoreSection={loadMorePullRequestSection} sectionLoading={pullRequestSectionLoading} />}
        {view === 'Activity' && <ActivityView connected={connected} onOpen={chooseRepository} github={github} token={githubToken} setToken={setGitHubToken} busy={githubBusy} connect={connectGitHub} disconnect={disconnectGitHub} events={activityEvents} loading={activityLoading} error={activityError} page={activityPage} hasMore={activityHasMore} checkedAt={activityCheckedAt} historyLimited={activityHistoryLimited} refresh={() => void loadActivity(1)} loadMore={() => void loadActivity(activityPage + 1)} />}
        {connected && operations.length > 0 && <Operations records={operations} />}
      </div>
      {confirmation && <ConfirmDialog title={confirmation.title} detail={confirmation.detail} confirmLabel={confirmation.confirmLabel} onCancel={() => setConfirmation(null)} onConfirm={() => { confirmation.action(); setConfirmation(null); }} />}
      {mergePreview && <MergePreviewDialog preview={mergePreview} loading={mergePreviewLoading} close={() => setMergePreview(null)} execute={executePreviewedMerge} />}
    </main>
  </div>;
}

function Empty({ onOpen }: { onOpen: () => void }) { return <div className="page empty-home"><div className="empty-hero"><div className="empty-mark"><FolderOpen size={28} /></div><span className="eyebrow">Get started</span><h1>Open a repository</h1><p>Choose an existing local Git repository to see its real branches, changes, commits, and sync status.</p><button className="primary-button" onClick={onOpen}><FolderOpen size={16} />Open local repository</button></div></div>; }
function HomeView({ snapshot, history, setView, openCommit, selectedCommit, commitDetails, commitDetailsLoading, commitFileDiff, openCommitFile, closeCommit, searchDraft, setSearchDraft, search, query, historyHasMore, historyLoading, historyError, loadMore }: { snapshot: Snapshot | null; history: Commit[]; setView: (view: View) => void; openCommit: (commit: Commit) => void; selectedCommit: Commit | null; commitDetails: CommitDetails | null; commitDetailsLoading: boolean; commitFileDiff: CommitFileDiff | null; openCommitFile: (file: CommitFile) => void; closeCommit: () => void; searchDraft: string; setSearchDraft: (query: string) => void; search: (query: string) => void; query: string; historyHasMore: boolean; historyLoading: boolean; historyError: string; loadMore: () => void }) {
  if (!snapshot) return <Empty onOpen={() => {}} />;
  const counts = snapshot.counts || { ahead: 0, behind: 0 };
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Live repository</span><h1>{snapshot.name}</h1><p>{snapshot.branch ? `On ${snapshot.branch}` : 'Detached HEAD'} · checked {relativeTime(snapshot.checkedAt || new Date().toISOString())}</p></div></div><div className="overview-grid"><Metric label="Local changes" value={`${snapshot.files?.length || 0} files`} meta={snapshot.files?.length ? 'Review before sharing' : 'Working tree clean'} action="Review changes" onClick={() => setView('Changes')} /><Metric label="Incoming commits" value={snapshot.upstream ? `${counts.behind}` : '—'} meta={snapshot.upstream ? `from ${snapshot.upstream}` : 'No upstream configured'} action="Explore branches" onClick={() => setView('Branches')} /><Metric label="Outgoing commits" value={snapshot.upstream ? `${counts.ahead}` : '—'} meta={snapshot.upstream ? 'ready to push' : 'Publish this branch to push'} action="Compare branches" onClick={() => setView('Compare')} /></div><div className={selectedCommit ? 'history-layout has-selection' : 'history-layout'}><section className="panel live-panel"><div className="panel-heading"><div><h2>Local history</h2><p>Search commit messages · select a commit to inspect its changes</p></div><button className="text-button" onClick={() => setView('Branches')}>Browse branches</button></div><form className="history-search" onSubmit={(event) => { event.preventDefault(); search(searchDraft); }}><Search size={16} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} aria-label="Search commit messages" placeholder="Search commit messages" maxLength={200} /><button className="ghost-button compact" type="submit" disabled={historyLoading}>Search</button>{(query || searchDraft) && <button className="text-button" type="button" onClick={() => { setSearchDraft(''); search(''); }}>Clear</button>}</form><div className="history-caption">{historyLoading ? 'Loading history…' : query ? `Matches for “${query}” · ${history.length} loaded` : `Most recent commits · ${history.length} loaded`}</div>{historyError && <div className="history-error" role="alert">{historyError}</div>}{history.length ? history.map((commit) => <button type="button" className={selectedCommit?.id === commit.id ? 'live-row commit-row selected' : 'live-row commit-row'} key={commit.id} onClick={() => void openCommit(commit)}><GitCommitHorizontal size={16} /><div><strong>{commit.subject}</strong><span>{commit.author} · {relativeTime(commit.date)} · {commit.shortId}</span></div>{commit.refs.slice(0, 2).map((ref) => <code key={ref}>{ref}</code>)}</button>) : <div className="saved-empty">{historyLoading ? 'Fetching commits…' : query ? 'No local commits match this message search.' : 'No commits are available in this repository yet.'}</div>}{historyHasMore && <div className="history-more"><button className="ghost-button" type="button" onClick={loadMore} disabled={historyLoading}>{historyLoading ? 'Loading…' : 'Load more commits'}</button></div>}</section>{selectedCommit && <CommitDetail commit={selectedCommit} details={commitDetails} loading={commitDetailsLoading} fileDiff={commitFileDiff} openFile={openCommitFile} close={closeCommit} />}</div></div>;
}

function CommitDetail({ commit, details, loading, fileDiff, openFile, close }: { commit: Commit; details: CommitDetails | null; loading: boolean; fileDiff: CommitFileDiff | null; openFile: (file: CommitFile) => void; close: () => void }) {
  const metadata = details?.commit;
  return <aside className="panel commit-detail-panel" aria-label="Commit details"><div className="panel-heading"><div><span className="eyebrow">Commit · {commit.shortId}</span><h2 title={commit.subject}>{commit.subject}</h2></div><button type="button" className="icon-button" onClick={close} aria-label="Close commit details"><X size={16} /></button></div>{loading ? <p className="commit-detail-state">Loading commit details…</p> : details?.ok && metadata ? <><div className="commit-metadata"><div><span>Author</span><strong>{metadata.author}</strong><small>{metadata.authorEmail}</small></div><div><span>Committer</span><strong>{metadata.committer}</strong><small>{metadata.committerEmail}</small></div><div><span>Committed</span><strong>{new Date(metadata.date).toLocaleString()}</strong></div><div><span>Commit</span><code>{metadata.id}</code></div><div><span>Parents</span><code>{metadata.parents.length ? metadata.parents.map((parent) => parent.slice(0, 12)).join(', ') : 'Initial commit'}</code></div></div>{metadata.message && <pre className="commit-message-full">{metadata.message}</pre>}<div className="commit-files"><div className="group-title"><span>Changed files</span><span className="muted">{details.files?.length || 0}</span></div>{details.files?.length ? details.files.map((file) => <button type="button" className={fileDiff?.commitId === metadata.id && fileDiff.path === file.path ? 'commit-file-row selected' : 'commit-file-row'} key={`${file.status}-${file.path}`} onClick={() => openFile(file)}><span className={`file-status status-${file.status[0].toLowerCase()}`}>{file.status}</span><span title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}>{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</span></button>) : <p className="commit-detail-state">No file changes recorded.</p>}</div>{fileDiff && fileDiff.commitId === metadata.id && <section className="commit-file-diff"><h3 title={fileDiff.path}>{fileDiff.path}</h3><pre className="real-diff">{fileDiff.error || fileDiff.patch || 'No text diff is available for this file.'}</pre></section>}</> : <p className="commit-detail-state error-text">{details?.error || 'Unable to load commit details.'}</p>}</aside>;
}
function Metric({ label, value, meta, action, onClick }: { label: string; value: string; meta: string; action: string; onClick: () => void }) { return <div className="status-card"><span className="card-label">{label}</span><strong>{value}</strong><span className="card-meta">{meta}</span><button className="card-action" onClick={onClick}>{action}<ArrowUp size={13} className="rotate-45" /></button></div>; }
function Changes({ connected, files, staged, unstaged, untracked, identity, selected, diff, commitMessage, setCommitMessage, openFile, operate }: { connected: boolean; files: FileState[]; staged: FileState[]; unstaged: FileState[]; untracked: FileState[]; identity?: { name: string | null; email: string | null }; selected: FileState | null; diff: string; commitMessage: string; setCommitMessage: (value: string) => void; openFile: (file: FileState) => void; operate: (operation: unknown, label: string) => Promise<void> }) { if (!connected) return <Empty onOpen={() => {}} />; const render = (title: string, collection: FileState[], action?: 'stage' | 'unstage') => <section className="change-group"><div className="group-title"><span>{title}</span><span className="muted">{collection.length}</span></div>{collection.map((file) => <div className={selected?.path === file.path ? 'change-row selected' : 'change-row'} key={`${title}-${file.path}`}><button className="file-open" onClick={() => void openFile(file)}><FileCode2 size={16} /><span>{file.path}</span></button>{action && <button className="ghost-button compact" onClick={() => void operate({ type: action, paths: [file.path] }, action === 'stage' ? 'Stage file' : 'Unstage file')}>{action === 'stage' ? 'Stage' : 'Unstage'}</button>}<button className="danger-link" onClick={() => { if (window.confirm(`Discard uncommitted changes in ${file.path}?`)) void operate({ type: 'discard', paths: [file.path] }, 'Discard changes'); }} title="Discard changes"><Trash2 size={15} /></button></div>)}</section>; return <div className="page"><div className="page-title"><div><span className="eyebrow">Working tree</span><h1>Changes</h1><p>Stage precisely what you want to commit. Discard is permanent.</p></div><button className="ghost-button" onClick={() => void operate({ type: 'stash' }, 'Stash changes')}><Layers3 size={16} />Stash</button></div><div className="changes-layout"><section className="panel change-panel">{render('Staged', staged, 'unstage')}{render('Unstaged', unstaged, 'stage')}{render('Untracked', untracked, 'stage')}{files.length === 0 && <div className="saved-empty">Your working tree is clean.</div>}<div className="commit-box"><span className="eyebrow">Commit</span><p>{staged.length ? `${staged.length} staged file${staged.length === 1 ? '' : 's'} will be committed as ${identity?.name ? `${identity.name}${identity.email ? ` <${identity.email}>` : ''}` : 'your configured Git identity'}.` : 'Stage one or more files to create a commit.'}</p><textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Describe this change" /><button className="primary-button" disabled={!staged.length || !commitMessage.trim()} onClick={() => { void operate({ type: 'commit', message: commitMessage }, 'Commit changes'); setCommitMessage(''); }}><GitCommitHorizontal size={16} />Commit staged changes</button></div></section><section className="panel diff-panel"><div className="panel-heading"><div><h2>{selected ? selected.path : 'Diff preview'}</h2><p>{selected ? 'Live Git diff' : 'Select a changed file'}</p></div></div><pre className="real-diff">{diff || 'Select a file to load its actual diff.'}</pre></section></div></div>; }
function ChangesSafe({ connected, onOpen, confirm, staged, unstaged, untracked, stashes, stashError, identity, selected, diff, commitMessage, setCommitMessage, openFile, applyHunk, operate }: { connected: boolean; onOpen: () => void; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; staged: FileState[]; unstaged: FileState[]; untracked: FileState[]; stashes: Stash[]; stashError: string; identity?: { name: string | null; email: string | null }; selected: FileState | null; diff: string; commitMessage: string; setCommitMessage: (value: string) => void; openFile: (file: FileState) => void; applyHunk: (hunkIndex: number, staged: boolean) => void; operate: (operation: unknown, label: string) => Promise<boolean> }) {
  if (!connected) return <Empty onOpen={onOpen} />;
  const renderFiles = (title: string, collection: FileState[], mode: 'staged' | 'unstaged' | 'untracked') => <section className="change-group"><div className="group-title"><span>{title}</span><span className="muted">{collection.length}</span></div>{collection.map((file) => <div className={selected?.path === file.path ? 'change-row selected' : 'change-row'} key={`${mode}-${file.path}`}><button className="file-open" onClick={() => void openFile({ ...file, index: mode === 'staged' ? file.index : ' ' })}><FileCode2 size={16} /><span>{file.path}</span></button>{mode === 'staged' && <button className="ghost-button compact" onClick={() => void operate({ type: 'unstage', paths: [file.path] }, 'Unstage file')}>Unstage</button>}{mode !== 'staged' && <button className="ghost-button compact" onClick={() => void operate({ type: 'stage', paths: [file.path] }, 'Stage file')}>Stage</button>}{mode === 'unstaged' && <button className="danger-link" onClick={() => confirm('Discard unstaged changes?', `${file.path} will be restored to its staged version. Any staged changes will remain.`, 'Discard changes', () => void operate({ type: 'discard', paths: [file.path] }, 'Discard unstaged changes'))} title="Discard unstaged changes"><Trash2 size={15} /></button>}{mode === 'untracked' && <button className="danger-link" onClick={() => confirm('Move untracked file to Recycle Bin?', `${file.path} is not tracked by Git and will be moved to the Windows Recycle Bin.`, 'Move to Recycle Bin', () => void operate({ type: 'trash-untracked', paths: [file.path] }, 'Move untracked file to Recycle Bin'))} title="Move to Recycle Bin"><Trash2 size={15} /></button>}</div>)}</section>;
  const commit = async () => { const committed = await operate({ type: 'commit', message: commitMessage }, 'Commit staged changes'); if (committed) setCommitMessage(''); };
  const hasChanges = staged.length + unstaged.length + untracked.length > 0;
  const selectedIsStaged = Boolean(selected && selected.index !== ' ' && selected.index !== '?');
  const hunks = selected ? parseHunks(diff) : [];
  return <div className="page"><div className="page-title"><div><span className="eyebrow">Working tree</span><h1>Changes</h1><p>Staged, unstaged, and untracked work are kept separate.</p></div><div className="heading-actions"><button className="ghost-button" disabled={!hasChanges} onClick={() => void operate({ type: 'stash' }, 'Stash changes')}><Layers3 size={16} />Stash all</button></div></div><div className="changes-layout"><section className="panel change-panel">{renderFiles('Staged', staged, 'staged')}{renderFiles('Unstaged', unstaged, 'unstaged')}{renderFiles('Untracked', untracked, 'untracked')}<div className="commit-box"><span className="eyebrow">Commit</span><p>{staged.length ? `${staged.length} staged file${staged.length === 1 ? '' : 's'} will be committed as ${identity?.name || 'your configured Git identity'}.` : 'Stage one or more files before committing.'}</p><textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Describe this change" /><button className="primary-button" disabled={!staged.length || !commitMessage.trim()} onClick={() => void commit()}><GitCommitHorizontal size={16} />Commit staged changes</button></div></section><section className="panel diff-panel"><div className="panel-heading"><div><h2>{selected ? selected.path : 'Diff preview'}</h2><p>{selected ? selectedIsStaged ? 'Staged diff · unstage individual hunks' : 'Unstaged diff · stage individual hunks' : 'Select a file'}</p></div></div>{selected && hunks.length > 0 ? <div className="hunk-list">{hunks.map((hunk) => <section className="diff-hunk" key={hunk.index}><div className="hunk-toolbar"><code>{hunk.header}</code><button className="ghost-button compact" onClick={() => applyHunk(hunk.index, selectedIsStaged)}>{selectedIsStaged ? 'Unstage hunk' : 'Stage hunk'}</button></div><pre className="real-diff">{hunk.body || 'No text changes in this hunk.'}</pre></section>)}</div> : <pre className="real-diff">{diff || 'Select a file to load its actual diff.'}</pre>}{selected && !hunks.length && diff && <p className="hunk-help">Individual hunk actions are available for text diffs. Binary files, untracked files, and diffs without hunks can still be staged as whole files.</p>}</section></div><StashShelf stashes={stashes} error={stashError} confirm={confirm} operate={operate} /></div>;
}

function StashShelf({ stashes, error, confirm, operate }: { stashes: Stash[]; error: string; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; operate: (operation: unknown, label: string) => Promise<boolean> }) {
  return <section className="panel stash-panel"><div className="panel-heading"><div><h2>Saved stashes</h2><p>Apply a stash to keep it saved, or restore it and remove that entry.</p></div><span className="muted">{stashes.length}</span></div>{error ? <p className="stash-empty error-text">{error}</p> : stashes.length === 0 ? <p className="stash-empty">No saved stashes in this repository.</p> : stashes.map((stash) => <div className="stash-row" key={stash.id}><div className="stash-info"><code>{stash.selector}</code><strong title={stash.subject}>{stash.subject}</strong><span>{stash.author} · {relativeTime(stash.date)}</span><small>{stash.id}</small></div><div className="stash-actions"><button className="ghost-button compact" onClick={() => confirm(`Apply ${stash.selector}?`, 'Git will restore these changes into the current working tree and keep the stash entry. Existing edits may cause conflicts.', 'Apply and keep stash', () => void operate({ type: 'stash-apply', stashId: stash.id }, 'Apply stash'))}>Apply</button><button className="danger-outline compact" onClick={() => confirm(`Restore and remove ${stash.selector}?`, 'Git will apply these changes to the working tree and remove this stash entry only if the restore succeeds. Review any existing local edits first.', 'Restore and remove', () => void operate({ type: 'stash-pop-selected', stashId: stash.id }, 'Restore stash'))}>Restore & remove</button></div></div>)}</section>;
}

function Branches({ connected, onOpen, confirm, previewMerge, branches, draft, setDraft, selected, setSelected, operate }: { connected: boolean; onOpen: () => void; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; previewMerge: (source: string) => void; branches: Branch[]; draft: string; setDraft: (value: string) => void; selected: Branch | null; setSelected: (value: Branch) => void; operate: (operation: unknown, label: string) => Promise<boolean> }) {
  const [query, setQuery] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [renameTo, setRenameTo] = useState('');
  if (!connected) return <Empty onOpen={onOpen} />;
  const local = branches.filter((branch) => !branch.remote);
  const remote = branches.filter((branch) => branch.remote);
  const matches = (branch: Branch) => `${branch.name} ${branch.subject}`.toLowerCase().includes(query.toLowerCase());
  const render = (title: string, collection: Branch[]) => <section className="branch-group"><div className="group-title"><span>{title}</span><span className="muted">{collection.filter(matches).length}</span></div>{collection.filter(matches).map((branch) => <button className={selected?.fullName === branch.fullName ? 'branch-list-row selected' : 'branch-list-row'} key={branch.fullName} onClick={() => { setSelected(branch); setRenameTo(branch.remote ? '' : branch.name); }}><GitBranch size={16} /><div className="branch-name"><strong>{branch.name}</strong><span>{branch.subject || 'No commits yet'}</span></div>{branch.current && <span className="status-tag green">Current</span>}<span className="latest-sha">{branch.shortId}</span></button>)}</section>;
  const create = async () => { if (await operate({ type: 'create-branch', name: draft.trim(), ...(startPoint ? { startPoint } : {}) }, 'Create branch')) { setDraft(''); setStartPoint(''); } };
  const remoteParts = selected?.remote ? selected.name.split('/') : [];
  const remoteName = remoteParts[0];
  const remoteBranch = remoteParts.slice(1).join('/');
  return <div className="page"><div className="page-title"><div><span className="eyebrow">Repository map</span><h1>Branches</h1><p>Local and remote branches are kept distinct. Every change explains its local or remote effect.</p></div></div><div className="branch-create"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="new branch name" /><select value={startPoint} onChange={(event) => setStartPoint(event.target.value)} aria-label="Starting point"><option value="">Current branch</option>{local.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select><button className="primary-button" disabled={!draft.trim()} onClick={() => void create()}><Plus size={16} />Create branch</button></div><div className="branch-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter branches" /></div><div className="branches-layout"><section className="panel branch-list-panel">{render('Local branches', local)}{render('Remote branches', remote)}</section><aside className="panel branch-detail">{selected ? <><span className="eyebrow">{selected.remote ? 'Remote branch' : 'Local branch'}</span><h2>{selected.name}</h2><p>{selected.remote ? `Remote reference on ${remoteName || 'unknown remote'}. Deleting it will push a deletion to that remote.` : selected.upstream ? `Tracks ${selected.upstream}` : 'No upstream configured. Publish it from the header to create one.'}</p>{!selected.remote && !selected.current && <button className="primary-button" onClick={() => void operate({ type: 'switch-branch', name: selected.name }, 'Switch branch')}>Switch here</button>}{!selected.remote && !selected.current && <button className="ghost-button" onClick={() => previewMerge(selected.name)}>Preview local merge</button>}{!selected.remote && <div className="rename-row"><input value={renameTo} onChange={(event) => setRenameTo(event.target.value)} aria-label="New branch name" /><button className="ghost-button compact" disabled={!renameTo.trim() || renameTo.trim() === selected.name} onClick={() => confirm(`Rename ${selected.name}?`, `Only the local branch will be renamed. Its remote branch, if any, is unchanged.`, 'Rename local branch', () => void operate({ type: 'rename-branch', oldName: selected.name, newName: renameTo.trim() }, 'Rename branch'))}>Rename</button></div>}{!selected.remote && !selected.current && <button className="danger-outline" onClick={() => confirm(`Delete local branch ${selected.name}?`, 'This removes only the local branch. Any matching remote branch will remain available.', 'Delete local branch', () => void operate({ type: 'delete-local-branch', name: selected.name }, 'Delete local branch'))}>Delete local branch</button>}{selected.remote && remoteName && remoteBranch && <button className="danger-outline" onClick={() => confirm(`Delete ${selected.name} from ${remoteName}?`, 'This will push a branch deletion to the remote. It does not delete a local branch with the same name.', 'Delete remote branch', () => void operate({ type: 'delete-remote-branch', remote: remoteName, name: remoteBranch }, 'Delete remote branch'))}>Delete remote branch</button>}</> : <div className="saved-empty">Select a branch to see its available actions.</div>}</aside></div></div>;
}
function Compare({ connected, onOpen, confirm, previewMerge, branches, base, head, setBase, setHead, diff, summary, load, operate }: { connected: boolean; onOpen: () => void; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; previewMerge: (source: string) => void; branches: string[]; base: string; head: string; setBase: (value: string) => void; setHead: (value: string) => void; diff: string; summary: { files: number; additions: number; deletions: number } | null; load: () => void; operate: (operation: unknown, label: string) => Promise<boolean> }) { if (!connected) return <Empty onOpen={onOpen} />; return <div className="page"><div className="page-title"><div><span className="eyebrow">Compare branches</span><h1>What would change?</h1><p>The comparison uses the shared merge base: changes introduced by the comparison branch since it diverged from base.</p></div></div><div className="compare-controls"><label>Base<select value={base} onChange={(event) => setBase(event.target.value)}><option value="">Choose base</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><label>Comparison<select value={head} onChange={(event) => setHead(event.target.value)}><option value="">Choose comparison</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><button className="primary-button" disabled={!base || !head || base === head} onClick={load}>Compare</button>{head && <button className="ghost-button" onClick={() => previewMerge(head)}>Preview merge into current</button>}</div>{summary && <div className="compare-summary"><span>{summary.files} changed file{summary.files === 1 ? '' : 's'}</span><span className="addition">+{summary.additions} additions</span><span className="deletion">−{summary.deletions} deletions</span></div>}<section className="panel diff-panel"><pre className="real-diff">{diff || 'Choose two branches to see their actual diff.'}</pre></section></div>; }
function PullRequestsView({ repoPath, currentBranch, connected, onOpen, github, token, setToken, busy, connect, disconnect, pullRequests, loading, error, checkedAt, refresh, listState, changeListState, hasMore, loadMore, selected, setSelected, checks, checksLoading, checksError, refreshChecks, detail, detailLoading, detailError, loadMoreSection, sectionLoading, onCommentPosted, onReviewPosted }: { repoPath: string; currentBranch: string; connected: boolean; onOpen: () => void; github: GitHubConnection | null; token: string; setToken: (value: string) => void; busy: boolean; connect: () => void; disconnect: () => void; pullRequests: PullRequest[]; loading: boolean; error: string; checkedAt: string | null; refresh: () => void; listState: 'open' | 'closed' | 'all'; changeListState: (state: 'open' | 'closed' | 'all') => void; hasMore: boolean; loadMore: () => void; selected: PullRequest | null; setSelected: (pull: PullRequest | null) => void; checks: PullRequestCheck[]; checksLoading: boolean; checksError: string; refreshChecks: (pullNumber: number) => void; detail: PullRequestDetail | null; detailLoading: boolean; detailError: string; loadMoreSection: (section: PullRequestSection) => void; sectionLoading: PullRequestSection | null; onCommentPosted: (number: number, comment: PullRequestEntry) => void; onReviewPosted: (number: number, review: PullRequestEntry) => void }) {
  if (!connected) return <Empty onOpen={onOpen} />;
  if (!github?.connected || !github.remote) return <GitHubConnectionView connected={connected} onOpen={onOpen} github={github} token={token} setToken={setToken} busy={busy} connect={connect} disconnect={disconnect} title="Pull requests" detail="Connect GitHub and use a repository with a github.com remote to load open pull requests." />;
  const [showCreatePullRequest, setShowCreatePullRequest] = useState(false);
  const checkState = (check: PullRequestCheck) => check.status !== 'completed' ? 'In progress' : check.conclusion === 'success' ? 'Passed' : check.conclusion === 'skipped' || check.conclusion === 'neutral' ? 'Neutral' : 'Failed';
  const [query, setQuery] = useState('');
  const [draftFilter, setDraftFilter] = useState<'all' | 'draft' | 'ready'>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredPullRequests = pullRequests.filter((pull) => {
    if (draftFilter === 'draft' && !pull.draft || draftFilter === 'ready' && pull.draft) return false;
    if (!normalizedQuery) return true;
    return [pull.title, `#${pull.number}`, pull.author, pull.head, pull.base].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
return <div className="page"><div className="page-title"><div><span className="eyebrow">GitHub collaboration</span><h1>Pull requests</h1><p>Work in {github.remote.owner}/{github.remote.name} · {checkedAt ? `checked ${relativeTime(checkedAt)}` : 'not loaded yet'}</p></div><div className="pull-request-page-actions"><button type="button" className="primary-button" onClick={() => setShowCreatePullRequest(true)}><Plus size={15} />New pull request</button><button className="ghost-button" disabled={loading} onClick={refresh}><RefreshCw size={16} />{loading ? 'Refreshing…' : 'Refresh'}</button></div></div><div className={selected ? 'pull-request-layout has-selection' : 'pull-request-layout'}><section className="panel pull-request-panel"><div className="panel-heading"><div><h2>{listState === 'open' ? 'Open pull requests' : listState === 'closed' ? 'Closed pull requests' : 'All pull requests'}</h2><p>Search loaded pull requests and switch between open, closed, and all.</p></div><span className="muted">{loading ? '…' : `${filteredPullRequests.length} shown · ${pullRequests.length} loaded`}</span></div><div className="pull-request-toolbar"><div className="pull-request-state-filter" role="group" aria-label="Pull request state">{([[ 'open', 'Open' ], [ 'closed', 'Closed' ], [ 'all', 'All' ]] as const).map(([state, label]) => <button key={state} type="button" className={listState === state ? 'selected' : ''} aria-pressed={listState === state} onClick={() => changeListState(state)}>{label}</button>)}</div><label className="pull-request-search"><Search size={15} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, branch, or number" aria-label="Search loaded pull requests" /></label><label className="pull-request-draft-filter">Draft<select value={draftFilter} onChange={(event) => setDraftFilter(event.target.value as 'all' | 'draft' | 'ready')}><option value="all">All</option><option value="draft">Drafts</option><option value="ready">Ready for review</option></select></label></div>{error ? <div className="history-error" role="alert">{error}</div> : loading ? <p className="pull-request-empty">Loading pull requests from GitHub…</p> : filteredPullRequests.length === 0 ? <p className="pull-request-empty">{pullRequests.length === 0 ? (listState === 'open' ? 'No open pull requests were returned by GitHub.' : 'No pull requests were returned for this selection.') : 'No loaded pull requests match these filters. Load more or adjust your search.'}</p> : filteredPullRequests.map((pull) => <button type="button" className={selected?.number === pull.number ? 'pull-request-row selected' : 'pull-request-row'} key={pull.number} onClick={() => setSelected(pull)} title="Inspect this pull request"><div className="pull-request-author">{pull.authorAvatarUrl ? <img src={pull.authorAvatarUrl} alt="" /> : <span>{pull.author.slice(0, 1).toUpperCase()}</span>}</div><div className="pull-request-copy"><div><strong title={pull.title}>#{pull.number} {pull.title}</strong>{pull.draft && <span className="status-tag">Draft</span>}</div><span>opened by {pull.author} · updated {relativeTime(pull.updatedAt || new Date().toISOString())}</span><code title={`${pull.head} → ${pull.base}`}>{pull.head} → {pull.base}</code></div><div className="pull-request-feedback"><span>{pull.comments + pull.reviewComments} comments</span><span>View details</span></div></button>)}{hasMore && <div className="pull-request-load-more"><button type="button" className="ghost-button" disabled={loading} onClick={loadMore}>{loading ? 'Loading…' : 'Load more pull requests'}</button><span>Showing {pullRequests.length} loaded from GitHub</span></div>}</section>{selected && <aside className="panel pull-request-detail"><div className="panel-heading"><div><span className="eyebrow">Pull request #{selected.number}</span><h2 title={selected.title}>{selected.title}</h2></div><button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Close pull request details"><X size={16} /></button></div><div className="pull-request-detail-actions"><button className="ghost-button compact" disabled={checksLoading} onClick={() => refreshChecks(selected.number)}><RefreshCw size={14} />Refresh checks</button><button className="ghost-button compact" onClick={() => void window.branchline?.openGitHubUrl(selected.url)}>Open on GitHub</button></div><PullRequestContent detail={detail} loading={detailLoading} error={detailError} loadMore={loadMoreSection} sectionLoading={sectionLoading} onCommentPosted={(comment) => detail && onCommentPosted(detail.number, comment)} /><section className="check-list"><div className="group-title"><span>Checks</span><span className="muted">{checksLoading ? '…' : checks.length}</span></div>{checksError ? <p className="check-empty error-text">{checksError}</p> : checksLoading ? <p className="check-empty">Loading current check runs…</p> : checks.length === 0 ? <p className="check-empty">GitHub returned no check runs for this pull request’s latest commit.</p> : checks.map((check) => <button type="button" className="check-row" key={check.id} onClick={() => check.url && window.branchline?.openGitHubUrl(check.url)} disabled={!check.url}><span className={checkState(check) === 'Passed' ? 'check-dot success' : checkState(check) === 'Failed' ? 'check-dot failed' : 'check-dot pending'} /><div><strong title={check.name}>{check.name}</strong><span>{check.app || 'GitHub check'} · {checkState(check)}{check.completedAt ? ` · ${relativeTime(check.completedAt)}` : ''}</span></div><span className={checkState(check) === 'Passed' ? 'status-tag green' : checkState(check) === 'Failed' ? 'status-tag danger' : 'status-tag'}>{checkState(check)}</span></button>)}</section><p className="check-help">Check runs and readiness are separate snapshots. Refresh readiness after changes; GitHub remains authoritative for all rules and merge permissions.</p></aside>}{showCreatePullRequest && <CreatePullRequestDialog repoPath={repoPath} currentBranch={currentBranch} onClose={() => setShowCreatePullRequest(false)} onCreated={() => { if (listState !== 'open') changeListState('open'); else refresh(); }} />}</div></div>;
}
function ActivityView({ connected, onOpen, github, token, setToken, busy, connect, disconnect, events, loading, error, page, hasMore, checkedAt, historyLimited, refresh, loadMore }: { connected: boolean; onOpen: () => void; github: GitHubConnection | null; token: string; setToken: (value: string) => void; busy: boolean; connect: () => void; disconnect: () => void; events: ActivityEvent[]; loading: boolean; error: string; page: number; hasMore: boolean; checkedAt: string | null; historyLimited: boolean; refresh: () => void; loadMore: () => void }) {
  const [contributor, setContributor] = useState('all');
  const [branch, setBranch] = useState('all');
  const [range, setRange] = useState('30');
  if (!connected) return <Empty onOpen={onOpen} />;
  if (!github?.connected || !github.remote) return <GitHubConnectionView connected={connected} onOpen={onOpen} github={github} token={token} setToken={setToken} busy={busy} connect={connect} disconnect={disconnect} title="Shared activity" detail="Connect GitHub and use a repository with a github.com remote to load shared activity." />;
  const contributors = [...new Set(events.map((event) => event.actor))].sort((a, b) => a.localeCompare(b));
  const branches = [...new Set(events.flatMap((event) => event.branches))].sort((a, b) => a.localeCompare(b));
  const visible = events.filter((event) => {
    if (contributor !== 'all' && event.actor !== contributor) return false;
    if (branch !== 'all' && !event.branches.includes(branch)) return false;
    if (range !== 'all' && Date.now() - new Date(event.createdAt).getTime() > Number(range) * 86400000) return false;
    return true;
  });
  return <div className="page"><div className="page-title"><div><span className="eyebrow">Remote collaboration</span><h1>Shared activity</h1><p>{github.remote.owner}/{github.remote.name} · {checkedAt ? `checked ${relativeTime(checkedAt)}` : 'not loaded yet'}</p></div><button className="ghost-button" onClick={refresh} disabled={loading}><RefreshCw size={16} />{loading ? 'Refreshing…' : 'Refresh'}</button></div><div className="activity-filter-bar"><label>Contributor<select value={contributor} onChange={(event) => setContributor(event.target.value)}><option value="all">All contributors</option>{contributors.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">All branches</option>{branches.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Date range<select value={range} onChange={(event) => setRange(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All available activity</option></select></label><span className="activity-result-count">{visible.length} shown · {events.length} loaded</span></div><section className="panel shared-activity-panel"><div className="panel-heading"><div><h2>Repository events</h2><p>Actions performed on GitHub; local and unpushed work is not visible here.</p></div><span className="muted">{loading ? '…' : events.length}</span></div>{error && <div className="history-error" role="alert">{error}</div>}{loading && events.length === 0 ? <p className="activity-empty">Loading activity from GitHub…</p> : !error && events.length === 0 ? <p className="activity-empty">No supported pushed commits or pull request events were returned.</p> : visible.length === 0 && !error ? <p className="activity-empty">No activity matches these filters. Try a wider date range or clear a filter.</p> : <div className="shared-activity-list">{visible.map((event) => <article className="shared-activity-row" key={event.id}><div className="activity-avatar">{event.avatarUrl ? <img src={event.avatarUrl} alt="" /> : <span>{event.actor.slice(0, 1).toUpperCase()}</span>}</div><div className="shared-activity-body"><div className="shared-activity-title"><strong>{event.title}</strong><span className="activity-kind">{event.kind}</span></div><p>{event.summary} <span>by {event.actor}</span></p>{event.branches.length > 0 && <div className="activity-branches">{event.branches.map((name) => <code key={name} title={name}>{name}</code>)}</div>}</div><time dateTime={event.createdAt}>{relativeTime(event.createdAt)}</time>{event.url && <button className="text-button activity-open" onClick={() => void window.branchline?.openGitHubUrl(event.url!)}>Open</button>}</article>)}</div>}{hasMore && <div className="activity-load-more"><button className="ghost-button" disabled={loading} onClick={loadMore}>{loading ? 'Loading…' : 'Load more activity'}</button></div>}</section><p className="activity-freshness">GitHub event data may arrive with delay and its event feed has limited recent history. {historyLimited ? `Showing ${events.length} events currently available from GitHub.` : `Page ${page} loaded.`}</p></div>;
}

function PullRequestContent({ detail, loading, error, loadMore, sectionLoading, onCommentPosted }: { detail: PullRequestDetail | null; loading: boolean; error: string; loadMore: (section: PullRequestSection) => void; sectionLoading: PullRequestSection | null; onCommentPosted: (comment: PullRequestEntry) => void }) {
  if (loading) return <p className="check-empty">Loading pull request description, commits, files, reviews, and comments…</p>;
  if (error) return <p className="check-empty error-text" role="alert">{error}</p>;
  if (!detail) return <p className="check-empty">Pull request details have not loaded.</p>;
  const labels: Array<{ key: PullRequestSection; title: string }> = [{ key: 'commits', title: 'Commits' }, { key: 'files', title: 'Changed files' }, { key: 'reviews', title: 'Reviews' }, { key: 'comments', title: 'Discussion' }, { key: 'review-comments', title: 'Inline review comments' }];
  return <section className="pull-content"><MergeReadinessPanel key={`${detail.repositoryPath}:${detail.number}`} repoPath={detail.repositoryPath} pullNumber={detail.number} /><div className="pull-content-summary"><div className="pull-content-branches"><code>{detail.head}</code><span>into</span><code>{detail.base}</code></div><p className="pull-content-description">{detail.body || 'No description provided.'}</p><span className="pull-content-updated">Updated {relativeTime(detail.updatedAt || new Date().toISOString())}</span></div><ReviewRequestPanel key={`${detail.repositoryPath}:${detail.number}`} detail={detail} />{labels.map(({ key, title }) => {
    const section = detail.sections[key];
    return <details className="pull-content-section" key={key}><summary><span>{title}</span><span className="muted">{section.items.length}{section.hasMore ? '+' : ''}</span></summary>{section.items.length === 0 ? <p className="pull-content-empty">No {title.toLowerCase()} yet.</p> : <div className="pull-content-entries">{section.items.map((item) => <article className="pull-content-entry" key={item.id}><div className="pull-content-entry-heading"><strong title={item.title}>{item.title}</strong>{item.status && <span className="status-tag">{item.status}</span>}{item.additions !== undefined && <span className="pull-file-counts"><span>+{item.additions}</span> <span>−{item.deletions}</span></span>}</div>{(item.author || item.date) && <span className="pull-content-meta">{item.author || ''}{item.author && item.date ? ' · ' : ''}{item.date ? relativeTime(item.date) : ''}</span>}{item.body && <p className="pull-content-body">{item.body}</p>}{item.patch && <pre className="pull-content-patch">{item.patch}</pre>}{item.url && <button className="text-button pull-content-link" type="button" onClick={() => void window.branchline?.openGitHubUrl(item.url!)}>Open on GitHub</button>}</article>)}</div>}{section.hasMore && <button type="button" className="text-button pull-load-more" disabled={sectionLoading === key} onClick={() => loadMore(key)}>{sectionLoading === key ? 'Loading…' : `Load more ${title.toLowerCase()}`}</button>}{key === 'comments' && <PullRequestCommentForm repoPath={detail.repositoryPath} pullNumber={detail.number} onPosted={onCommentPosted} />}</details>;
  })}</section>;
}

function ReviewRequestPanel({ detail }: { detail: PullRequestDetail }) {
  const [usersText, setUsersText] = useState('');
  const [teamsText, setTeamsText] = useState('');
  const [reviewers, setReviewers] = useState(detail.requestedReviewers || []);
  const [teams, setTeams] = useState(detail.requestedTeams || []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const canRequest = detail.state === 'open';
  const parse = (value: string) => [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const users = parse(usersText);
    const requestedTeams = parse(teamsText);
    if (!users.length && !requestedTeams.length) { setIsError(true); setMessage('Enter at least one GitHub username or team slug.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await window.branchline?.requestGitHubPullRequestReviewers(detail.repositoryPath, detail.number, users, requestedTeams) as { ok: boolean; confirmed?: boolean; requestedReviewers?: typeof reviewers; requestedTeams?: typeof teams; error?: string } | undefined;
      if (!result?.ok) { setIsError(true); setMessage(result?.error || 'Unable to request reviewers.'); return; }
      if (result.confirmed) { setReviewers(result.requestedReviewers || []); setTeams(result.requestedTeams || []); setUsersText(''); setTeamsText(''); }
      setIsError(false); setMessage(result.confirmed ? 'Reviewer requests updated from GitHub.' : (result.error || 'GitHub accepted the request. Refresh to confirm the reviewer list.'));
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'Unable to request reviewers.'); }
    finally { setBusy(false); }
  };
  return <><ReviewSubmissionPanel detail={detail} /><section className="review-request-panel" aria-labelledby="review-request-title"><div className="review-request-heading"><div><span className="eyebrow">Review coordination</span><h3 id="review-request-title">Requested reviewers</h3></div><span className="muted">{reviewers.length + teams.length}</span></div>{reviewers.length + teams.length > 0 ? <div className="review-request-tags">{reviewers.map((reviewer) => <span className="review-request-tag" key={reviewer.login}>{reviewer.avatarUrl && <img src={reviewer.avatarUrl} alt="" />}@{reviewer.login}</span>)}{teams.map((team) => <span className="review-request-tag" key={team.slug}>{team.name}</span>)}</div> : <p className="review-request-empty">No reviewers have been requested for this pull request.</p>}<form onSubmit={(event) => void submit(event)} className="review-request-form"><label>GitHub usernames<input value={usersText} onChange={(event) => setUsersText(event.target.value)} placeholder="octocat, teammate" disabled={!canRequest || busy} autoComplete="off" /><small>Separate multiple usernames with commas or spaces.</small></label><label>Team slugs<input value={teamsText} onChange={(event) => setTeamsText(event.target.value)} placeholder="engineering, frontend" disabled={!canRequest || busy} autoComplete="off" /><small>Use the team slug from its GitHub URL.</small></label>{message && <p className={isError ? 'connection-error' : 'review-request-success'} role={isError ? 'alert' : 'status'}>{message}</p>}<button className="ghost-button" type="submit" disabled={!canRequest || busy}>{busy ? 'Requesting…' : 'Request review'}</button>{!canRequest && <small>Reviewer requests are available for open pull requests only.</small>}</form></section></>;
}

function ReviewSubmissionPanel({ detail }: { detail: PullRequestDetail }) {
  const [event, setEvent] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submittedReview, setSubmittedReview] = useState<PullRequestEntry | null>(null);
  const canSubmit = detail.state === 'open' && !busy && (event === 'APPROVE' || Boolean(body.trim()));
  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(''); setSuccess(''); setSubmittedReview(null);
    try {
      const result = await window.branchline?.submitGitHubPullRequestReview(detail.repositoryPath, detail.number, event, body) as { ok: boolean; confirmed?: boolean; review?: PullRequestEntry; error?: string } | undefined;
      if (!result?.ok) { setError(result?.error || 'Unable to submit this review.'); return; }
      if (!result.confirmed || !result.review) { setSuccess(result?.error || 'GitHub accepted the review. Refresh the reviews section to confirm.'); return; }
      setBody('');
      setSubmittedReview(result.review);
      setSuccess(`Review submitted to GitHub: ${result.review.title}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to submit this review.'); }
    finally { setBusy(false); }
  };
  return <section className="review-submit-panel"><div className="review-request-heading"><div><span className="eyebrow">Your review</span><h3>Submit a review</h3></div></div><form className="review-submit-form" onSubmit={(formEvent) => void submit(formEvent)}><label>Review decision<select value={event} onChange={(change) => { setEvent(change.target.value as typeof event); setSuccess(''); }} disabled={detail.state !== 'open' || busy}><option value="COMMENT">Comment</option><option value="APPROVE">Approve</option><option value="REQUEST_CHANGES">Request changes</option></select></label><label>Summary{event === 'APPROVE' && <span className="muted">(optional)</span>}<textarea value={body} onChange={(change) => { setBody(change.target.value); setSuccess(''); }} maxLength={65536} rows={3} placeholder={event === 'APPROVE' ? 'Add an optional note for your approval…' : event === 'COMMENT' ? 'Share your overall review comment…' : 'Explain what should change before approval…'} disabled={detail.state !== 'open' || busy} /></label><p className="review-submit-hint">This submits a review to GitHub for the latest pull-request commit. Inline comments are not included.</p>{error && <p className="connection-error" role="alert">{error}</p>}{success && <p className="review-request-success" role="status">{success}</p>}{submittedReview && <article className="review-submitted-summary"><strong>{submittedReview.title}</strong><span>{submittedReview.author} · {relativeTime(submittedReview.date || new Date().toISOString())}</span>{submittedReview.body && <p>{submittedReview.body}</p>}{submittedReview.url && <button className="text-button" type="button" onClick={() => void window.branchline?.openGitHubUrl(submittedReview.url!)}>View submitted review on GitHub</button>}</article>}<button className="primary-button" type="submit" disabled={!canSubmit}>{busy ? 'Submitting…' : event === 'APPROVE' ? 'Submit approval' : event === 'REQUEST_CHANGES' ? 'Submit requested changes' : 'Submit review comment'}</button>{detail.state !== 'open' && <small>Only open pull requests accept reviews.</small>}</form></section>;
}

function GitHubConnectionView({ connected, onOpen, github, token, setToken, busy, connect, disconnect, title, detail }: { connected: boolean; onOpen: () => void; github: GitHubConnection | null; token: string; setToken: (value: string) => void; busy: boolean; connect: () => void; disconnect: () => void; title: string; detail: string }) {
  if (!connected) return <Empty onOpen={onOpen} />;
  const remote = github?.remote;
  if (!github?.connected) return <div className="page empty-home"><div className="empty-hero github-connect"><div className="empty-mark"><CloudOff size={28} /></div><span className="eyebrow">GitHub not connected</span><h1>{title}</h1><p>{detail}</p>{remote ? <div className="github-remote"><strong>{remote.owner}/{remote.name}</strong><span>Detected from {remote.remote}</span></div> : <div className="github-remote"><strong>No GitHub remote detected</strong><span>Local Git remains available. Add a github.com remote to connect repository collaboration later.</span></div>}{github?.secureStorageAvailable === false ? <p className="connection-error">Secure credential storage is unavailable on this device.</p> : <form className="github-token-form" onSubmit={(event) => { event.preventDefault(); connect(); }}><label htmlFor="github-token">Fine-grained personal access token</label><input id="github-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} placeholder="github_pat_…" /><small>Your token is verified once, encrypted by Windows credential protection, and never exposed in Gitwise’s renderer storage.</small>{github?.error && <p className="connection-error" role="alert">{github.error}</p>}<button className="primary-button" disabled={!token.trim() || busy} type="submit">{busy ? 'Connecting…' : 'Connect GitHub'}</button></form>}</div></div>;
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">GitHub connected</span><h1>{title}</h1><p>{detail}</p></div></div><section className="panel github-status-panel"><div className="github-account"><div className="repo-avatar">{github.account?.avatarUrl ? <img src={github.account.avatarUrl} alt="" /> : <Code2 size={16} />}</div><div><strong>{github.account?.name || github.account?.login}</strong><span>@{github.account?.login}</span></div></div><div className="github-status-detail"><span>Repository</span><strong>{remote ? `${remote.owner}/${remote.name}` : 'No GitHub remote detected'}</strong><small>{remote ? `Remote: ${remote.remote}` : 'Add a github.com remote to this local repository to link collaboration data.'}</small></div><div className="github-not-ready"><CloudOff size={18} /><div><strong>GitHub account is connected</strong><p>{remote ? 'This repository is linked to GitHub. The selected collaboration view has no data to show yet.' : 'Add a GitHub remote to load pull requests and shared activity for this repository.'}</p></div></div><button className="danger-outline" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : 'Disconnect GitHub'}</button></section></div>;
}
function ConnectionState({ title, detail }: { title: string; detail: string }) { return <div className="page empty-home"><div className="empty-hero"><div className="empty-mark"><CloudOff size={28} /></div><span className="eyebrow">Not connected</span><h1>{title}</h1><p>{detail}</p></div></div>; }
function Operations({ records }: { records: OperationRecord[] }) { return <section className="panel operations-panel"><div className="panel-heading"><div><h2>Recent local operations</h2><p>Technical detail is sanitized before it is shown here.</p></div></div>{records.slice(0, 5).map((record) => <div className="operation-row" key={record.id}><span className={record.ok ? 'status-dot green' : 'status-dot danger'} /><div><strong>{record.label}</strong><span>{relativeTime(record.at)} · {record.ok ? 'Completed' : 'Needs attention'}</span></div><code>{record.detail || 'No output'}</code></div>)}</section>; }
function ConfirmDialog({ title, detail, confirmLabel, onCancel, onConfirm }: { title: string; detail: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><section className="confirm-dialog"><span className="eyebrow">Confirm action</span><h2 id="confirm-title">{title}</h2><p>{detail}</p><div><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="danger-outline" onClick={onConfirm}>{confirmLabel}</button></div></section></div>; }
function MergePreviewDialog({ preview, loading, close, execute }: { preview: MergePreview; loading: boolean; close: () => void; execute: () => void }) {
  const conflict = preview.conflictPreview === 'conflicts';
  const alreadyMerged = preview.relationship === 'already-merged';
  const canMerge = preview.ok && !loading && !conflict && !alreadyMerged && !preview.workingTreeDirty;
  const relationship = preview.relationship === 'fast-forward' ? 'Fast-forward' : preview.relationship === 'merge-commit' ? 'Merge commit likely' : preview.relationship === 'already-merged' ? 'Already included' : 'Preparing preview';
  return <div className="confirm-overlay merge-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="merge-preview-title"><section className="merge-preview-dialog"><div className="panel-heading"><div><span className="eyebrow">Local merge preview</span><h2 id="merge-preview-title">{loading ? 'Checking merge…' : `Merge ${preview.source || 'branch'} into ${preview.target || 'current branch'}`}</h2></div><button className="icon-button" onClick={close} aria-label="Close merge preview"><X size={16} /></button></div>{loading ? <p className="commit-detail-state">Checking incoming commits, file changes, and possible conflicts…</p> : !preview.ok ? <p className="commit-detail-state error-text">{preview.error || 'Unable to prepare this merge preview.'}</p> : <><div className="merge-status"><span className={alreadyMerged ? 'status-tag' : 'status-tag green'}>{relationship}</span>{preview.conflictPreview === 'clean' && <span className="status-tag green">No conflicts predicted</span>}{preview.conflictPreview === 'conflicts' && <span className="status-tag danger">Conflicts predicted</span>}{preview.conflictPreview === 'unavailable' && <span className="status-tag">Conflict preview unavailable</span>}</div>{preview.workingTreeDirty && <div className="merge-warning">Your working tree has local changes. Commit, stash, or discard them before merging.</div>}{conflict && <div className="merge-warning danger">Git predicts conflicts. Gitwise does not yet provide a conflict editor, so this merge is blocked before it changes your repository.</div>}{preview.conflictPreview === 'unavailable' && <div className="merge-warning">This is only a preview; Gitwise will recheck repository state immediately before executing the merge.</div>}<div className="merge-summary"><span>{preview.commits?.length || 0}{(preview.commits?.length || 0) === 50 ? '+' : ''} incoming commits</span><span>{preview.files?.length || 0} changed files</span><span className="addition">+{preview.additions || 0}</span><span className="deletion">−{preview.deletions || 0}</span></div><section className="merge-preview-section"><h3>Incoming commits</h3>{preview.commits?.length ? preview.commits.map((commit) => <div className="merge-commit-row" key={commit.id}><code>{commit.shortId}</code><div><strong>{commit.subject}</strong><span>{commit.author} · {relativeTime(commit.date)}</span></div></div>) : <p className="commit-detail-state">No incoming commits.</p>}</section><section className="merge-preview-section"><h3>Changed files</h3>{preview.files?.length ? preview.files.slice(0, 50).map((file) => <div className="merge-file-row" key={file.path}><code title={file.path}>{file.path}</code><span>{file.binary ? 'Binary' : `+${file.additions} −${file.deletions}`}</span></div>) : <p className="commit-detail-state">No file changes.</p>}{(preview.files?.length || 0) > 50 && <p className="commit-detail-state">Only the first 50 files are shown.</p>}</section><p className="merge-scope">This merge affects your local {preview.target} branch only. Push afterward to update its remote branch.</p><div className="merge-preview-actions"><button className="ghost-button" onClick={close}>Close</button><button className="primary-button" disabled={!canMerge} onClick={execute}>{alreadyMerged ? 'Already merged' : preview.workingTreeDirty ? 'Working tree needs attention' : conflict ? 'Resolve conflicts before merging' : 'Merge locally'}</button></div></>}</section></div>;
}
