import { FormEvent, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';

type BranchOption = { name: string; protected: boolean };
type CreatedPullRequest = { number: number; title: string; url: string; draft: boolean };

export function CreatePullRequestDialog({ repoPath, currentBranch, onClose, onCreated }: { repoPath: string; currentBranch: string; onClose: () => void; onCreated: () => void }) {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [defaultBranch, setDefaultBranch] = useState('');
  const [branchLoading, setBranchLoading] = useState(true);
  const [branchError, setBranchError] = useState('');
  const [branchListTruncated, setBranchListTruncated] = useState(false);
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedPullRequest | null>(null);
  const branchRequest = useRef(0);

  async function loadBranches() {
    const requestId = ++branchRequest.current;
    setBranchLoading(true); setBranchError('');
    try {
      const result = await window.branchline?.getGitHubPullRequestBranches(repoPath) as { ok: boolean; branches?: BranchOption[]; defaultBranch?: string | null; truncated?: boolean; error?: string } | undefined;
      if (requestId !== branchRequest.current) return;
      if (!result?.ok) { setBranchError(result?.error || 'Unable to load branches from GitHub.'); return; }
      const choices = result.branches || [];
      const target = result.defaultBranch && choices.some((branch) => branch.name === result.defaultBranch) ? result.defaultBranch : choices[0]?.name || '';
      const source = choices.some((branch) => branch.name === currentBranch && branch.name !== target) ? currentBranch : choices.find((branch) => branch.name !== target)?.name || '';
      setBranches(choices); setDefaultBranch(target); setBase(target); setHead(source); setBranchListTruncated(Boolean(result.truncated));
    } catch (cause) { if (requestId === branchRequest.current) setBranchError(cause instanceof Error ? cause.message : 'Unable to load branches from GitHub.'); }
    finally { if (requestId === branchRequest.current) setBranchLoading(false); }
  }

  useEffect(() => { void loadBranches(); return () => { branchRequest.current += 1; }; }, [repoPath]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !head || !base || head === base) return;
    setSubmitting(true); setError('');
    try {
      const response = await window.branchline?.createGitHubPullRequest(repoPath, { title, body, head, base, draft }) as { ok: boolean; pullRequest?: CreatedPullRequest; error?: string } | undefined;
      if (!response?.ok || !response.pullRequest) { setError(response?.error || 'GitHub could not create the pull request.'); return; }
      setCreated(response.pullRequest); onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'GitHub could not create the pull request.'); }
    finally { setSubmitting(false); }
  }

  return <div className="confirm-overlay create-pr-overlay" role="dialog" aria-modal="true" aria-labelledby="create-pr-title">
    <section className="create-pr-dialog">
      <div className="panel-heading"><div><span className="eyebrow">GitHub · {repoPath.split(/[\\/]/).pop()}</span><h2 id="create-pr-title">{created ? 'Pull request created' : 'Create a pull request'}</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={submitting} aria-label="Close create pull request dialog"><X size={16} /></button></div>
      {created ? <div className="create-pr-success"><span className="status-tag green">{created.draft ? 'Draft' : 'Ready for review'} · #{created.number}</span><h3>{created.title}</h3><p>GitHub created this pull request. Its protections and review requirements are managed on GitHub.</p><div className="create-pr-actions"><button type="button" className="ghost-button" onClick={onClose}>Close</button><button type="button" className="primary-button" onClick={() => void window.branchline?.openGitHubUrl(created.url)}>Open on GitHub <ExternalLink size={14} /></button></div></div> : branchLoading ? <p className="check-empty" role="status">Loading branches from GitHub…</p> : branchError ? <div className="create-pr-error"><p className="error-text" role="alert">{branchError}</p><button type="button" className="ghost-button" onClick={() => void loadBranches()}><RefreshCw size={14} />Retry</button></div> : <form className="create-pr-form" onSubmit={(event) => void submit(event)}>
        <p className="create-pr-intro">Compare two branches already published to this repository. This creates a GitHub pull request; it does not push local commits.</p>
        <div className="create-pr-branch-grid"><label>Source branch<select required value={head} onChange={(event) => setHead(event.target.value)}><option value="">Choose source</option>{branches.map((branch) => <option key={branch.name} value={branch.name} disabled={branch.name === base}>{branch.name}{branch.name === currentBranch ? ' · current local branch' : ''}{branch.protected ? ' · protected' : ''}</option>)}</select></label><span className="create-pr-arrow" aria-hidden="true">→</span><label>Target branch<select required value={base} onChange={(event) => setBase(event.target.value)}><option value="">Choose target</option>{branches.map((branch) => <option key={branch.name} value={branch.name} disabled={branch.name === head}>{branch.name}{branch.name === defaultBranch ? ' · default' : ''}{branch.protected ? ' · protected' : ''}</option>)}</select></label></div>
        {head && base && head === base && <p className="error-text" role="alert">Choose two different branches.</p>}
        {branchListTruncated && <p className="create-pr-note">Showing the first 500 branches. If a branch is missing, reduce the repository’s branch count and reload.</p>}
        <label className="create-pr-field">Title<input required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Summarize the proposed change" autoFocus /></label>
        <label className="create-pr-field">Description <span className="muted">optional</span><textarea maxLength={65536} rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="What changed, and why?" /></label>
        <label className="create-pr-draft"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /><span><strong>Create as draft</strong><small>Use this while the work is still in progress. You can mark it ready later on GitHub.</small></span></label>
        {error && <p className="create-pr-error-text" role="alert">{error}</p>}
        <p className="create-pr-note">The source branch must already exist on this repository’s GitHub remote. Cross repository fork pull requests are not supported in this form.</p>
        <div className="create-pr-actions"><button type="button" className="ghost-button" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || !title.trim() || !head || !base || head === base}>{submitting ? 'Creating…' : draft ? 'Create draft pull request' : 'Create pull request'}</button></div>
      </form>}
    </section>
  </div>;
}
