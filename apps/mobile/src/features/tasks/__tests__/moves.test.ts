import { latestMoveError } from '../moves';

/**
 * One screen, four moves — take, accept, start, finish — each its own
 * mutation with its own last error. The screen has room for one sentence, and
 * it must be about what she tapped last: an accept refused a minute ago must
 * not stand over the start she has just made, and must not hide its refusal.
 */

const refusedAccept = new Error('accept refused');
const refusedStart = new Error('start refused');

test('the failure of the move made last is the one shown', () => {
  expect(
    latestMoveError([
      { error: refusedAccept, submittedAt: 100 },
      { error: refusedStart, submittedAt: 200 },
    ]),
  ).toBe(refusedStart);
});

test('a move that went through after an older failure clears the screen', () => {
  expect(
    latestMoveError([
      { error: refusedAccept, submittedAt: 100 },
      { error: null, submittedAt: 200 },
    ]),
  ).toBeNull();
});

test('an older move that failed does not come back over a newer one that failed too', () => {
  expect(
    latestMoveError([
      { error: refusedStart, submittedAt: 300 },
      { error: refusedAccept, submittedAt: 100 },
    ]),
  ).toBe(refusedStart);
});

test('nothing tried yet, nothing to say', () => {
  expect(
    latestMoveError([
      { error: null, submittedAt: 0 },
      { error: null, submittedAt: 0 },
    ]),
  ).toBeNull();
});
