import { AdminError, deleteAccount, listAll, resetPassword } from '../src/admin.js';
import { pool } from '../src/db/index.js';

// The accounts admin, against DATABASE_URL (see AGENTS/DNA/DEVELOPMENT.md § Accounts):
//
//   admin list
//   admin reset-password <name> [<new password>]   (a made-up one when none is given)
//   admin delete-account <name> [--yes]            (says what it would delete without --yes)
//
// A name is matched as the game matches it: case and how a letter is typed do not matter.

const USAGE = [
	'usage:',
	'  admin list',
	'  admin reset-password <name> [<new password>]',
	'  admin delete-account <name> [--yes]'
].join('\n');

async function run(args: string[]): Promise<string[]> {
	const [command, ...rest] = args;
	const flags = rest.filter((a) => a.startsWith('--'));
	const words = rest.filter((a) => !a.startsWith('--'));
	if (flags.some((f) => f !== '--yes')) throw new AdminError(USAGE);
	switch (command) {
		case 'list':
			if (words.length !== 0) break;
			return listAll();
		case 'reset-password':
			if (words.length < 1 || words.length > 2) break;
			return resetPassword(words[0]!, words[1]);
		case 'delete-account':
			if (words.length !== 1) break;
			return deleteAccount(words[0]!, flags.includes('--yes'));
	}
	throw new AdminError(USAGE);
}

try {
	for (const line of await run(process.argv.slice(2))) console.log(line);
} catch (error) {
	if (!(error instanceof AdminError)) throw error;
	console.error(error.message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
