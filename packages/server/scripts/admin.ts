import {
	AdminError,
	deleteAccount,
	exportLocalSave,
	importSave,
	isExportFrom,
	listAll,
	resetPassword
} from '../src/admin.js';
import { pool } from '../src/db/index.js';
import { SAVE_MAX_BYTES } from '../src/save.js';

// The accounts admin, against DATABASE_URL (see AGENTS/DNA/DEVELOPMENT.md § Accounts):
//
//   admin list
//   admin reset-password <name> [<new password>]   (a made-up one when none is given)
//   admin delete-account <name> [--yes]            (says what it would delete without --yes)
//   admin export-local-save <player id> [--from anonymous|account|account:<name>] [--out <folder>]
//   admin import-save [--name <name>] [--origin <address>] < save.json
//
// A name is matched as the game matches it: case and how a letter is typed do not matter.
// Moving a kid's game to production, the last two: DEVELOPMENT.md § Moving a kid's game
// to production.

const USAGE = [
	'usage:',
	'  admin list',
	'  admin reset-password <name> [<new password>]',
	'  admin delete-account <name> [--yes]',
	'  admin export-local-save <player id> [--from anonymous|account|account:<name>] [--out <folder>]',
	'  admin import-save [--name <name>] [--origin <address>] < save.json'
].join('\n');

/** The flags each command takes: `true` for a switch, `false` for one followed by its value. */
const FLAGS: Record<string, Record<string, boolean>> = {
	list: {},
	'reset-password': {},
	'delete-account': { '--yes': true },
	'export-local-save': { '--from': false, '--out': false },
	'import-save': { '--name': false, '--origin': false }
};

interface Parsed {
	command: string;
	words: string[];
	flags: Map<string, string | true>;
}

function parse(args: string[]): Parsed {
	const [command = '', ...rest] = args;
	const known = FLAGS[command];
	if (!known) throw new AdminError(USAGE);
	const words: string[] = [];
	const flags = new Map<string, string | true>();
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i]!;
		if (!arg.startsWith('--')) {
			words.push(arg);
			continue;
		}
		const isSwitch = known[arg];
		if (isSwitch === undefined || flags.has(arg)) throw new AdminError(USAGE);
		if (isSwitch) {
			flags.set(arg, true);
			continue;
		}
		const value = rest[++i];
		if (value === undefined || value.startsWith('--')) throw new AdminError(USAGE);
		flags.set(arg, value);
	}
	return { command, words, flags };
}

/** The save piped in: `import-save < save.json`, or over ssh into the app's container. */
async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) throw new AdminError('Pipe the save in: admin import-save < save.json');
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
		size += chunk.length;
		// Room for the tabs and line breaks the export writes around the largest save.
		if (size > 4 * SAVE_MAX_BYTES) throw new AdminError('That is far bigger than any save.');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function run(args: string[]): Promise<string[]> {
	const { command, words, flags } = parse(args);
	const value = (flag: string) => {
		const v = flags.get(flag);
		return typeof v === 'string' ? v : undefined;
	};
	switch (command) {
		case 'list':
			if (words.length !== 0) break;
			return listAll();
		case 'reset-password':
			if (words.length < 1 || words.length > 2) break;
			return resetPassword(words[0]!, words[1]);
		case 'delete-account':
			if (words.length !== 1) break;
			return deleteAccount(words[0]!, flags.has('--yes'));
		case 'export-local-save': {
			const from = value('--from');
			if (words.length !== 1 || (from !== undefined && !isExportFrom(from))) break;
			return exportLocalSave(words[0]!, { from, folder: value('--out') });
		}
		case 'import-save':
			if (words.length !== 0) break;
			return importSave(await readStdin(), {
				name: value('--name'),
				origin: value('--origin'),
				domain: process.env.MATHGAME_DOMAIN
			});
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
