import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type Method = 'merge' | 'squash' | 'rebase';
type MergeOptions = {
  ok: boolean;
  error?: string;
  methods?: Method[];
  ready?: boolean;
  pullRequest?: { number: number; title: string; state: string; draft: boolean; headSha: string; head: string; base: string };
  readiness?: { label: string; blockers: string[]; mergeState: string; mergeable: string };
};
type MergeResult = { status: 'pending' | 'merged' | 'enqueued' | 'unknown' | 'failed'; uuid?: string; sha?: string | null; message?: string | null };

const methodLabels: Record<Method, string> = { merge: 'Create a merge commit', squash: 'Squash and merge', rebase: 'Rebase and merge' };

export function PullRequestMergePanel({ repoPath, pullNumber, title, url }: { repoPath: string; pullNumber: number; title: string; url: string }) {
  const [options, setOptions] = useState<MergeOptions | null>(null);
  const [method, setMethod] = useState<Method>('merge');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MergeResult | null>(null);
  const [pollCount, setPollCount] = useState(0);

  async function refreshOptions() {
    setLoading(true); setError(''); setOptions(null); setResult(null); setConfirmation(false); setPollCount(0);
    try {
      const next = await window.branchline?.getGitHubPullRequestMergeOptions(repoPath, pullNumber) as MergeOptions | undefined;
      if (!next?.ok) { setOptions(null); setError(next?.error || 'Unable to check available merge methods.'); return; }
      setOptions(next);
      if (next.methods?.length && !next.methods.includes(method)) setMethod(next.methods[0]);
    } catch (cause) { setOptions(null); setError(cause instanceof Error ? cause.message : 'Unable to check available merge methods.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refreshOptions(); }, [repoPath, pullNumber]);

  useEffect(() => {
    if (result?.status !== 'pending' || !result.uuid || pollCount >= 30) return;
    const timeout = window.setTimeout(async () => {
      const next = await window.branchline?.getGitHubPullRequestMergeResult(repoPath, pullNumber, result.uuid!) as { ok: boolean; status?: string; sha?: string | null; message?: string | null; error?: string } | undefined;
      if (!next?.ok) { setError(next?.error || 'Unable to check the merge result. Check GitHub before retrying.'); setResult({ status: 'unknown', uuid: result.uuid }); return; }
      setPollCount((count) => count + 1);
      if (next.status === 'merged' || next.status === 'enqueued' || next.status === 'failed') setResult({ status: next.status, uuid: result.uuid, sha: next.sha, message: next.message });
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [result, pollCount, repoPath, pullNumber]);

  async function submitMerge() {
    if (!options?.ready || !options.methods?.includes(method) || submitting) return;
    setSubmitting(true); setError(''); setConfirmation(false); setResult(null); setPollCount(0);
    try {
      const response = await window.branchline?.mergeGitHubPullRequest(repoPath, pullNumber, method) as { ok: boolean; status?: MergeResult['status']; uuid?: string; sha?: string | null; message?: string; error?: string } | undefined;
      if (!response?.ok) { setError(response?.error || 'GitHub did not merge this pull request. Refresh readiness and try again.'); return; }
      setResult({ status: response.status || 'unknown', uuid: response.uuid, sha: response.sha, message: response.message });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to merge this pull request. Check GitHub before retrying.'); }
    finally { setSubmitting(false); }
  }

  const canMerge = Boolean(options?.ready && options.methods?.length && options.methods.includes(method));
  return <section className="pr-merge-panel" aria-label="Merge pull request" aria-busy={loading || submitting}>
    <div className="pr-merge-heading"><div><span className="eyebrow">Remote action</span><h3>Merge pull request</h3></div><button className="ghost-button compact" type="button" onClick={() => void refreshOptions()} disabled={loading || submitting}><RefreshCw size={14} />{loading ? 'Checking…' : 'Refresh readiness'}</button></div>
    {loading ? <p role="status">Checking GitHub’s current rules and enabled merge methods…</p> : error && !options ? <p className="error-text" role="alert">{error}</p> : options && <>
      <p className="pr-merge-destination"><strong>#{pullNumber} {title}</strong><br />Remote base branch: <code>{options.pullRequest?.base || 'unknown'}</code></p>
      {options.methods?.length ? <label className="pr-merge-method">Merge method<select value={method} onChange={(event) => setMethod(event.target.value as Method)} disabled={submitting || !options.ready}>{options.methods.map((item) => <option key={item} value={item}>{methodLabels[item]}</option>)}</select></label> : <p className="error-text">GitHub reports that all standard merge methods are disabled for this repository.</p>}
      {!options.ready && <div className="pr-merge-blockers"><strong>{options.readiness?.label || 'Not ready to merge'}</strong>{options.readiness?.blockers?.length ? <ul>{options.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p>GitHub does not currently report a clean, mergeable pull request. Refresh readiness after resolving any blockers.</p>}</div>}
      {error && <p className="connection-error" role="alert">{error}</p>}
      {result && <div className={result.status === 'merged' ? 'pr-merge-result success' : result.status === 'failed' ? 'pr-merge-result failure' : 'pr-merge-result'} role={result.status === 'failed' ? 'alert' : 'status'}><strong>{result.status === 'merged' ? 'Merged on GitHub' : result.status === 'enqueued' ? 'Added to GitHub merge queue' : result.status === 'pending' ? `Merge request in progress${pollCount >= 30 ? ' · still processing' : '…'}` : result.status === 'failed' ? 'GitHub could not complete the merge' : 'Merge status needs confirmation'}</strong><span>{result.message || (result.status === 'enqueued' ? 'This is queued, not merged yet.' : result.status === 'unknown' ? 'Check the pull request on GitHub before retrying.' : '')}</span>{result.sha && <code>Merge commit {result.sha.slice(0, 12)}</code>}{(result.status === 'merged' || result.status === 'enqueued' || result.status === 'unknown' || result.status === 'failed') && <button className="text-button" type="button" onClick={() => void window.branchline?.openGitHubUrl(url)}>Open pull request on GitHub</button>}</div>}
      {options.ready && !result && !confirmation && <button className="primary-button" type="button" disabled={!canMerge || submitting} onClick={() => setConfirmation(true)}>Review merge</button>}
      {confirmation && <div className="pr-merge-confirm" role="group" aria-label="Confirm remote pull request merge"><p>This will merge <strong>#{pullNumber} {title}</strong> into <code>{options.pullRequest?.base}</code> on GitHub using <strong>{methodLabels[method]}</strong>. This changes the remote repository; it does not switch or merge your local branch.</p><div><button className="ghost-button" type="button" onClick={() => setConfirmation(false)} disabled={submitting}>Cancel</button><button className="primary-button" type="button" onClick={() => void submitMerge()} disabled={!canMerge || submitting}>{submitting ? 'Submitting to GitHub…' : 'Confirm merge'}</button></div></div>}
      <p className="pr-merge-footnote">Gitwise rechecks state and readiness immediately before sending the request. GitHub’s rules and permissions remain authoritative; Gitwise never bypasses them.</p>
    </>}
  </section>;
}
