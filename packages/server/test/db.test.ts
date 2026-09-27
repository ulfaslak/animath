import { describe, expect, it } from 'vitest';
import { pool, pingDb } from '../src/db/index.js';

/**
 * Postgres restarting (a recreated container, `/redeploy` § Changing
 * Postgres) ends every connection, and pg reports an idle one's end as an
 * `error` event on the pool. An `error` event with no listener throws, and it
 * killed the server: on the local production stack a Postgres restart
 * restarted the app.
 */
describe('the database pool', () => {
	it('survives Postgres ending an idle connection, and serves the next query', async () => {
		// Two connections: one to end while it sits idle in the pool, one to end it
		// with. Only this pool's own connection is ended, so the other test files
		// on the same database are left alone.
		const idle = await pool.connect();
		const other = await pool.connect();
		const { rows } = await idle.query<{ pid: number }>('select pg_backend_pid() as pid');
		idle.release();
		const before = pool.totalCount;
		await other.query('select pg_terminate_backend($1)', [rows[0]?.pid]);
		other.release();
		// The pool hears of the end and lets that connection go.
		await expect.poll(() => pool.totalCount).toBeLessThan(before);
		expect(await pingDb()).toBe(true);
	});
});
