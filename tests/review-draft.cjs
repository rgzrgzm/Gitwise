const { test } = require('node:test');
const assert = require('node:assert/strict');
const { removeReviewComment, stageReviewComment, submitReviewDraft } = require('../dist-review-tests/review-draft.js');

test('renderer draft state stages notes across files and preserves old/new diff sides', () => {
  const first = stageReviewComment([], { path: 'src/auth.ts', line: 12, side: 'RIGHT', body: '  Check this guard.  ' }, 'draft-a');
  const both = stageReviewComment(first, { path: 'src/legacy.ts', line: 4, side: 'LEFT', body: 'Explain this removal.' }, 'draft-b');
  assert.deepEqual(both.map(({ path, line, side, body }) => ({ path, line, side, body })), [
    { path: 'src/auth.ts', line: 12, side: 'RIGHT', body: 'Check this guard.' },
    { path: 'src/legacy.ts', line: 4, side: 'LEFT', body: 'Explain this removal.' }
  ]);
  assert.deepEqual(removeReviewComment(both, 'draft-a'), [both[1]]);
});

test('invalid empty draft note is not staged', () => {
  const existing = [{ id: 'kept', path: 'a.ts', line: 1, side: 'RIGHT', body: 'Keep' }];
  assert.equal(stageReviewComment(existing, { path: 'b.ts', line: 2, side: 'LEFT', body: '  ' }, 'empty'), existing);
  assert.equal(stageReviewComment(existing, { path: '../bad', line: 0, side: 'RIGHT', body: 'No' }, 'invalid'), existing);
});

test('renderer sends one bridge call with the chosen decision, summary, and all staged comments', async () => {
  const comments = [
    { id: 'one', path: 'src/auth.ts', line: 12, side: 'RIGHT', body: 'Check this guard.' },
    { id: 'two', path: 'src/legacy.ts', line: 4, side: 'LEFT', body: 'Explain this removal.' }
  ];
  const calls = [];
  const response = await submitReviewDraft({ repositoryPath: 'C:/fixture/repo', pullNumber: 42, decision: 'REQUEST_CHANGES', summary: 'Please revise.', comments }, async (...args) => {
    calls.push(args);
    return { ok: true, confirmed: true };
  });
  assert.deepEqual(response, { ok: true, confirmed: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    'C:/fixture/repo', 42, 'REQUEST_CHANGES', 'Please revise.',
    [
      { path: 'src/auth.ts', line: 12, side: 'RIGHT', body: 'Check this guard.' },
      { path: 'src/legacy.ts', line: 4, side: 'LEFT', body: 'Explain this removal.' }
    ]
  ]);
  assert.equal('id' in calls[0][4][0], false);
});

test('bridge errors are returned to the renderer without clearing or changing its draft', async () => {
  const draft = [{ id: 'one', path: 'src/auth.ts', line: 12, side: 'RIGHT', body: 'Check this guard.' }];
  const response = await submitReviewDraft({ repositoryPath: 'C:/fixture/repo', pullNumber: 42, decision: 'COMMENT', summary: 'Review note.', comments: draft }, async () => ({ ok: false, error: 'Permission denied.' }));
  assert.deepEqual(response, { ok: false, error: 'Permission denied.' });
  assert.equal(draft.length, 1);
  assert.equal(draft[0].id, 'one');
});
