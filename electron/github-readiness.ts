import https from 'node:https';

type PullSnapshot = {
  state?: string; isDraft?: boolean; headRefOid?: string; baseRefName?: string;
  mergeable?: string; mergeStateStatus?: string; reviewDecision?: string | null;
  statusCheckRollup?: { state?: string } | null;
  baseRef?: { branchProtectionRule?: Record<string, unknown> | null } | null;
};

// Report GitHub's snapshot, never infer merge authorization or bypass rules.
export function summarizeReadiness(pull: PullSnapshot) {
  const blockers: string[] = [];
  const state = pull.mergeStateStatus || 'UNKNOWN';
  if (pull.isDraft || state === 'DRAFT') blockers.push('Mark this draft ready for review before merging.');
  if (pull.mergeable === 'CONFLICTING' || state === 'DIRTY') blockers.push('Resolve conflicts between the source and target branches.');
  if (state === 'BEHIND') blockers.push('Update the source branch with the latest target-branch changes.');
  if (pull.reviewDecision === 'CHANGES_REQUESTED') blockers.push('A reviewer requested changes. Address their feedback and request another review.');
  if (pull.reviewDecision === 'REVIEW_REQUIRED') blockers.push('GitHub reports that required reviews are still missing.');
  if (state === 'BLOCKED') blockers.push('GitHub reports unmet merge requirements. Open the pull request for the complete rule details.');
  const checks = pull.statusCheckRollup?.state || 'UNKNOWN';
  const checksLabel = checks === 'SUCCESS' ? 'Passing' : checks === 'PENDING' || checks === 'EXPECTED' ? 'Waiting for results' : checks === 'FAILURE' || checks === 'ERROR' ? 'Not passing' : 'Not reported';
  let label = 'Readiness unknown';
  if (pull.state === 'MERGED') label = 'Already merged';
  else if (pull.state === 'CLOSED') label = 'Pull request closed';
  else if (blockers.length) label = 'Needs attention';
  else if (state === 'UNSTABLE') label = 'Checks need attention';
  else if (state === 'HAS_HOOKS') label = 'Server hooks must be checked';
  else if (pull.state === 'OPEN' && state === 'CLEAN' && pull.mergeable === 'MERGEABLE' && !['FAILURE', 'ERROR', 'PENDING', 'EXPECTED'].includes(checks)) label = 'GitHub reports a clean merge';
  if (pull.state === 'MERGED' || pull.state === 'CLOSED') blockers.length = 0;
  return { label, blockers, checks: checksLabel, reviews: pull.reviewDecision === 'APPROVED' ? 'Approved' : pull.reviewDecision === 'REVIEW_REQUIRED' ? 'Required reviews missing' : pull.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Requirements not reported', mergeState: state, mergeable: pull.mergeable || 'UNKNOWN', headSha: pull.headRefOid || null, base: pull.baseRefName || null };
}

const query = `query GitwiseReadiness($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft headRefOid baseRefName mergeable mergeStateStatus reviewDecision
      statusCheckRollup { state }
      baseRef { branchProtectionRule {
        requiresApprovingReviews requiredApprovingReviewCount requiresCodeOwnerReviews
        requiresStatusChecks requiresStrictStatusChecks requiredStatusCheckContexts
        requiresConversationResolution
      } }
    }
  }
}`;

export async function fetchReadiness(token: string, owner: string, name: string, number: number) {
  const payload = JSON.stringify({ query, variables: { owner, name, number } });
  const response = await new Promise<{ status: number; body: unknown }>((resolve) => {
    const request = https.request({ hostname: 'api.github.com', path: '/graphql', method: 'POST', headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Gitwise', 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { raw += chunk; if (raw.length > 1024 * 1024) request.destroy(); });
      res.on('error', () => resolve({ status: 0, body: null }));
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode || 0, body: null }); } });
    });
    const deadline = setTimeout(() => request.destroy(), 20000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', () => resolve({ status: 0, body: null }));
    request.end(payload);
  });
  if (response.status !== 200) return { ok: false, error: response.status === 0 ? 'GitHub could not be reached. Check your connection and retry.' : response.status === 401 ? 'Reconnect GitHub with a valid token.' : response.status === 403 || response.status === 429 ? 'GitHub denied this request or limited API access. Check token permissions and retry later.' : 'GitHub could not load merge readiness.' };
  const body = response.body as { errors?: unknown[]; data?: { repository?: { pullRequest?: PullSnapshot } } } | null;
  // Partial GraphQL results can omit security-relevant fields. Fail closed.
  if (body?.errors?.length) return { ok: false, error: 'Readiness is unknown: GitHub could not expose all requested fields. Check repository access and token permissions, or inspect the pull request on GitHub.' };
  const pull = body?.data?.repository?.pullRequest;
  if (!pull?.state || !pull.headRefOid || !pull.mergeStateStatus || !pull.mergeable) return { ok: false, error: 'GitHub returned incomplete merge readiness. Refresh or inspect the pull request on GitHub.' };
  const protection = pull.baseRef?.branchProtectionRule;
  const requirements: string[] = [];
  if (protection?.requiresApprovingReviews) requirements.push(`${typeof protection.requiredApprovingReviewCount === 'number' ? protection.requiredApprovingReviewCount : 'Required'} approving reviews required`);
  if (protection?.requiresCodeOwnerReviews) requirements.push('Code-owner review required');
  if (protection?.requiresConversationResolution) requirements.push('Review conversations must be resolved');
  if (protection?.requiresStrictStatusChecks) requirements.push('Source branch must be up to date');
  if (protection?.requiresStatusChecks) {
    const names = Array.isArray(protection.requiredStatusCheckContexts) ? protection.requiredStatusCheckContexts.filter((value): value is string => typeof value === 'string') : [];
    requirements.push(names.length ? `Required checks: ${names.join(', ')}` : 'Required checks configured');
  }
  return { ok: true, readiness: { ...summarizeReadiness(pull), requirements, protectionReported: Boolean(protection), checkedAt: new Date().toISOString() } };
}
