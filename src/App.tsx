import { useMemo, useState } from 'react';
import {
  Activity, ArrowDown, ArrowUp, Bell, BookOpen, Branch, Check, CheckCircle2, ChevronDown,
  CircleAlert, Cloud, CloudOff, Code2, Command, Copy, FileCode2, FolderOpen, GitBranch,
  GitCommitHorizontal, GitCompareArrows, Github, History, Home, Inbox, Layers3, Loader2,
  Moon, MoreHorizontal, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles,
  Sun, TerminalSquare, UserRound, Users, X, Zap
} from 'lucide-react';

type View = 'Home' | 'Changes' | 'Branches' | 'Pull requests' | 'Activity';

const commits = [
  { sha: 'a84c2d1', message: 'Refine onboarding empty state', author: 'Maya Chen', initials: 'MC', time: '18 min ago', branch: 'feature/onboarding' },
  { sha: '82f4e09', message: 'Add branch comparison summary', author: 'You', initials: 'YO', time: '46 min ago', branch: 'develop' },
  { sha: '2c47af8', message: 'Move repository actions into header', author: 'Noah Williams', initials: 'NW', time: '2 hr ago', branch: 'develop' },
  { sha: 'cc8a1f4', message: 'Update contributor activity query', author: 'Priya Shah', initials: 'PS', time: 'Yesterday', branch: 'main' }
];

const files = [
  { path: 'src/components/RepoHeader.tsx', state: 'M', note: 'Changed 12 min ago', tone: 'blue' },
  { path: 'src/styles/tokens.css', state: 'M', note: 'Changed 18 min ago', tone: 'blue' },
  { path: 'src/components/BranchPicker.tsx', state: 'A', note: 'New file', tone: 'green' }
];

const nav = [
  { label: 'Home', icon: Home }, { label: 'Changes', icon: FileCode2, count: '3' },
  { label: 'Branches', icon: GitBranch }, { label: 'Pull requests', icon: GitCompareArrows, count: '2' },
  { label: 'Activity', icon: Activity }
] as const;

