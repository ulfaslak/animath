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
//   admin reset-password <name> [<new password> | --stdin]   (a made-up one when none is given;
//                                                    --stdin reads it, and never says it back)
//   admin delete-account <name> [--yes]            (says what it would delete without --yes)
//   admin export-local-save <player id> [--from anonymous|account|account:<name>] [--out <folder>]
//   admin import-save [--name <name>] [--origin <address>] < save.json
//
// A name is matched as the game matches it: case and how a letter is typed do not matter.
// Moving a kid's game to production, the last two: DEVELOPMENT.md § Moving a kid's game
// to production. export-local-save starts from the retired anonymous backup, so it finds
// a game only in a database the tunnel's development server backed up to before that
// backup was retired: this Mac's `mathgame`.

const USAGE = [
	'usage:',
	'  admin list',
	'  admin reset-password <name> [<new password> | --stdin]',
	'  admin delete-account <name> [--yes]',
	'  admin export-local-save <player id> [--from anonymous|account|account:<name>] [--out <folder>]',
	'  admin import-save [--name <name>] [--origin <address>] < save.json'
].join('\n');

/** The flags each command takes: `true` for a switch, `false` for one followed by its value. */
const FLAGS: Record<string, Record<string, boolean>> = {
	list: {},
	'reset-password': { '--stdin': true },
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

/**
 * What is piped in: a save (`import-save < save.json`, or over ssh into the
 * app's container), or a password (`reset-password <name> --stdin`), which
 * then never stands in a command line (the process list, the host's
 * `docker events`). At most `maxBytes`.
 */
async function readStdin(hint: string, maxBytes: number): Promise<string> {
	if (process.stdin.isTTY) throw new AdminError(hint);
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size > maxBytes) throw new AdminError('That is far bigger than it can be.');
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
		case 'reset-password': {
			if (!flags.has('--stdin')) {
				if (words.length < 1 || words.length > 2) break;
				return resetPassword(words[0]!, words[1]);
			}
			if (words.length !== 1) break;
			// One line, as `printf '%s'` or `echo` gives it: its line break is not part of it.
			const piped = await readStdin('Pipe the password in: … reset-password <name> --stdin', 4096);
			const password = piped.replace(/\r?\n$/, '');
			if (password === '') throw new AdminError('No password came in on stdin.');
			return resetPassword(words[0]!, password, { secret: true });
		}
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
			// Room for the tabs and line breaks the export writes around the largest save.
			return importSave(
				await readStdin('Pipe the save in: admin import-save < save.json', 4 * SAVE_MAX_BYTES),
				{
					name: value('--name'),
					origin: value('--origin'),
					domain: process.env.MATHGAME_DOMAIN
				}
			);
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
