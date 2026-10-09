#!/usr/bin/env node
/**
 * The mistakes log keeps its promises ([[AGENT_MISTAKES]]'s header): an entry
 * tagged `[learned]` names the guard that learned it, and that guard exists.
 * Run by `pnpm lint`.
 *
 *   node scripts/check-learned.mjs
 *
 * For every entry (`### …`) in `AGENTS/AGENT_MISTAKES.md` and
 * `AGENTS/AGENT_MISTAKES_ARCHIVE.md`:
 * - a `[learned]` entry names at least one guard: CLAUDE.md, a `[[link]]` or
 *   an `AGENTS/` file by name (`ENVIRONMENT_NOTES`), a file of the repo in
 *   backticks, or a name in backticks that the code still has
 *   (`CROWD_RADIUS`, `behindAction`);
 * - every `[[link]]` in it is a file of the repo (`[[DECISIONS]]` →
 *   `DECISIONS.md` anywhere), and every backticked name that reads as a path
 *   of the repo (`scripts/…`, `packages/…`, `src/…`, `test/…`, or a file name
 *   ending `.ts`, `.mjs`, `.sh`, `.md`, `.svelte`, `.sql`) is one, by path or,
 *   for a bare name, anywhere; a file renamed since says so, `old.ts` (now
 *   `new.ts`), and only the new name is checked;
 * - a `[learned]` entry is in the archive, not the log, so the log holds only
 *   what is still open.
 * A name the repo had once and lost is the check's whole point: rename the
 * reference, or drop `[learned]` back to `[not codified]` with what is missing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOG = 'AGENTS/AGENT_MISTAKES.md';
const ARCHIVE = 'AGENTS/AGENT_MISTAKES_ARCHIVE.md';
const SKIP = new Set([
	'node_modules',
	'.git',
	'dist',
	'screenshots',
	'.svelte-kit',
	'test-results'
]);

/** Every file of the repo, by path from the root. */
function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else out.push(relative(root, path));
	}
	return out;
}
const files = walk(root);
const paths = new Set(files);
const dirs = new Set(
	files.flatMap((f) =>
		f
			.split('/')
			.slice(0, -1)
			.map((_, i, a) => a.slice(0, i + 1).join('/'))
	)
);
const names = new Set(files.map((f) => basename(f)));
const linkable = new Set(
	files.filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md').toLowerCase())
);

/** The repo's code, to find a name an entry gives in backticks. */
const code = files
	.filter((f) => /\.(?:ts|mts|mjs|js|svelte|sh|css|yaml|sql|conf|template)$/.test(f))
	.map((f) => readFileSync(join(root, f), 'utf8'))
	.join('\n');
/** `AGENTS/` and DNA files named in plain words: `ARCHITECTURE`, `ENVIRONMENT_NOTES`. */
const docWords = new RegExp(
	`\\b(?:${files
		.filter((f) => f.startsWith('AGENTS/') && f.endsWith('.md'))
		.map((f) => basename(f, '.md'))
		.join('|')})\\b`
);
const IDENTIFIER = /^[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*(?:\(\))?$/;

const PATHLIKE =
	/^(?:scripts|packages|src|test|AGENTS|\.claude|nginx|terraform|local)\/|\.(?:ts|mjs|mts|sh|md|svelte|sql|yaml|json)$/;

/** Does a backticked name, read as a path of the repo, exist? */
function exists(name) {
	const clean = name.replace(/[):,.]+$/, '').replace(/^\.\//, '');
	if (/[*<>{}\s]/.test(clean)) return true; // a pattern or a placeholder, not a file
	if (paths.has(clean) || dirs.has(clean.replace(/\/$/, ''))) return true;
	if (!clean.includes('/')) return names.has(clean);
	// A path from inside a package (`src/save/autosave.ts`, `test/…`): any package's.
	return (
		files.some((f) => f.endsWith('/' + clean)) ||
		[...dirs].some((d) => d.endsWith('/' + clean.replace(/\/$/, '')))
	);
}

function entries(file) {
	const text = readFileSync(join(root, file), 'utf8');
	const out = [];
	let current = null;
	text.split('\n').forEach((line, i) => {
		if (line.startsWith('### ')) {
			current = { file, line: i + 1, title: line, body: [] };
			out.push(current);
		} else if (line.startsWith('## ')) current = null;
		else if (current) current.body.push(line);
	});
	return out;
}

const problems = [];
const all = [LOG, ARCHIVE].flatMap((f) => (paths.has(f) ? entries(f) : []));
if (all.length === 0) problems.push(`no entries found in ${LOG}`);
for (const e of all) {
	const where = `${e.file}:${e.line}`;
	const learned = e.title.includes('[learned]');
	const text = [e.title, ...e.body].join('\n');
	const links = [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
	// A name followed by "(now `…`)" is the file's old name, told as history.
	const ticked = [...text.matchAll(/`([^`\n]+)`(?! \(now `)/g)]
		.map((m) => m[1])
		.filter((t) => PATHLIKE.test(t));
	const named = [...text.matchAll(/`([^`\n]+)`/g)]
		.map((m) => m[1].replace(/\(\)$/, ''))
		.filter((t) => IDENTIFIER.test(t) && t.length > 3 && !PATHLIKE.test(t));
	for (const l of links)
		if (!linkable.has(l.toLowerCase())) problems.push(`${where}: [[${l}]] is no file of the repo`);
	for (const t of ticked)
		if (!exists(t)) problems.push(`${where}: \`${t}\` is no file of the repo`);
	if (learned) {
		const guarded =
			/CLAUDE\.md/.test(text) ||
			links.length > 0 ||
			docWords.test(text) ||
			ticked.some(exists) ||
			named.some((n) => code.includes(n));
		if (!guarded) {
			problems.push(
				`${where}: [learned] names no guard (CLAUDE.md, a DNA file, a file or a name the code has)`
			);
		}
		if (e.file === LOG) problems.push(`${where}: a [learned] entry belongs in ${ARCHIVE}`);
	}
}

if (problems.length > 0) {
	console.error(`check-learned: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
	process.exit(1);
}
console.log(
	`check-learned: ${all.length} entries, every [learned] one guarded, every name in them a file of the repo`
);
