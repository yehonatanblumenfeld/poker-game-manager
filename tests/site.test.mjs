import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// GitHub Pages answers any unknown path (/game/CODE, /history...) with
// 404.html, so it has to be the app itself.
test('404.html is a copy of index.html', () => {
  assert.equal(readFileSync(new URL('../404.html', import.meta.url), 'utf8'), readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
});
