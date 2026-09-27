import { expect, it } from 'vitest';

// `setup.ts` turns the worker's event loop between tests, a poll phase included.
// Without it the second test starts in the same turn as the first, before the
// callback the first queued two turns away has run.
let turned = false;

it('queues a callback two turns of the event loop away', () => {
	setImmediate(() => setImmediate(() => (turned = true)));
});

it('finds it ran before the next test started: the worker read its messages in between', () => {
	expect(turned).toBe(true);
});
