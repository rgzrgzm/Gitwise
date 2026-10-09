import { FormEvent, useState } from 'react';
import { Send } from 'lucide-react';

type Comment = { id: string | number; title: string; author?: string; date?: string | null; url?: string | null; body?: string };

export function PullRequestCommentForm({ repoPath, pullNumber, onPosted }: { repoPath: string; pullNumber: number; onPosted: (comment: Comment) => void }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [posted, setPosted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true); setError(''); setPosted(false);
    try {
      const result = await window.branchline?.createGitHubPullRequestComment(repoPath, pullNumber, body) as { ok: boolean; comment?: Comment; error?: string } | undefined;
      if (!result?.ok || !result.comment) { setError(result?.error || 'GitHub could not post this comment.'); return; }
      setBody(''); setPosted(true); onPosted(result.comment);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'GitHub could not post this comment.'); }
    finally { setSending(false); }
  }

  return <form className="pull-comment-form" onSubmit={(event) => void submit(event)}>
    <label htmlFor={`pull-comment-${pullNumber}`}>Add to the discussion</label>
    <textarea id={`pull-comment-${pullNumber}`} value={body} onChange={(event) => { setBody(event.target.value); setPosted(false); }} maxLength={65536} rows={3} placeholder="Write a comment… (Markdown supported)" aria-describedby={`pull-comment-help-${pullNumber}`} />
    <div className="pull-comment-footer"><span id={`pull-comment-help-${pullNumber}`}>Visible to everyone with access to this pull request.</span><button type="submit" className="primary-button" disabled={sending || !body.trim()}><Send size={14} />{sending ? 'Posting…' : 'Comment'}</button></div>
    {error && <p className="pull-comment-error" role="alert">{error}</p>}
    {posted && <p className="pull-comment-success" role="status">Comment posted.</p>}
  </form>;
}
