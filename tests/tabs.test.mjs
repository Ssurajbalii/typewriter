import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Text } from '@codemirror/state';
import { nextUntitledName, isDirty, serializeSession, planRestore } from '../src/tabs.js';

const tab = (o) => ({ scrollTop: 0, saved: null, ...o, state: EditorState.create({ doc: o.text ?? '' }) });

test('untitled names fill the first gap', () => {
  assert.equal(nextUntitledName([]), 'Untitled');
  assert.equal(nextUntitledName(['Untitled']), 'Untitled 2');
  assert.equal(nextUntitledName(['Untitled', 'Untitled 3']), 'Untitled 2');
});

test('dirtiness: files compare with disk, untitled tabs with emptiness', () => {
  const doc = Text.of(['hello']);
  assert.equal(isDirty(doc, Text.of(['hello'])), false);
  assert.equal(isDirty(doc, Text.of(['bye'])), true);
  assert.equal(isDirty(Text.empty, null), false);
  assert.equal(isDirty(doc, null), true);
});

test('clean files store no content; dirty and untitled tabs store their text', () => {
  const s = serializeSession([
    tab({ id: 'a', path: '/n/clean.md', text: 'same', saved: Text.of(['same']) }),
    tab({ id: 'b', path: '/n/dirty.md', text: 'edited', saved: Text.of(['orig']) }),
    tab({ id: 'c', path: null, name: 'Untitled', text: 'draft' }),
  ], 'b');
  assert.equal(s.active, 'b');
  assert.deepEqual(s.tabs.map((t) => t.content), [null, 'edited', 'draft']);
});

test('restore reloads clean files, keeps unsaved edits, drops vanished clean files', () => {
  const session = {
    version: 1,
    active: 'b',
    tabs: [
      { id: 'a', path: '/n/clean.md', content: null },
      { id: 'b', path: '/n/dirty.md', content: 'edited' },
      { id: 'c', path: null, name: 'Untitled', content: 'draft' },
      { id: 'd', path: '/n/gone.md', content: null },
      { id: 'e', path: '/n/gone-but-edited.md', content: 'kept' },
    ],
  };
  const disk = { '/n/clean.md': 'changed on disk', '/n/dirty.md': 'orig', '/n/gone.md': null, '/n/gone-but-edited.md': null };
  const plan = planRestore(session, disk);
  assert.deepEqual(plan.map((t) => [t.id, t.content, t.saved, t.active]), [
    ['a', 'changed on disk', 'changed on disk', false],
    ['b', 'edited', 'orig', true],
    ['c', 'draft', null, false],
    ['e', 'kept', null, false],
  ]);
});

test('an untitled tab saved clean comes back clean', () => {
  const s = serializeSession([tab({ id: 'w', path: null, name: 'Welcome', text: 'hi', saved: Text.of(['hi']) })], 'w');
  assert.equal(s.tabs[0].clean, true);
  const [t] = planRestore(s, {});
  assert.equal(t.saved, 'hi');
});

test('unknown session versions restore nothing', () => {
  assert.deepEqual(planRestore({ version: 99, tabs: [] }, {}), []);
  assert.deepEqual(planRestore(null, {}), []);
});
