const { test } = require('node:test');
const assert = require('node:assert/strict');
const { submitGroupedReview } = require('../dist-electron/github-review.js');

const prefix = '/repos/acme/gitwise';
const secret = 'test-token-do-not-return';
const headSha = 'current-head-sha';
const comments = [
  { path: 'src/auth.ts', line: 18, side: 'RIGHT', body: 'Check this token guard.' },
  { path: 'src/legacy.ts', line: 9, side: 'LEFT', body: 'This removed branch still matters.' }
];
const ok = (body) => ({ ok: true, status: 200, body });
const failure = (status, body = {}) => ({ ok: false, status, body });

function harness({ replies: replyOverride, event = 'COMMENT', body = 'Please consider these notes.', comments: reviewComments = comments, dependencies = {} } = {}) {
  const calls = [];
  const replies = [...(replyOverride || [
    ok({ state: 'open', head: { sha: headSha } }),
    ok({ id: 77, state: 'COMMENTED', body: 'Please consider these notes.', user: { login: 'reviewer' }, submitted_at: '2026-10-09T18:00:00Z' }),
    ok([
      { id: 201, pull_request_review_id: 77, path: 'src/auth.ts', line: 18, side: 'RIGHT', body: comments[0].body },
      { id: 202, pull_request_review_id: 77, path: 'src/legacy.ts', line: 9, side: 'LEFT', body: comments[1].body },
      { id: 199, pull_request_review_id: 66, path: 'elsewhere.ts', line: 1, side: 'RIGHT', body: 'An older comment.' }
    ])
  ])];
  const result = submitGroupedReview({
    prefix, token: secret, number: 42, event, body, comments: reviewComments,
    request: async (...args) => { calls.push(args); return replies.shift() || failure(500); },
    validPath: (candidate) => typeof candidate === 'string' && !candidate.startsWith('/') && !candidate.split('/').includes('..'),
    apiError: (status) => `HTTP ${status}`,
    normalizeReview: (review, event) => ({ id: review.id, event }),
    normalizeComments: (items) => items.map(({ id, path, line, side, body }) => ({ id, path, line, side, body })),
    ...dependencies
  });
  return { result, calls };
}

test('one grouped review submits comments across files and both diff sides against the latest head', async () => {
  const { result, calls } = harness();
  const submitted = await result;
  assert.equal(submitted.ok, true);
  assert.equal(submitted.confirmed, true);
  assert.deepEqual(submitted.review, { id: 77, event: 'COMMENT' });
  assert.deepEqual(submitted.comments.map(({ id }) => id), [201, 202]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 3), [`${prefix}/pulls/42`, secret, 'GET']);
  assert.equal(calls[1][0], `${prefix}/pulls/42/reviews`);
  assert.equal(calls[1][2], 'POST');
  assert.deepEqual(calls[1][3], { commit_id: headSha, event: 'COMMENT', body: 'Please consider these notes.', comments });
  assert.match(calls[2][0], /sort=created&direction=desc/);
  assert.doesNotMatch(JSON.stringify(submitted), new RegExp(secret));
});

test('invalid inline comments are rejected before any GitHub request', async () => {
  const { result } = harness({ comments: [{ path: '../secrets.txt', line: 1, side: 'RIGHT', body: 'bad path' }] });
  const response = await result;
  assert.equal(response.ok, false);
  assert.match(response.error, /invalid file/);
});

test('a pull request closed before confirmation is not submitted', async () => {
  const { result, calls } = harness({ replies: [ok({ state: 'closed', head: { sha: headSha } })] });
  const response = await result;
  assert.equal(response.ok, false);
  assert.match(response.error, /no longer open/);
  assert.equal(calls.length, 1);
});

test('latest head is required before submission', async () => {
  const { result, calls } = harness({ replies: [ok({ state: 'open', head: {} })] });
  const response = await result;
  assert.equal(response.ok, false);
  assert.match(response.error, /latest commit/);
  assert.equal(calls.length, 1);
});

test('permission and stale-diff rejections remain actionable and do not trigger refresh lookup', async () => {
  for (const [status, expected] of [[403, /Pull requests: Write/], [422, /Refresh and try again/]]) {
    const { result, calls } = harness({ replies: [ok({ state: 'open', head: { sha: headSha } }), failure(status)] });
    const response = await result;
    assert.equal(response.ok, false);
    assert.match(response.error, expected);
    assert.equal(calls.length, 2);
  }
});

test('review acceptance is preserved if confirming comments fails afterward', async () => {
  const { result } = harness({ replies: [ok({ state: 'open', head: { sha: headSha } }), ok({ id: 77, state: 'APPROVED', user: { login: 'reviewer' } }), failure(503)] });
  const response = await result;
  assert.equal(response.ok, true);
  assert.equal(response.confirmed, false);
  assert.match(response.error, /review was submitted/);
  assert.deepEqual(response.comments, []);
  assert.doesNotMatch(JSON.stringify(response), /test-token/);
});

test('approval without comments accepts an empty summary and skips comment lookup', async () => {
  const { result, calls } = harness({
    event: 'APPROVE', body: '', comments: [],
    replies: [ok({ state: 'open', head: { sha: headSha } }), ok({ id: 78, state: 'APPROVED', user: { login: 'reviewer' } })]
  });
  const response = await result;
  assert.equal(response.ok, true);
  assert.equal(response.confirmed, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][3], { commit_id: headSha, event: 'APPROVE' });
});
