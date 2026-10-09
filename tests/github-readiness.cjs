const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeReadiness } = require('../dist-electron/github-readiness.js');
const clean = { state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: { state: 'SUCCESS' } };

test('a clean snapshot is not described as merge authorization', () => {
  const result = summarizeReadiness(clean);
  assert.equal(result.label, 'GitHub reports a clean merge');
  assert.equal(result.reviews, 'Requirements not reported');
});
test('required reviews override an apparently clean merge state', () => {
  const result = summarizeReadiness({ ...clean, reviewDecision: 'REVIEW_REQUIRED' });
  assert.equal(result.label, 'Needs attention');
  assert.match(result.blockers.join(' '), /reviews/);
});
test('conflicts, outdated branches, drafts, and requested changes are explained', () => {
  for (const snapshot of [{ ...clean, mergeable: 'CONFLICTING' }, { ...clean, mergeStateStatus: 'BEHIND' }, { ...clean, isDraft: true }, { ...clean, reviewDecision: 'CHANGES_REQUESTED' }]) {
    const result = summarizeReadiness(snapshot);
    assert.equal(result.label, 'Needs attention');
    assert.ok(result.blockers.length);
  }
});
test('pending or failed checks cannot produce a clean label', () => {
  for (const state of ['PENDING', 'EXPECTED', 'FAILURE', 'ERROR']) assert.notEqual(summarizeReadiness({ ...clean, statusCheckRollup: { state } }).label, 'GitHub reports a clean merge');
});
test('unknown mergeability remains unknown and absent checks are not passing', () => {
  assert.equal(summarizeReadiness({ ...clean, mergeable: 'UNKNOWN' }).label, 'Readiness unknown');
  assert.equal(summarizeReadiness({}).checks, 'Not reported');
});
test('closed and merged PRs do not offer actionable blockers', () => {
  for (const state of ['CLOSED', 'MERGED']) assert.deepEqual(summarizeReadiness({ ...clean, state, isDraft: true }).blockers, []);
});

test('GraphQL failures and partial responses stay unknown without leaking API messages', async () => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const { fetchReadiness } = require('../dist-electron/github-readiness.js');
  const originalRequest = https.request;
  let responseBody;
  let status = 200;
  https.request = (options, receive) => {
    assert.equal(options.hostname, 'api.github.com');
    assert.equal(options.path, '/graphql');
    const request = new EventEmitter();
    request.destroy = () => { request.emit('error', new Error('transport')); request.emit('close'); };
    request.end = (payload) => {
      const parsed = JSON.parse(payload);
      assert.deepEqual(parsed.variables, { owner: 'owner', name: 'repo', number: 42 });
      assert.match(parsed.query, /^query GitwiseReadiness/);
      queueMicrotask(() => {
        const response = new EventEmitter(); response.setEncoding = () => {}; response.statusCode = status;
        receive(response); response.emit('data', JSON.stringify(responseBody)); response.emit('end'); request.emit('close');
      });
    };
    return request;
  };
  try {
    const pull = { ...clean, headRefOid: 'abc123', baseRefName: 'main', baseRef: { branchProtectionRule: null } };
    responseBody = { data: { repository: { pullRequest: pull } }, errors: [{ message: 'sensitive API error' }] };
    const partial = await fetchReadiness('secret-token', 'owner', 'repo', 42);
    assert.equal(partial.ok, false); assert.doesNotMatch(JSON.stringify(partial), /sensitive API error|secret-token/);
    status = 403;
    assert.equal((await fetchReadiness('secret-token', 'owner', 'repo', 42)).ok, false);
    status = 200; responseBody = { data: { repository: null } };
    assert.equal((await fetchReadiness('secret-token', 'owner', 'repo', 42)).ok, false);
    responseBody = { data: { repository: { pullRequest: pull } } };
    const result = await fetchReadiness('secret-token', 'owner', 'repo', 42);
    assert.equal(result.ok, true);
    assert.equal(result.readiness.protectionReported, false);
    assert.deepEqual(result.readiness.requirements, []);
  } finally { https.request = originalRequest; }
});
