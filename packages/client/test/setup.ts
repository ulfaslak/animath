import { beforeEach } from 'vitest';

/**
 * Lets each test worker read vitest's replies between tests ([[DEVELOPMENT]]
 * § Testing ideology). vitest runs a file's synchronous tests back to back in
 * one turn of the worker's event loop. The worker waits 60 s at most for the
 * reply to each progress report it sends, counted from when the report left,
 * and a reply that has arrived is read only when the loop turns. So a file
 * whose sweeps add up to a minute under load ends the run with `Timeout
 * calling "onTaskUpdate"`, every test passed. Before each test the loop turns
 * twice; the second turn is queued from the first, so a poll phase, which
 * reads what has arrived, runs between them. `setup.test.ts` pins it.
 */
const nextTurn = globalThis.setImmediate; // taken before any test can fake the timers

beforeEach(async () => {
	await new Promise((resolve) => nextTurn(resolve));
	await new Promise((resolve) => nextTurn(resolve));
});
