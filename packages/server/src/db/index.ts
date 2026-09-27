import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
// An idle connection that Postgres drops (a restart, a recreated container)
// reports it here. With no listener the process would die of it; with one,
// the next query just opens a new connection.
pool.on('error', (err) => console.error(`postgres: an idle connection was lost (${err.message})`));
export const db = drizzle(pool, { schema });

export async function pingDb(): Promise<boolean> {
	try {
		await pool.query('select 1');
		return true;
	} catch {
		return false;
	}
}
