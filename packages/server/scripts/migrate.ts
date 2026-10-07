import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../src/db/index.js';

// Applies every journaled migration in ./drizzle. Migrations are hand-written
// SQL (see AGENTS/DNA/DEVELOPMENT.md § Migrations) plus a matching _journal.json entry.
await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied');
await pool.end();