function App() {
  const [view, setView] = useState<View>('Home');
  const [dark, setDark] = useState(false);
  const [repoPath, setRepoPath] = useState('C:/Users/geolo/OneDrive/Documents/repos/branchline');
  const [branch, setBranch] = useState('develop');
  const [branchMenu, setBranchMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>('Demo mode · connect a local repository to refresh live status');
  const [selectedCommit, setSelectedCommit] = useState<(typeof commits)[number] | null>(null);

  const repoName = useMemo(() => repoPath.split(/[\\/]/).filter(Boolean).pop() || 'branchline', [repoPath]);

  async function chooseRepo() {
    const chosen = await window.branchline?.chooseRepository();
    if (!chosen) return;
    setRepoPath(chosen);
    setNotice('Repository selected · checking local status…');
    await window.branchline?.inspectRepository(chosen);
    setNotice('Connected · local status refreshed just now');
  }

  function runAction(label: string) {
    setNotice(`${label} queued for ${branch} · demo mode`);
    window.setTimeout(() => setNotice(null), 3500);
  }

  return (
    <div className={dark ? 'app dark' : 'app'}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><GitBranch size={18} /></div><span>branchline</span><span className="beta">BETA</span></div>
        <button className="repo-switcher" onClick={chooseRepo} title="Open a local repository">
          <div className="repo-avatar"><Code2 size={16} /></div><div className="repo-copy"><strong>{repoName}</strong><span>Local repository</span></div><ChevronDown size={16} />
        </button>
        <div className="sidebar-label">Workspace</div>
        <nav className="nav-list" aria-label="Main navigation">
          {nav.map(({ label, icon: Icon, count }) => <button key={label} onClick={() => setView(label)} className={view === label ? 'nav-item active' : 'nav-item'}><Icon size={18} /><span>{label}</span>{count && <span className="nav-count">{count}</span>}</button>)}
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label row-label"><span>Saved repositories</span><button className="icon-button tiny" title="Add repository"><Plus size={14} /></button></div>
          <button className="saved-repo selected"><span className="status-dot green" /><span>branchline</span><span className="saved-branch">develop</span></button>
          <button className="saved-repo"><span className="status-dot gray" /><span>qup-mobile</span></button>
          <button className="saved-repo"><span className="status-dot gray" /><span>geo-crm</span></button>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item"><Bell size={18} /><span>Notifications</span><span className="notification-dot" /></button>
          <button className="nav-item" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span>{dark ? 'Light theme' : 'Dark theme'}</span></button>
          <button className="account-row"><div className="avatar avatar-indigo">YO</div><div><strong>Georgy López</strong><span>Personal account</span></div><MoreHorizontal size={16} /></button>
        </div>
      </aside>

      <main className="main">
        <header className="workspace-header">
          <div className="window-drag"><span className="eyebrow">Repository</span><div className="header-repo"><span>{repoName}</span><span className="slash">/</span><button className="branch-trigger" onClick={() => setBranchMenu(!branchMenu)}>{branch}<ChevronDown size={15} /></button>{branchMenu && <div className="branch-menu"><div className="menu-search"><Search size={14} /><input autoFocus placeholder="Search branches" /></div>{['develop', 'main', 'feature/onboarding', 'release/1.4'].map((name) => <button key={name} onClick={() => { setBranch(name); setBranchMenu(false); }} className={name === branch ? 'branch-option selected' : 'branch-option'}><GitBranch size={15} /><span>{name}</span>{name === branch && <Check size={15} />}</button>)}</div>}</div></div>
          <div className="header-actions"><div className="sync-state"><span className="status-dot green" /><span>Synced 2 min ago</span></div><button className="ghost-button" onClick={() => runAction('Fetch')}><RefreshCw size={16} />Fetch</button><button className="ghost-button" onClick={() => runAction('Pull')}><ArrowDown size={16} />Pull</button><button className="primary-button" onClick={() => runAction('Push')}><ArrowUp size={16} />Push <span className="button-count">3</span></button></div>
        </header>

        <div className="content-scroll">
          {notice && <div className={notice.includes('Demo') ? 'notice demo' : 'notice'}><div className="notice-icon"><Sparkles size={15} /></div><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={15} /></button></div>}
          {view === 'Home' && <HomeView repoName={repoName} branch={branch} setView={setView} runAction={runAction} selectedCommit={selectedCommit} setSelectedCommit={setSelectedCommit} />}
          {view === 'Changes' && <ChangesView files={files} runAction={runAction} />}
          {view === 'Branches' && <BranchesView branch={branch} setBranch={setBranch} />}
          {view === 'Pull requests' && <PullRequestView />}
          {view === 'Activity' && <ActivityView />}
        </div>
      </main>
    </div>
  );
}

function HomeView({ repoName, branch, setView, runAction, selectedCommit, setSelectedCommit }: { repoName: string; branch: string; setView: (v: View) => void; runAction: (l: string) => void; selectedCommit: (typeof commits)[number] | null; setSelectedCommit: (c: (typeof commits)[number] | null) => void }) {
  return <div className="page home-page">
    <div className="page-heading"><div><div className="breadcrumb"><span className="crumb-dot" />{repoName}<span>/</span>{branch}</div><h1>Good morning, Georgy</h1><p>Here’s what needs your attention in <strong>{repoName}</strong>.</p></div><div className="heading-actions"><button className="ghost-button" onClick={() => setView('Branches')}><GitCompareArrows size={16} />Compare branches</button><button className="ghost-button" onClick={() => runAction('Open terminal')}><TerminalSquare size={16} />Open terminal</button></div></div>
    <section className="attention-banner"><div className="attention-leading"><div className="attention-icon"><ArrowUp size={18} /></div><div><strong>3 commits ready to push</strong><span>Your local branch is ahead of <code>origin/develop</code>. Review before sharing.</span></div></div><button className="primary-button" onClick={() => runAction('Push')}>Review & push <ArrowUp size={15} /></button></section>
    <div className="overview-grid"><StatusCard icon={<FileCode2 size={18} />} label="Local changes" value="3 files" meta="2 modified · 1 new" action="Review changes" onClick={() => setView('Changes')} tone="blue" /><StatusCard icon={<ArrowDown size={18} />} label="Remote updates" value="2 commits" meta="Available on origin/develop" action="View incoming" onClick={() => runAction('View incoming')} tone="violet" /><StatusCard icon={<CircleAlert size={18} />} label="Needs attention" value="1 check" meta="CI is failing on develop" action="See failed check" onClick={() => runAction('See failed check')} tone="amber" /></div>
    <div className="home-columns"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Shared changes across your repository</p></div><button className="text-button" onClick={() => setView('Activity')}>View all <ArrowUp size={14} className="rotate-45" /></button></div><div className="activity-list">{commits.map((commit) => <button className={selectedCommit?.sha === commit.sha ? 'activity-row selected' : 'activity-row'} key={commit.sha} onClick={() => setSelectedCommit(commit)}><div className="commit-rail"><div className="commit-dot" /><div className="commit-line" /></div><div className="commit-copy"><div className="commit-title"><strong>{commit.message}</strong><span className="branch-pill"><GitBranch size={12} />{commit.branch}</span></div><div className="commit-meta"><div className="avatar avatar-small avatar-${commit.initials.toLowerCase()}">{commit.initials}</div><span>{commit.author}</span><span>·</span><span>{commit.time}</span><span className="commit-sha">{commit.sha}</span></div></div><ChevronDown size={16} className="row-chevron" /></button>)}</div></section><section className="panel pr-panel"><div className="panel-heading"><div><h2>Pull requests</h2><p>Open work from your team</p></div><button className="icon-button" title="New pull request" onClick={() => runAction('New pull request')}><Plus size={17} /></button></div><div className="pr-list"><PRRow number="#42" title="Polish branch explorer states" author="Maya Chen" status="Ready for review" tone="green" /><PRRow number="#41" title="Refactor Git status parser" author="Noah Williams" status="Checks failing" tone="red" /></div><button className="panel-footer-action" onClick={() => setView('Pull requests')}>See all pull requests <ArrowUp size={14} className="rotate-45" /></button></section></div>
    <section className="panel branch-strip"><div className="panel-heading"><div><h2>Branch snapshot</h2><p>How your current branch relates to origin</p></div><button className="text-button" onClick={() => setView('Branches')}>Explore branches <ArrowUp size={14} className="rotate-45" /></button></div><div className="branch-comparison"><div className="comparison-branch"><span className="branch-label"><span className="status-dot green" />You are here</span><strong>{branch}</strong><span className="muted">your local work</span></div><div className="comparison-track"><div className="track-line" /><div className="track-node local"><ArrowUp size={13} /></div><div className="track-node remote"><ArrowDown size={13} /></div><div className="track-labels"><span>3 outgoing</span><span>2 incoming</span></div></div><div className="comparison-branch right"><span className="branch-label"><Cloud size={14} />Remote tracking</span><strong>origin/{branch}</strong><span className="muted">last fetched 2 min ago</span></div></div></section>
    {selectedCommit && <aside className="detail-drawer"><div className="drawer-header"><div><span className="eyebrow">Commit details</span><h2>{selectedCommit.message}</h2></div><button className="icon-button" onClick={() => setSelectedCommit(null)} aria-label="Close details"><X size={17} /></button></div><div className="drawer-meta"><div className="avatar avatar-indigo">{selectedCommit.initials}</div><div><strong>{selectedCommit.author}</strong><span>Committed {selectedCommit.time}</span></div></div><div className="drawer-code"><span>{selectedCommit.sha}</span><button className="icon-button tiny"><Copy size={14} /></button></div><div className="drawer-section"><span className="eyebrow">Changed files</span><div className="file-mini"><FileCode2 size={15} /><span>src/components/RepoHeader.tsx</span><b>+24 −8</b></div><div className="file-mini"><FileCode2 size={15} /><span>src/styles/tokens.css</span><b>+17 −3</b></div></div><button className="primary-button full" onClick={() => runAction('Open commit diff')}>Open full diff <ArrowUp size={15} /></button></aside>}
  </div>;
}

function StatusCard({ icon, label, value, meta, action, onClick, tone }: { icon: React.ReactNode; label: string; value: string; meta: string; action: string; onClick: () => void; tone: string }) { return <div className="status-card"><div className={`status-card-icon ${tone}`}>{icon}</div><span className="card-label">{label}</span><strong>{value}</strong><span className="card-meta">{meta}</span><button className="card-action" onClick={onClick}>{action}<ArrowUp size={13} className="rotate-45" /></button></div>; }
function PRRow({ number, title, author, status, tone }: { number: string; title: string; author: string; status: string; tone: string }) { return <button className="pr-row"><div className="pr-icon"><GitCompareArrows size={16} /></div><div className="pr-copy"><strong>{title}</strong><span>{number} · opened by {author}</span></div><span className={`status-tag ${tone}`}>{status}</span><ChevronDown size={15} className="rotate-270" /></button>; }
function ChangesView({ files, runAction }: { files: typeof files; runAction: (l: string) => void }) { return <div className="page"><PageTitle kicker="Working tree" title="Changes" subtitle="Review what’s different before you commit or share." actions={<><button className="ghost-button" onClick={() => runAction('Stash changes')}><Layers3 size={16} />Stash</button><button className="primary-button" onClick={() => runAction('Commit changes')}><GitCommitHorizontal size={16} />Commit changes</button></>} /><div className="change-summary"><div><strong>3 files changed</strong><span>On <code>develop</code> · unstaged</span></div><div className="diff-count"><span className="add">+36</span><span className="remove">−11</span></div></div><section className="panel changes-panel"><div className="change-tabs"><button className="selected">Unstaged <span>3</span></button><button>Staged <span>0</span></button><button>Untracked <span>1</span></button></div>{files.map((file) => <div className="change-row" key={file.path}><input type="checkbox" aria-label={`Stage ${file.path}`} /><FileCode2 size={17} /><div className="change-file"><strong>{file.path}</strong><span>{file.note}</span></div><span className={`file-state ${file.tone}`}>{file.state}</span><span className="diff-count small"><span className="add">+{file.state === 'A' ? 24 : 12}</span><span className="remove">−{file.state === 'A' ? 0 : 4}</span></span><button className="icon-button tiny" onClick={() => runAction(`Open diff for ${file.path}`)} title="Open diff"><GitCompareArrows size={15} /></button></div>)}<div className="diff-preview"><div className="diff-header"><span>Preview · RepoHeader.tsx</span><div><span className="diff-legend add">+ Added</span><span className="diff-legend remove">− Removed</span></div></div><pre><span className="line neutral">  18</span> <span className="text-muted">return (</span>{'\n'}<span className="line remove">− 19</span> <span className="remove-text">  &lt;div className="repo-header"&gt;</span>{'\n'}<span className="line add">+ 19</span> <span className="add-text">  &lt;header className="repo-header"&gt;</span>{'\n'}<span className="line add">+ 20</span> <span className="add-text">    &lt;BranchPicker /&gt;</span>{'\n'}<span className="line neutral">  21</span> <span className="text-muted">  &lt;/header&gt;</span>{'\n'}<span className="line neutral">  22</span> <span className="text-muted">);</span></pre></div></section></div>; }
function BranchesView({ branch, setBranch }: { branch: string; setBranch: (b: string) => void }) { return <div className="page"><PageTitle kicker="Repository map" title="Branches" subtitle="See local and remote work, then compare before you switch." actions={<><button className="ghost-button"><SlidersHorizontal size={16} />Filter</button><button className="primary-button"><Plus size={16} />New branch</button></>} /><div className="branch-toolbar"><div className="search-field"><Search size={16} /><input placeholder="Search branches" /></div><div className="segmented"><button className="active">All <span>8</span></button><button>Local <span>4</span></button><button>Remote <span>4</span></button></div></div><section className="panel branch-list-panel"><BranchGroup title="Local branches" branches={[['develop', 'You are here', '3↑ 2↓', '82f4e09'], ['main', 'up to date', '0↑ 0↓', 'cc8a1f4'], ['feature/onboarding', 'ahead by 4', '4↑ 0↓', 'a84c2d1']]} branch={branch} setBranch={setBranch} /><BranchGroup title="Remote branches" branches={[['origin/develop', 'tracked by develop', '', '2c47af8'], ['origin/main', 'up to date', '', 'cc8a1f4'], ['origin/release/1.4', 'updated yesterday', '', 'c09b7e2']]} branch={branch} setBranch={setBranch} remote /></section></div>; }
function BranchGroup({ title, branches, branch, setBranch, remote }: { title: string; branches: string[][]; branch: string; setBranch: (b: string) => void; remote?: boolean }) { return <div className="branch-group"><div className="group-title"><span>{title}</span><span className="muted">{branches.length} branches</span></div>{branches.map(([name, detail, counts, sha]) => <button className={name === branch || name === `origin/${branch}` ? 'branch-list-row selected' : 'branch-list-row'} key={name} onClick={() => setBranch(name.replace('origin/', ''))}><div className={`branch-icon ${remote ? 'remote' : ''}`}><GitBranch size={16} /></div><div className="branch-name"><strong>{name}</strong><span>{detail}</span></div>{counts && <span className="ahead-count">{counts}</span>}<span className="latest-sha">{sha}</span><span className="branch-time">{remote ? 'Remote' : '2 min ago'}</span><MoreHorizontal size={16} /></button>)}</div>; }
function PullRequestView() { return <div className="page"><PageTitle kicker="Collaboration" title="Pull requests" subtitle="Review shared work without losing the local context." actions={<><button className="ghost-button"><SlidersHorizontal size={16} />Filter</button><button className="primary-button"><Plus size={16} />New pull request</button></>} /><div className="pr-filters"><button className="active">Open <span>2</span></button><button>Review requested <span>1</span></button><button>Assigned to me</button><button>All</button></div><section className="panel full-pr-list"><PRDetailed number="#42" title="Polish branch explorer states" source="feature/branch-explorer" target="develop" author="Maya Chen" avatars="MC" status="Ready for review" tone="green" checks="3 checks passed" /><PRDetailed number="#41" title="Refactor Git status parser" source="refactor/status-parser" target="develop" author="Noah Williams" avatars="NW" status="Checks failing" tone="red" checks="1 check failing" /></section></div>; }
function PRDetailed({ number, title, source, target, author, avatars, status, tone, checks }: { number: string; title: string; source: string; target: string; author: string; avatars: string; status: string; tone: string; checks: string }) { return <button className="pr-detailed"><div className="pr-open-icon"><GitCompareArrows size={18} /></div><div className="pr-detail-copy"><div className="pr-title-line"><strong>{title}</strong><span>{number}</span></div><div className="pr-branch-line"><code>{source}</code><ArrowUp size={13} className="rotate-45" /><code>{target}</code></div><div className="pr-detail-meta"><div className="avatar avatar-small avatar-indigo">{avatars}</div><span>{author}</span><span>·</span><span>updated 34 min ago</span></div></div><div className="pr-detail-status"><span className={`status-tag ${tone}`}>{status}</span><span className={tone === 'red' ? 'check-fail' : 'check-pass'}>{tone === 'red' ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}{checks}</span></div><ChevronDown size={16} className="rotate-270" /></button>; }
function ActivityView() { return <div className="page"><PageTitle kicker="Shared work" title="Activity" subtitle="Commits, reviews, checks, and merges visible on the remote repository." actions={<><button className="ghost-button"><SlidersHorizontal size={16} />Filter</button><button className="ghost-button"><RefreshCw size={16} />Refresh</button></>} /><div className="activity-filters"><div className="search-field"><Search size={16} /><input placeholder="Search activity" /></div><button className="filter-pill active">All contributors <ChevronDown size={14} /></button><button className="filter-pill">All branches <ChevronDown size={14} /></button><button className="filter-pill">Last 30 days <ChevronDown size={14} /></button></div><section className="panel timeline-panel">{commits.concat([{ ...commits[0], sha: 'd1e072b', message: 'Merge pull request #40', time: '2 days ago', branch: 'main' }]).map((item, index) => <div className="timeline-row" key={`${item.sha}-${index}`}><div className="timeline-time">{item.time}</div><div className="timeline-marker"><div className="timeline-avatar avatar-${item.initials.toLowerCase()}">{item.initials}</div><div className="timeline-line" /></div><div className="timeline-content"><div><strong>{item.author}</strong><span>{item.message.toLowerCase().includes('merge') ? ' merged a pull request into ' : ' pushed a commit to '}<code>{item.branch}</code></span></div><p>{item.message}</p><span className="timeline-sha">{item.sha}</span></div></div>)}</section></div>; }
function PageTitle({ kicker, title, subtitle, actions }: { kicker: string; title: string; subtitle: string; actions?: React.ReactNode }) { return <div className="page-title"><div><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions">{actions}</div></div>; }

export default App;
