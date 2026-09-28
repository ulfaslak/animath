import { beforeEach } from 'vitest';
import { turn } from './turn.js';

/**
 * Lets each test worker read vitest's replies between tests ([[DEVELOPMENT]]
 * § Testing ideology): see `turn`. vitest runs a file's synchronous tests back
 * to back in one turn of the worker's event loop, so without this a file whose
 * sweeps add up to a minute under load ends the run with `Timeout calling
 * "onTaskUpdate"`, every test passed. `setup.test.ts` pins it.
 */
beforeEach(async () => {
	await turn();
});
