import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, CloudOff, Code2, FileCode2, FolderOpen, GitBranch, GitCommitHorizontal, GitCompareArrows, History, Home, Layers3, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import './gitwise.css';

type View = 'Home' | 'Changes' | 'Branches' | 'Compare' | 'Pull requests' | 'Activity';
type FileState = { path: string; originalPath?: string; index: string; worktree: string; kind: 'tracked' | 'untracked' };
type Snapshot = { ok: boolean; error?: string; repositoryPath?: string; name?: string; branch?: string | null; detached?: boolean; upstream?: string | null; remotes?: string[]; counts?: { ahead: number; behind: number }; files?: FileState[]; identity?: { name: string | null; email: string | null }; operation?: string | null; checkedAt?: string; log?: string };
type Commit = { id: string; shortId: string; author: string; email: string; date: string; refs: string[]; subject: string };
type Branch = { name: string; fullName: string; upstream: string | null; current: boolean; remote: boolean; shortId: string; date: string; author: string; subject: string };

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
  const [branches, setBranches] = useState<Branch[]>([]);
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

  const connected = Boolean(snapshot?.ok && repoPath);
  const repoName = snapshot?.name || 'No repository selected';
  const currentBranch = snapshot?.branch || (snapshot?.detached ? 'Detached HEAD' : 'No branch');
  const files = snapshot?.files || [];
  const staged = files.filter((file) => file.index !== ' ' && file.index !== '?');
  const unstaged = files.filter((file) => file.worktree !== ' ' && file.worktree !== '?' && file.kind !== 'untracked');
  const untracked = files.filter((file) => file.kind === 'untracked');
  const localBranches = branches.filter((branch) => !branch.remote);

  const refresh = async (path = repoPath) => {
    if (!path) { setSnapshot(null); setHistory([]); setBranches([]); setNotice('Demo mode · open a local repository to refresh live status'); return; }
    setBusy('Refreshing repository');
    const [repoResult, historyResult, branchesResult] = await Promise.all([
      window.branchline?.inspectRepository(path) as Promise<Snapshot>,
      window.branchline?.getHistory(path, 80, 0) as Promise<{ ok: boolean; commits?: Commit[]; error?: string }>,
      window.branchline?.getBranches(path) as Promise<{ ok: boolean; branches?: Branch[]; error?: string }>
    ]);
    setBusy(null);
    if (!repoResult?.ok) { setSnapshot(null); setNotice(repoResult?.error || 'Unable to inspect this repository.'); return; }
    const resolved = repoResult.repositoryPath || path;
    setRepoPath(resolved); setSnapshot(repoResult); setHistory(historyResult?.commits || []); setBranches(branchesResult?.branches || []);
    setNotice(`Live status · ${repoResult.name || 'repository'} checked ${relativeTime(repoResult.checkedAt || new Date().toISOString())}`);
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
    if (!repoPath) { setNotice('Open a local repository before using Git actions.'); return; }
    setBusy(label); setNotice(`${label}…`);
    const result = await window.branchline?.operateGit(repoPath, operation);
    setBusy(null);
    if (!result?.ok) { setNotice(result?.stderr || `${label} failed.`); return; }
    setNotice(`${label} completed.`); await refresh(repoPath);
  };

  const openFile = async (file: FileState) => {
    setSelectedFile(file); setDiff('Loading diff…');
    const result = await window.branchline?.getDiff(repoPath, { path: file.path, staged: file.index !== ' ' && file.index !== '?' }) as { ok: boolean; patch?: string; error?: string };
    setDiff(result?.ok ? result.patch || 'No textual diff is available for this file.' : result?.error || 'Unable to load this diff.');
  };

  const loadComparison = async () => {
    if (!compareBase || !compareHead) return setNotice('Choose both a base and comparison branch.');
    setCompareDiff('Loading comparison…');
    const result = await window.branchline?.getDiff(repoPath, { base: compareBase, compare: compareHead }) as { ok: boolean; patch?: string; error?: string };
    setCompareDiff(result?.ok ? result.patch || 'These branches have no textual differences.' : result?.error || 'Unable to compare branches.');
  };

  const statusText = busy ? `${busy}…` : notice;
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
        {view === 'Home' && (connected ? <HomeView snapshot={snapshot} history={history} setView={setView} /> : <Empty onOpen={chooseRepository} />)}
        {view === 'Changes' && <Changes connected={connected} files={files} staged={staged} unstaged={unstaged} untracked={untracked} identity={snapshot?.identity} selected={selectedFile} diff={diff} commitMessage={commitMessage} setCommitMessage={setCommitMessage} openFile={openFile} operate={operate} />}
        {view === 'Branches' && <Branches connected={connected} branches={branches} draft={branchDraft} setDraft={setBranchDraft} selected={selectedBranch} setSelected={setSelectedBranch} operate={operate} />}
        {view === 'Compare' && <Compare connected={connected} branches={branchOptions} base={compareBase} head={compareHead} setBase={setCompareBase} setHead={setCompareHead} diff={compareDiff} load={loadComparison} operate={operate} />}
        {view === 'Pull requests' && <ConnectionState title="Pull requests need GitHub" detail="Gitwise has local Git access only. Connect a GitHub account in a future collaboration milestone to load pull requests, reviews, and checks." />}
        {view === 'Activity' && <ConnectionState title="Shared activity needs GitHub" detail="Gitwise cannot see teammates’ local or unpushed work. Connect GitHub to load pushed commits, reviews, merges, and workflow checks." />}
      </div>
    </main>
  </div>;
}

