import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, CloudOff, Code2, FileCode2, FolderOpen, GitBranch, GitCommitHorizontal, GitCompareArrows, History, Home, Layers3, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import './gitwise.css';

type View = 'Home' | 'Changes' | 'Branches' | 'Compare' | 'Pull requests' | 'Activity';
type FileState = { path: string; originalPath?: string; index: string; worktree: string; kind: 'tracked' | 'untracked' };
type Snapshot = { ok: boolean; error?: string; repositoryPath?: string; name?: string; branch?: string | null; detached?: boolean; upstream?: string | null; remotes?: string[]; counts?: { ahead: number; behind: number }; files?: FileState[]; identity?: { name: string | null; email: string | null }; operation?: string | null; checkedAt?: string; log?: string };
type Commit = { id: string; shortId: string; author: string; email: string; date: string; refs: string[]; subject: string };
type CommitFile = { path: string; originalPath?: string; status: string };
type CommitDetails = { ok: boolean; error?: string; commit?: { id: string; shortId: string; author: string; authorEmail: string; committer: string; committerEmail: string; date: string; parents: string[]; message: string }; files?: CommitFile[] };
type CommitFileDiff = { commitId: string; path: string; patch: string; error?: string };
type Stash = { id: string; selector: string; subject: string; author: string; date: string };
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

  const connected = Boolean(snapshot?.ok && repoPath);
  const repoName = snapshot?.name || 'No repository selected';
  const currentBranch = snapshot?.branch || (snapshot?.detached ? 'Detached HEAD' : 'No branch');
  const files = snapshot?.files || [];
  const staged = files.filter((file) => file.index !== ' ' && file.index !== '?');
  const unstaged = files.filter((file) => file.worktree !== ' ' && file.worktree !== '?' && file.kind !== 'untracked');
  const untracked = files.filter((file) => file.kind === 'untracked');
  const localBranches = branches.filter((branch) => !branch.remote);

  const refresh = async (path = repoPath) => {
    if (!path) { historyRequest.current += 1; setSnapshot(null); setHistory([]); setHistoryHasMore(false); setHistoryError(''); setBranches([]); setStashes([]); setStashError(''); setNotice('Demo mode · open a local repository to refresh live status'); return; }
    const nextHistorySearch = path === repoPath ? historySearch : '';
    if (path !== repoPath) { setHistorySearch(''); setHistorySearchDraft(''); setSelectedCommit(null); setCommitDetails(null); setCommitDetailsLoading(false); setCommitFileDiff(null); commitRequest.current += 1; commitFileRequest.current += 1; }
    setBusy('Refreshing repository');
    setHistoryLoading(false);
    const requestId = ++historyRequest.current;
    const [repoResult, historyResult, branchesResult, operationResult, stashResult] = await Promise.all([
      window.branchline?.inspectRepository(path) as Promise<Snapshot>,
      window.branchline?.getHistory(path, HISTORY_PAGE_SIZE, 0, nextHistorySearch) as Promise<{ ok: boolean; commits?: Commit[]; error?: string; hasMore?: boolean }>,
      window.branchline?.getBranches(path) as Promise<{ ok: boolean; branches?: Branch[]; error?: string }>,
      window.branchline?.getOperations(path) as Promise<OperationRecord[]>,
      window.branchline?.getStashes(path) as Promise<{ ok: boolean; stashes?: Stash[]; error?: string }>
    ]);
    setBusy(null);
    if (!repoResult?.ok) { setSnapshot(null); setNotice(repoResult?.error || 'Unable to inspect this repository.'); return; }
    const resolved = repoResult.repositoryPath || path;
    setRepoPath(resolved); setSnapshot(repoResult); setBranches(branchesResult?.branches || []); setOperations(operationResult || []); setStashes(stashResult?.stashes || []); setStashError(stashResult?.ok ? '' : stashResult?.error || 'Unable to load saved stashes.');
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
        {view === 'Changes' && <ChangesSafe connected={connected} onOpen={chooseRepository} confirm={confirm} staged={staged} unstaged={unstaged} untracked={untracked} stashes={stashes} stashError={stashError} identity={snapshot?.identity} selected={selectedFile} diff={diff} commitMessage={commitMessage} setCommitMessage={setCommitMessage} openFile={openFile} operate={operate} />}
        {view === 'Branches' && <Branches connected={connected} onOpen={chooseRepository} confirm={confirm} branches={branches} draft={branchDraft} setDraft={setBranchDraft} selected={selectedBranch} setSelected={setSelectedBranch} operate={operate} />}
        {view === 'Compare' && <Compare connected={connected} onOpen={chooseRepository} confirm={confirm} branches={branchOptions} base={compareBase} head={compareHead} setBase={setCompareBase} setHead={setCompareHead} diff={compareDiff} summary={compareSummary} load={loadComparison} operate={operate} />}
        {view === 'Pull requests' && <ConnectionState title="Pull requests need GitHub" detail="Gitwise has local Git access only. Connect a GitHub account in a future collaboration milestone to load pull requests, reviews, and checks." />}
        {view === 'Activity' && <ConnectionState title="Shared activity needs GitHub" detail="Gitwise cannot see teammates’ local or unpushed work. Connect GitHub to load pushed commits, reviews, merges, and workflow checks." />}
        {connected && operations.length > 0 && <Operations records={operations} />}
      </div>
      {confirmation && <ConfirmDialog title={confirmation.title} detail={confirmation.detail} confirmLabel={confirmation.confirmLabel} onCancel={() => setConfirmation(null)} onConfirm={() => { confirmation.action(); setConfirmation(null); }} />}
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
function ChangesSafe({ connected, onOpen, confirm, staged, unstaged, untracked, stashes, stashError, identity, selected, diff, commitMessage, setCommitMessage, openFile, operate }: { connected: boolean; onOpen: () => void; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; staged: FileState[]; unstaged: FileState[]; untracked: FileState[]; stashes: Stash[]; stashError: string; identity?: { name: string | null; email: string | null }; selected: FileState | null; diff: string; commitMessage: string; setCommitMessage: (value: string) => void; openFile: (file: FileState) => void; operate: (operation: unknown, label: string) => Promise<boolean> }) {
  if (!connected) return <Empty onOpen={onOpen} />;
  const renderFiles = (title: string, collection: FileState[], mode: 'staged' | 'unstaged' | 'untracked') => <section className="change-group"><div className="group-title"><span>{title}</span><span className="muted">{collection.length}</span></div>{collection.map((file) => <div className={selected?.path === file.path ? 'change-row selected' : 'change-row'} key={`${mode}-${file.path}`}><button className="file-open" onClick={() => void openFile({ ...file, index: mode === 'staged' ? file.index : ' ' })}><FileCode2 size={16} /><span>{file.path}</span></button>{mode === 'staged' && <button className="ghost-button compact" onClick={() => void operate({ type: 'unstage', paths: [file.path] }, 'Unstage file')}>Unstage</button>}{mode !== 'staged' && <button className="ghost-button compact" onClick={() => void operate({ type: 'stage', paths: [file.path] }, 'Stage file')}>Stage</button>}{mode === 'unstaged' && <button className="danger-link" onClick={() => confirm('Discard unstaged changes?', `${file.path} will be restored to its staged version. Any staged changes will remain.`, 'Discard changes', () => void operate({ type: 'discard', paths: [file.path] }, 'Discard unstaged changes'))} title="Discard unstaged changes"><Trash2 size={15} /></button>}{mode === 'untracked' && <button className="danger-link" onClick={() => confirm('Move untracked file to Recycle Bin?', `${file.path} is not tracked by Git and will be moved to the Windows Recycle Bin.`, 'Move to Recycle Bin', () => void operate({ type: 'trash-untracked', paths: [file.path] }, 'Move untracked file to Recycle Bin'))} title="Move to Recycle Bin"><Trash2 size={15} /></button>}</div>)}</section>;
  const commit = async () => { const committed = await operate({ type: 'commit', message: commitMessage }, 'Commit staged changes'); if (committed) setCommitMessage(''); };
  const hasChanges = staged.length + unstaged.length + untracked.length > 0;
  return <div className="page"><div className="page-title"><div><span className="eyebrow">Working tree</span><h1>Changes</h1><p>Staged, unstaged, and untracked work are kept separate.</p></div><div className="heading-actions"><button className="ghost-button" disabled={!hasChanges} onClick={() => void operate({ type: 'stash' }, 'Stash changes')}><Layers3 size={16} />Stash all</button></div></div><div className="changes-layout"><section className="panel change-panel">{renderFiles('Staged', staged, 'staged')}{renderFiles('Unstaged', unstaged, 'unstaged')}{renderFiles('Untracked', untracked, 'untracked')}<div className="commit-box"><span className="eyebrow">Commit</span><p>{staged.length ? `${staged.length} staged file${staged.length === 1 ? '' : 's'} will be committed as ${identity?.name || 'your configured Git identity'}.` : 'Stage one or more files before committing.'}</p><textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Describe this change" /><button className="primary-button" disabled={!staged.length || !commitMessage.trim()} onClick={() => void commit()}><GitCommitHorizontal size={16} />Commit staged changes</button></div></section><section className="panel diff-panel"><div className="panel-heading"><div><h2>{selected ? selected.path : 'Diff preview'}</h2><p>{selected ? 'Actual Git diff for the selected state' : 'Select a file'}</p></div></div><pre className="real-diff">{diff || 'Select a file to load its actual diff.'}</pre></section></div><StashShelf stashes={stashes} error={stashError} confirm={confirm} operate={operate} /></div>;
}

function StashShelf({ stashes, error, confirm, operate }: { stashes: Stash[]; error: string; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; operate: (operation: unknown, label: string) => Promise<boolean> }) {
  return <section className="panel stash-panel"><div className="panel-heading"><div><h2>Saved stashes</h2><p>Apply a stash to keep it saved, or restore it and remove that entry.</p></div><span className="muted">{stashes.length}</span></div>{error ? <p className="stash-empty error-text">{error}</p> : stashes.length === 0 ? <p className="stash-empty">No saved stashes in this repository.</p> : stashes.map((stash) => <div className="stash-row" key={stash.id}><div className="stash-info"><code>{stash.selector}</code><strong title={stash.subject}>{stash.subject}</strong><span>{stash.author} · {relativeTime(stash.date)}</span><small>{stash.id}</small></div><div className="stash-actions"><button className="ghost-button compact" onClick={() => confirm(`Apply ${stash.selector}?`, 'Git will restore these changes into the current working tree and keep the stash entry. Existing edits may cause conflicts.', 'Apply and keep stash', () => void operate({ type: 'stash-apply', stashId: stash.id }, 'Apply stash'))}>Apply</button><button className="danger-outline compact" onClick={() => confirm(`Restore and remove ${stash.selector}?`, 'Git will apply these changes to the working tree and remove this stash entry only if the restore succeeds. Review any existing local edits first.', 'Restore and remove', () => void operate({ type: 'stash-pop-selected', stashId: stash.id }, 'Restore stash'))}>Restore & remove</button></div></div>)}</section>;
}

function Branches({ connected, onOpen, confirm, branches, draft, setDraft, selected, setSelected, operate }: { connected: boolean; onOpen: () => void; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; branches: Branch[]; draft: string; setDraft: (value: string) => void; selected: Branch | null; setSelected: (value: Branch) => void; operate: (operation: unknown, label: string) => Promise<boolean> }) {
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
  return <div className="page"><div className="page-title"><div><span className="eyebrow">Repository map</span><h1>Branches</h1><p>Local and remote branches are kept distinct. Every change explains its local or remote effect.</p></div></div><div className="branch-create"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="new branch name" /><select value={startPoint} onChange={(event) => setStartPoint(event.target.value)} aria-label="Starting point"><option value="">Current branch</option>{local.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select><button className="primary-button" disabled={!draft.trim()} onClick={() => void create()}><Plus size={16} />Create branch</button></div><div className="branch-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter branches" /></div><div className="branches-layout"><section className="panel branch-list-panel">{render('Local branches', local)}{render('Remote branches', remote)}</section><aside className="panel branch-detail">{selected ? <><span className="eyebrow">{selected.remote ? 'Remote branch' : 'Local branch'}</span><h2>{selected.name}</h2><p>{selected.remote ? `Remote reference on ${remoteName || 'unknown remote'}. Deleting it will push a deletion to that remote.` : selected.upstream ? `Tracks ${selected.upstream}` : 'No upstream configured. Publish it from the header to create one.'}</p>{!selected.remote && !selected.current && <button className="primary-button" onClick={() => void operate({ type: 'switch-branch', name: selected.name }, 'Switch branch')}>Switch here</button>}{!selected.remote && !selected.current && <button className="ghost-button" onClick={() => confirm(`Merge ${selected.name}?`, `This will merge ${selected.name} into your current local branch. The remote will not change until you push.`, 'Merge locally', () => void operate({ type: 'merge', source: selected.name }, 'Merge branch'))}>Merge into current</button>}{!selected.remote && <div className="rename-row"><input value={renameTo} onChange={(event) => setRenameTo(event.target.value)} aria-label="New branch name" /><button className="ghost-button compact" disabled={!renameTo.trim() || renameTo.trim() === selected.name} onClick={() => confirm(`Rename ${selected.name}?`, `Only the local branch will be renamed. Its remote branch, if any, is unchanged.`, 'Rename local branch', () => void operate({ type: 'rename-branch', oldName: selected.name, newName: renameTo.trim() }, 'Rename branch'))}>Rename</button></div>}{!selected.remote && !selected.current && <button className="danger-outline" onClick={() => confirm(`Delete local branch ${selected.name}?`, 'This removes only the local branch. Any matching remote branch will remain available.', 'Delete local branch', () => void operate({ type: 'delete-local-branch', name: selected.name }, 'Delete local branch'))}>Delete local branch</button>}{selected.remote && remoteName && remoteBranch && <button className="danger-outline" onClick={() => confirm(`Delete ${selected.name} from ${remoteName}?`, 'This will push a branch deletion to the remote. It does not delete a local branch with the same name.', 'Delete remote branch', () => void operate({ type: 'delete-remote-branch', remote: remoteName, name: remoteBranch }, 'Delete remote branch'))}>Delete remote branch</button>}</> : <div className="saved-empty">Select a branch to see its available actions.</div>}</aside></div></div>;
}
function Compare({ connected, onOpen, confirm, branches, base, head, setBase, setHead, diff, summary, load, operate }: { connected: boolean; onOpen: () => void; confirm: (title: string, detail: string, confirmLabel: string, action: () => void) => void; branches: string[]; base: string; head: string; setBase: (value: string) => void; setHead: (value: string) => void; diff: string; summary: { files: number; additions: number; deletions: number } | null; load: () => void; operate: (operation: unknown, label: string) => Promise<boolean> }) { if (!connected) return <Empty onOpen={onOpen} />; return <div className="page"><div className="page-title"><div><span className="eyebrow">Compare branches</span><h1>What would change?</h1><p>The comparison uses the shared merge base: changes introduced by the comparison branch since it diverged from base.</p></div></div><div className="compare-controls"><label>Base<select value={base} onChange={(event) => setBase(event.target.value)}><option value="">Choose base</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><label>Comparison<select value={head} onChange={(event) => setHead(event.target.value)}><option value="">Choose comparison</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><button className="primary-button" disabled={!base || !head || base === head} onClick={load}>Compare</button>{head && <button className="ghost-button" onClick={() => confirm(`Merge ${head}?`, `This merges ${head} into your current local branch, not necessarily ${base}. The remote will not change until you push.`, 'Merge locally', () => void operate({ type: 'merge', source: head }, 'Merge branch'))}>Merge comparison branch</button>}</div>{summary && <div className="compare-summary"><span>{summary.files} changed file{summary.files === 1 ? '' : 's'}</span><span className="addition">+{summary.additions} additions</span><span className="deletion">−{summary.deletions} deletions</span></div>}<section className="panel diff-panel"><pre className="real-diff">{diff || 'Choose two branches to see their actual diff.'}</pre></section></div>; }
function ConnectionState({ title, detail }: { title: string; detail: string }) { return <div className="page empty-home"><div className="empty-hero"><div className="empty-mark"><CloudOff size={28} /></div><span className="eyebrow">Not connected</span><h1>{title}</h1><p>{detail}</p></div></div>; }
function Operations({ records }: { records: OperationRecord[] }) { return <section className="panel operations-panel"><div className="panel-heading"><div><h2>Recent local operations</h2><p>Technical detail is sanitized before it is shown here.</p></div></div>{records.slice(0, 5).map((record) => <div className="operation-row" key={record.id}><span className={record.ok ? 'status-dot green' : 'status-dot danger'} /><div><strong>{record.label}</strong><span>{relativeTime(record.at)} · {record.ok ? 'Completed' : 'Needs attention'}</span></div><code>{record.detail || 'No output'}</code></div>)}</section>; }
function ConfirmDialog({ title, detail, confirmLabel, onCancel, onConfirm }: { title: string; detail: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><section className="confirm-dialog"><span className="eyebrow">Confirm action</span><h2 id="confirm-title">{title}</h2><p>{detail}</p><div><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="danger-outline" onClick={onConfirm}>{confirmLabel}</button></div></section></div>; }
