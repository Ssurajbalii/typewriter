import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/paths.js';
// Paths must work for both macOS and Windows documents.
const cases = [
  [P.basename('/Users/a/notes.md'), 'notes.md'],
  [P.basename('C:\\Users\\a\\notes.md'), 'notes.md'],
  [P.dirname('/Users/a/notes.md'), '/Users/a'],
  [P.dirname('C:\\Users\\a\\notes.md'), 'C:\\Users\\a'],
  [P.dirname('/notes.md'), '/'],
  [P.isAbsolute('C:\\x'), true], [P.isAbsolute('C:/x'), true], [P.isAbsolute('\\\\srv\\share\\x'), true],
  [P.isAbsolute('/x'), true], [P.isAbsolute('img/x.png'), false], [P.isAbsolute('./x.png'), false],
  [P.join('C:\\Users\\a', './img/x.png'), 'C:\\Users\\a\\img\\x.png'],
  [P.join('/Users/a', 'img/x.png'), '/Users/a/img/x.png'],
  [P.relativeTo('C:\\Users\\A\\docs', 'c:\\users\\a\\docs\\img\\p.png'), 'img/p.png'],
  [P.relativeTo('/Users/a/docs', '/Users/a/docs/img/p.png'), 'img/p.png'],
  [P.relativeTo('/Users/a/docs', '/tmp/p.png'), '/tmp/p.png'],
  [P.toUrlPath('C:\\My Docs\\p #1.png'), '/C:/My%20Docs/p%20%231.png'],
  [P.toUrlPath('/C:/x.png'), '/C:/x.png'],
  [P.toUrlPath('/Users/a b/x.png'), '/Users/a%20b/x.png'],
  [P.toFileUrl('C:\\x\\y.png'), 'file:///C:/x/y.png'],
];
test('path helpers handle POSIX and Windows paths', () => {
  cases.forEach(([got, want], i) => assert.equal(got, want, `case ${i}`));
});
