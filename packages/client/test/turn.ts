/**
 * Lets the test worker read vitest's replies ([[DEVELOPMENT]] § Testing
 * ideology). The worker waits 60 s at most for the reply to each progress
 * report it sends, counted from when the report left, and a reply that has
 * arrived is read only when its event loop turns: a synchronous test, or run
 * of tests, that holds the loop for a minute under load ends the run with
 * `Timeout calling "onTaskUpdate"`, every test passed. `turn` lets the loop go
 * round twice; the second turn is queued from the first, so a poll phase,
 * which reads what has arrived, runs between them. `setup.ts` awaits it
 * before every test, and a sweep that can run near a minute on a loaded
 * machine awaits it between its parts.
 */
const nextTurn = globalThis.setImmediate; // taken before any test can fake the timers

export async function turn(): Promise<void> {
	await new Promise((resolve) => nextTurn(resolve));
	await new Promise((resolve) => nextTurn(resolve));
}
