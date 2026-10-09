import { useState, type FormEvent } from 'react';
import { MessageSquarePlus, X } from 'lucide-react';

type DiffRow = { id: number; kind: 'hunk' | 'added' | 'deleted' | 'context' | 'meta'; text: string; line?: number; side?: 'LEFT' | 'RIGHT' };

function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let seenHunk = false;
  patch.split(/\r?\n/).filter((line, index, all) => !(index === all.length - 1 && line === '')).forEach((text, id) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); seenHunk = true; rows.push({ id, kind: 'hunk', text }); return; }
    if (text.startsWith('diff --git') || text.startsWith('index ') || !seenHunk && (text.startsWith('+++ ') || text.startsWith('--- '))) { rows.push({ id, kind: 'meta', text }); return; }
    if (text.startsWith('+')) { rows.push({ id, kind: 'added', text, line: newLine, side: 'RIGHT' }); newLine += 1; return; }
    if (text.startsWith('-')) { rows.push({ id, kind: 'deleted', text, line: oldLine, side: 'LEFT' }); oldLine += 1; return; }
    if (text.startsWith(' ')) { rows.push({ id, kind: 'context', text, line: newLine, side: 'RIGHT' }); oldLine += 1; newLine += 1; return; }
    rows.push({ id, kind: 'meta', text });
  });
  return rows;
}

export function PullRequestInlineDiff({ repoPath, pullNumber, filePath, patch, canComment }: { repoPath: string; pullNumber: number; filePath: string; patch: string; canComment: boolean }) {
  const rows = parsePatch(patch);
  const [selected, setSelected] = useState<DiffRow | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [posted, setPosted] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected?.line || !selected.side || !body.trim() || busy) return;
    setBusy(true); setError(''); setPosted('');
    try {
      const result = await window.branchline?.createGitHubPullRequestInlineComment(repoPath, pullNumber, filePath, selected.line, selected.side, body) as { ok: boolean; confirmed?: boolean; comment?: { id: string | number; title: string; author?: string; date?: string | null; url?: string | null; body?: string }; error?: string } | undefined;
      if (!result?.ok || !result.comment) { setError(result?.error || 'GitHub could not post this line comment.'); return; }
      window.dispatchEvent(new CustomEvent('gitwise:pull-request-inline-comment-posted', { detail: { repoPath, pullNumber, comment: result.comment } }));
      setPosted(result.confirmed ? 'Inline comment posted.' : (result.error || 'GitHub accepted the comment. Refresh inline comments to confirm.'));
      setBody(''); setSelected(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'GitHub could not post this line comment.'); }
    finally { setBusy(false); }
  }

  if (!patch.trim()) return <p className="pull-content-empty">GitHub did not provide a text diff for this file, so line comments are unavailable.</p>;
  return <div className="pr-inline-diff-wrap"><div className="pr-inline-diff" role="list" aria-label={`Changed lines in ${filePath}`}>
    {rows.map((row) => <div className={`pr-inline-diff-row ${row.kind}`} role="listitem" key={row.id}><span className="pr-inline-line-number">{row.line || ''}</span><code title={row.text}>{row.text || ' '}</code>{canComment && (row.kind === 'added' || row.kind === 'deleted') && <button className="pr-inline-comment-button" type="button" aria-label={`Comment on ${row.kind} line ${row.line}`} onClick={() => { setSelected(row); setBody(''); setError(''); setPosted(''); }}><MessageSquarePlus size={13} /><span>Comment</span></button>}</div>)}
  </div>{selected && <form className="pr-inline-comment-form" onSubmit={(event) => void submit(event)}><div className="pr-inline-comment-target"><strong>{filePath}</strong><span>{selected.kind === 'added' ? 'Added' : 'Deleted'} line {selected.line} · {selected.side === 'RIGHT' ? 'new version' : 'old version'}</span><button type="button" className="icon-button" aria-label="Cancel inline comment" disabled={busy} onClick={() => setSelected(null)}><X size={14} /></button></div><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={65536} rows={3} autoFocus placeholder="Write a comment about this line…" aria-label="Inline review comment" />{error && <p className="pull-comment-error" role="alert">{error}</p>}<div className="pull-comment-footer"><span>Posted to GitHub on the latest pull-request diff.</span><button type="submit" className="primary-button" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Post line comment'}</button></div></form>}{posted && <p className="pull-comment-success" role="status">{posted}</p>}{!canComment && <p className="pr-inline-readonly">This pull request is closed; line comments are read-only.</p>}</div>;
}