function Empty({ onOpen }: { onOpen: () => void }) { return <div className="page empty-home"><div className="empty-hero"><div className="empty-mark"><FolderOpen size={28} /></div><span className="eyebrow">Get started</span><h1>Open a repository</h1><p>Choose an existing local Git repository to see its real branches, changes, commits, and sync status.</p><button className="primary-button" onClick={onOpen}><FolderOpen size={16} />Open local repository</button></div></div>; }
function HomeView({ snapshot, history, setView }: { snapshot: Snapshot | null; history: Commit[]; setView: (view: View) => void }) { if (!snapshot) return <Empty onOpen={() => {}} />; const counts = snapshot.counts || { ahead: 0, behind: 0 }; return <div className="page"><div className="page-heading"><div><span className="eyebrow">Live repository</span><h1>{snapshot.name}</h1><p>{snapshot.branch ? `On ${snapshot.branch}` : 'Detached HEAD'} · checked {relativeTime(snapshot.checkedAt || new Date().toISOString())}</p></div></div><div className="overview-grid"><Metric label="Local changes" value={`${snapshot.files?.length || 0} files`} meta={snapshot.files?.length ? 'Review before sharing' : 'Working tree clean'} action="Review changes" onClick={() => setView('Changes')} /><Metric label="Incoming commits" value={snapshot.upstream ? `${counts.behind}` : '—'} meta={snapshot.upstream ? `from ${snapshot.upstream}` : 'No upstream configured'} action="Explore branches" onClick={() => setView('Branches')} /><Metric label="Outgoing commits" value={snapshot.upstream ? `${counts.ahead}` : '—'} meta={snapshot.upstream ? 'ready to push' : 'Publish this branch to push'} action="Compare branches" onClick={() => setView('Compare')} /></div><section className="panel live-panel"><div className="panel-heading"><div><h2>Recent commits</h2><p>From local Git history</p></div><button className="text-button" onClick={() => setView('Branches')}>Browse branches</button></div>{history.length ? history.slice(0, 10).map((commit) => <div className="live-row" key={commit.id}><GitCommitHorizontal size={16} /><div><strong>{commit.subject}</strong><span>{commit.author} · {relativeTime(commit.date)} · {commit.shortId}</span></div>{commit.refs.slice(0, 2).map((ref) => <code key={ref}>{ref}</code>)}</div>) : <div className="saved-empty">No commits are available in this repository yet.</div>}</section></div>; }
function Metric({ label, value, meta, action, onClick }: { label: string; value: string; meta: string; action: string; onClick: () => void }) { return <div className="status-card"><span className="card-label">{label}</span><strong>{value}</strong><span className="card-meta">{meta}</span><button className="card-action" onClick={onClick}>{action}<ArrowUp size={13} className="rotate-45" /></button></div>; }
function Changes({ connected, files, staged, unstaged, untracked, identity, selected, diff, commitMessage, setCommitMessage, openFile, operate }: { connected: boolean; files: FileState[]; staged: FileState[]; unstaged: FileState[]; untracked: FileState[]; identity?: { name: string | null; email: string | null }; selected: FileState | null; diff: string; commitMessage: string; setCommitMessage: (value: string) => void; openFile: (file: FileState) => void; operate: (operation: unknown, label: string) => Promise<void> }) { if (!connected) return <Empty onOpen={() => {}} />; const render = (title: string, collection: FileState[], action?: 'stage' | 'unstage') => <section className="change-group"><div className="group-title"><span>{title}</span><span className="muted">{collection.length}</span></div>{collection.map((file) => <div className={selected?.path === file.path ? 'change-row selected' : 'change-row'} key={`${title}-${file.path}`}><button className="file-open" onClick={() => void openFile(file)}><FileCode2 size={16} /><span>{file.path}</span></button>{action && <button className="ghost-button compact" onClick={() => void operate({ type: action, paths: [file.path] }, action === 'stage' ? 'Stage file' : 'Unstage file')}>{action === 'stage' ? 'Stage' : 'Unstage'}</button>}<button className="danger-link" onClick={() => { if (window.confirm(`Discard uncommitted changes in ${file.path}?`)) void operate({ type: 'discard', paths: [file.path] }, 'Discard changes'); }} title="Discard changes"><Trash2 size={15} /></button></div>)}</section>; return <div className="page"><div className="page-title"><div><span className="eyebrow">Working tree</span><h1>Changes</h1><p>Stage precisely what you want to commit. Discard is permanent.</p></div><button className="ghost-button" onClick={() => void operate({ type: 'stash' }, 'Stash changes')}><Layers3 size={16} />Stash</button></div><div className="changes-layout"><section className="panel change-panel">{render('Staged', staged, 'unstage')}{render('Unstaged', unstaged, 'stage')}{render('Untracked', untracked, 'stage')}{files.length === 0 && <div className="saved-empty">Your working tree is clean.</div>}<div className="commit-box"><span className="eyebrow">Commit</span><p>{staged.length ? `${staged.length} staged file${staged.length === 1 ? '' : 's'} will be committed as ${identity?.name ? `${identity.name}${identity.email ? ` <${identity.email}>` : ''}` : 'your configured Git identity'}.` : 'Stage one or more files to create a commit.'}</p><textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Describe this change" /><button className="primary-button" disabled={!staged.length || !commitMessage.trim()} onClick={() => { void operate({ type: 'commit', message: commitMessage }, 'Commit changes'); setCommitMessage(''); }}><GitCommitHorizontal size={16} />Commit staged changes</button></div></section><section className="panel diff-panel"><div className="panel-heading"><div><h2>{selected ? selected.path : 'Diff preview'}</h2><p>{selected ? 'Live Git diff' : 'Select a changed file'}</p></div></div><pre className="real-diff">{diff || 'Select a file to load its actual diff.'}</pre></section></div></div>; }
function Branches({ connected, branches, draft, setDraft, selected, setSelected, operate }: { connected: boolean; branches: Branch[]; draft: string; setDraft: (value: string) => void; selected: Branch | null; setSelected: (value: Branch) => void; operate: (operation: unknown, label: string) => Promise<void> }) { if (!connected) return <Empty onOpen={() => {}} />; const local = branches.filter((branch) => !branch.remote); const remote = branches.filter((branch) => branch.remote); const render = (title: string, collection: Branch[]) => <section className="branch-group"><div className="group-title"><span>{title}</span><span className="muted">{collection.length}</span></div>{collection.map((branch) => <button className={selected?.fullName === branch.fullName ? 'branch-list-row selected' : 'branch-list-row'} key={branch.fullName} onClick={() => setSelected(branch)}><GitBranch size={16} /><div className="branch-name"><strong>{branch.name}</strong><span>{branch.subject || 'No commits yet'}</span></div>{branch.current && <span className="status-tag green">Current</span>}<span className="latest-sha">{branch.shortId}</span></button>)}</section>; return <div className="page"><div className="page-title"><div><span className="eyebrow">Repository map</span><h1>Branches</h1><p>Switch, create, merge, or delete branches with the exact effect shown.</p></div></div><div className="branch-create"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="new branch name" /><button className="primary-button" disabled={!draft.trim()} onClick={() => { void operate({ type: 'create-branch', name: draft.trim() }, 'Create branch'); setDraft(''); }}><Plus size={16} />Create branch</button></div><div className="branches-layout"><section className="panel branch-list-panel">{render('Local branches', local)}{render('Remote branches', remote)}</section><aside className="panel branch-detail">{selected ? <><span className="eyebrow">Selected branch</span><h2>{selected.name}</h2><p>{selected.upstream ? `Tracks ${selected.upstream}` : 'No upstream configured'}</p>{!selected.remote && !selected.current && <button className="primary-button" onClick={() => void operate({ type: 'switch-branch', name: selected.name }, 'Switch branch')}>Switch here</button>}{!selected.remote && !selected.current && <button className="danger-outline" onClick={() => { if (window.confirm(`Delete local branch ${selected.name}?`)) void operate({ type: 'delete-local-branch', name: selected.name }, 'Delete branch'); }}>Delete local branch</button>}{!selected.remote && !selected.current && <button className="ghost-button" onClick={() => { if (window.confirm(`Merge ${selected.name} into the current branch?`)) void operate({ type: 'merge', source: selected.name }, 'Merge branch'); }}>Merge into current</button>}</> : <div className="saved-empty">Select a branch to see its available actions.</div>}</aside></div></div>; }
function Compare({ connected, branches, base, head, setBase, setHead, diff, load, operate }: { connected: boolean; branches: string[]; base: string; head: string; setBase: (value: string) => void; setHead: (value: string) => void; diff: string; load: () => void; operate: (operation: unknown, label: string) => Promise<void> }) { if (!connected) return <Empty onOpen={() => {}} />; return <div className="page"><div className="page-title"><div><span className="eyebrow">Compare branches</span><h1>What would change?</h1><p>The comparison uses the shared merge base: changes in comparison since it diverged from base.</p></div></div><div className="compare-controls"><label>Base<select value={base} onChange={(event) => setBase(event.target.value)}><option value="">Choose base</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><label>Comparison<select value={head} onChange={(event) => setHead(event.target.value)}><option value="">Choose comparison</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><button className="primary-button" onClick={load}>Compare</button>{head && <button className="ghost-button" onClick={() => { if (window.confirm(`Merge ${head} into the current branch?`)) void operate({ type: 'merge', source: head }, 'Merge branch'); }}>Merge comparison branch</button>}</div><section className="panel diff-panel"><pre className="real-diff">{diff || 'Choose two branches to see their actual diff.'}</pre></section></div>; }
function ConnectionState({ title, detail }: { title: string; detail: string }) { return <div className="page empty-home"><div className="empty-hero"><div className="empty-mark"><CloudOff size={28} /></div><span className="eyebrow">Not connected</span><h1>{title}</h1><p>{detail}</p></div></div>; }
