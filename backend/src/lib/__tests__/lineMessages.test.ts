import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGroupMealInvitationMessage } from '../lineMessages.js';

test('buildGroupMealInvitationMessage formats the invitation text and URL', () => {
  const { text, url } = buildGroupMealInvitationMessage({
    title: 'お昼ごはん',
    groupMealId: 'abc123',
    baseUrl: 'https://example.com/',
  });

  assert.strictEqual(url, 'https://example.com/group-meals/abc123');

  const expectedText = [
    '🍚 ご飯会のお誘いです',
    '',
    'タイトル：「お昼ごはん」',
    '',
    'この会に「あなたにも来てほしい」と思っている人がいます。',
    'どんな会かは、招待ページを開いてみてください。',
    '',
    '▼招待ページ',
    url,
  ].join('\n');

  assert.strictEqual(text, expectedText);
});
