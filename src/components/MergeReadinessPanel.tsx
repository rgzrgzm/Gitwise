import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type Readiness = { label: string; blockers: string[]; checks: string; reviews: string; mergeState: string; mergeable: string; headSha: string | null; base: string | null; requirements: string[]; protectionReported: boolean; checkedAt: string };

export function MergeReadinessPanel({ repoPath, pullNumber }: { repoPath: string; pullNumber: number }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  async function refresh() {
    const id = ++requestId.current;
    setLoading(true); setError(''); setReadiness(null);
    try {
      const response = await window.branchline?.getGitHubPullRequestReadiness(repoPath, pullNumber) as { ok: boolean; readiness?: Readiness; error?: string } | undefined;
      if (id !== requestId.current) return;
      if (!response?.ok || !response.readiness) setError(response?.error || 'Merge readiness is unavailable. Open the desktop app and connect GitHub.');
      else setReadiness(response.readiness);
    } catch {
      if (id === requestId.current) setError('Could not load merge readiness. Retry or inspect this pull request on GitHub.');
    } finally { if (id === requestId.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => { requestId.current += 1; }; }, [repoPath, pullNumber]);
  return <section className="merge-readiness" aria-label="Pull request merge readiness" aria-busy={loading}>
    <div className="merge-readiness-heading"><h3>Merge readiness</h3><button type="button" className="ghost-button compact" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} />{loading ? 'Checking…' : 'Refresh readiness'}</button></div>
    {loading ? <p role="status">Checking GitHub’s current merge requirements…</p> : error ? <p className="error-text" role="alert">{error}</p> : readiness && <>
      <strong className="merge-readiness-label">{readiness.label}</strong>
      <dl className="merge-readiness-signals"><div><dt>Checks and commit statuses</dt><dd>{readiness.checks}</dd></div><div><dt>Review decision</dt><dd>{readiness.reviews}</dd></div></dl>
      {readiness.blockers.length > 0 && <ul>{readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
      {readiness.mergeState === 'UNSTABLE' && <p>Some checks are not passing. This summary does not assume every failed check is required.</p>}
      <details><summary>Reported branch requirements and technical details</summary>
        {readiness.requirements.length > 0 ? <ul>{readiness.requirements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{readiness.protectionReported ? 'No review or check requirements were reported by this classic protection rule.' : 'Classic branch-protection requirements were not reported. This does not mean the branch has no rules.'}</p>}
        <p>Target: <code>{readiness.base || 'Unknown'}</code><br />Head: <code>{readiness.headSha || 'Unknown'}</code><br />Merge state: <code>{readiness.mergeState}</code> · Conflicts: <code>{readiness.mergeable}</code></p>
      </details>
      <p className="merge-readiness-footnote">Snapshot checked {new Date(readiness.checkedAt).toLocaleTimeString()}. Additional rulesets, merge queues, deployments, and permissions may apply. This snapshot is advisory; the merge action performs its own fresh check and GitHub remains authoritative.</p>
    </>}
  </section>;
}
