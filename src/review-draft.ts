export type ReviewDiffSide = 'LEFT' | 'RIGHT';
export type ReviewDraftComment = { id: string; path: string; line: number; side: ReviewDiffSide; body: string };
export type ReviewCommentPayload = Omit<ReviewDraftComment, 'id'>;
export type ReviewDecision = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export function stageReviewComment(current: ReviewDraftComment[], comment: ReviewCommentPayload, id: string): ReviewDraftComment[] {
  const body = comment.body.trim();
  if (!id || !comment.path.trim() || !Number.isInteger(comment.line) || comment.line < 1 || !body) return current;
  return [...current, { ...comment, body, id }];
}

export function removeReviewComment(current: ReviewDraftComment[], id: string): ReviewDraftComment[] {
  return current.filter((comment) => comment.id !== id);
}

export function toReviewCommentPayload(comments: ReviewDraftComment[]): ReviewCommentPayload[] {
  return comments.map(({ path, line, side, body }) => ({ path, line, side, body }));
}

export async function submitReviewDraft<T>(input: {
  repositoryPath: string;
  pullNumber: number;
  decision: ReviewDecision;
  summary: string;
  comments: ReviewDraftComment[];
}, bridge: (repositoryPath: string, pullNumber: number, decision: ReviewDecision, summary: string, comments: ReviewCommentPayload[]) => Promise<T>): Promise<T> {
  return bridge(input.repositoryPath, input.pullNumber, input.decision, input.summary, toReviewCommentPayload(input.comments));
}
