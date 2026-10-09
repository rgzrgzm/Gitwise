export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export type ReviewComment = { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string };
type ApiResponse = { ok: boolean; status: number; body: unknown };
type ReviewPayload = Record<string, unknown>;

type SubmitDependencies = {
  prefix: string;
  token: string;
  number: number;
  event: unknown;
  body: unknown;
  comments: unknown;
  request: (path: string, token: string, method?: string, payload?: unknown) => Promise<ApiResponse>;
  validPath: (path: string) => boolean;
  apiError: (status: number, body: unknown) => string;
  normalizeReview: (review: Record<string, unknown>, event: ReviewEvent) => ReviewPayload;
  normalizeComments: (comments: Record<string, unknown>[]) => ReviewPayload[];
};

export async function submitGroupedReview(deps: SubmitDependencies) {
  const { prefix, token, number, event, body, comments: candidateComments, request } = deps;
  if (event !== 'COMMENT' && event !== 'APPROVE' && event !== 'REQUEST_CHANGES') return { ok: false, error: 'Choose comment, approve, or request changes.' };
  if (typeof body !== 'string' || body.length > 65536 || (event !== 'APPROVE' && !body.trim())) return { ok: false, error: event === 'APPROVE' ? 'The review summary must be 65,536 characters or fewer.' : 'Add a summary before submitting a comment or requesting changes.' };
  if (!Array.isArray(candidateComments) || candidateComments.length > 50) return { ok: false, error: 'A grouped review can include up to 50 inline comments.' };

  const comments: ReviewComment[] = [];
  for (const candidate of candidateComments) {
    if (!candidate || typeof candidate !== 'object') return { ok: false, error: 'One of the review comments is invalid.' };
    const item = candidate as Record<string, unknown>;
    if (typeof item.path !== 'string' || !deps.validPath(item.path) || typeof item.line !== 'number' || !Number.isInteger(item.line) || item.line < 1 || item.line > 2000000 || (item.side !== 'LEFT' && item.side !== 'RIGHT') || typeof item.body !== 'string' || !item.body.trim() || item.body.length > 65536) return { ok: false, error: 'One of the review comments has an invalid file, line, side, or message.' };
    comments.push({ path: item.path, line: item.line, side: item.side, body: item.body.trim() });
  }

  const current = await request(`${prefix}/pulls/${number}`, token, 'GET');
  if (!current.ok) return { ok: false, error: deps.apiError(current.status, current.body) };
  const pull = current.body as Record<string, unknown> | null;
  const head = pull?.head as Record<string, unknown> | null;
  if (!pull || pull.state !== 'open') return { ok: false, error: 'This pull request is no longer open. Refresh it before submitting a review.' };
  if (typeof head?.sha !== 'string') return { ok: false, error: 'GitHub did not provide the latest commit. Refresh the pull request and try again.' };

  const submittedEvent = event as ReviewEvent;
  const response = await request(`${prefix}/pulls/${number}/reviews`, token, 'POST', {
    commit_id: head.sha,
    event: submittedEvent,
    ...(body.trim() ? { body: body.trim() } : {}),
    ...(comments.length ? { comments } : {})
  });
  if (!response.ok) {
    if (response.status === 403) return { ok: false, error: 'GitHub denied this review. Check repository write access, organization approval, and Pull requests: Write permission.' };
    if (response.status === 422) return { ok: false, error: 'GitHub could not submit this review. You may not be able to review this pull request, or its state may have changed. Refresh and try again.' };
    return { ok: false, error: deps.apiError(response.status, response.body) };
  }
  const review = response.body as Record<string, unknown> | null;
  if (!review || typeof review.id !== 'number') return { ok: true, confirmed: false, error: 'GitHub accepted the review but returned incomplete details. Refresh the reviews section to confirm submission.' };
  const normalizedReview = deps.normalizeReview(review, submittedEvent);
  if (!comments.length) return { ok: true, confirmed: true, review: normalizedReview, comments: [] };

  const commentResponse = await request(`${prefix}/pulls/${number}/comments?per_page=100&page=1&sort=created&direction=desc`, token, 'GET');
  if (!commentResponse.ok || !Array.isArray(commentResponse.body)) return { ok: true, confirmed: false, error: 'The review was submitted. Refresh inline comments to confirm the grouped notes.', review: normalizedReview, comments: [] };
  const related = (commentResponse.body as Record<string, unknown>[]).filter((comment) => comment.pull_request_review_id === review.id);
  return { ok: true, confirmed: true, review: normalizedReview, comments: deps.normalizeComments(related) };
}
