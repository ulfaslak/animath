#!/usr/bin/env node
/**
 * The mistakes log keeps its promises ([[AGENT_MISTAKES]]'s header). Run by
 * `pnpm lint`.
 *
 *   node scripts/check-learned.mjs
 *
 * `AGENTS/AGENT_MISTAKES.md` holds the patterns and the open entries;
 * `AGENTS/AGENT_MISTAKES_ARCHIVE.md` the `[learned]` ones. It checks:
 * - every entry's heading carries `[learned]` or `[not codified]`, not both;
 * - every entry of the archive is `[learned]`, and no entry of the log is;
 * - a `[learned]` entry names a guard: CLAUDE.md, a `[[link]]`, an `AGENTS/`
 *   file by its name (`ENVIRONMENT_NOTES`), a file of the repo in backticks,
 *   or a name in backticks that the code has as a whole word
 *   (`CROWD_RADIUS`, `behindAction`, `x-animath-account`: one with a capital,
 *   an underscore, a dot or a hyphen, never a plain word such as `null`), and
 *   does not say what it would take to become `[learned]` ("Would become");
 * - every `[[link]]`, in the entries and in the log's patterns, is a file of
 *   the repo, and every name in backticks that reads as a path of the repo
 *   (`scripts/…`, `packages/…`, `src/…`, `test/…`, or a name ending `.ts`,
 *   `.mjs`, `.sh`, `.md`, `.svelte`, `.sql`, …) is one, by path or, for a bare
 *   name, anywhere; a `:line` after it is allowed; a file renamed since says
 *   so, `old.ts` (now `new.ts`), and only the new name is checked.
 * The files of the repo are git's, tracked or new and not ignored.
 *
 * It checks that a guard is named and still exists, not that it guards: that
 * is the cleanse's to judge. A name the repo had once and lost is its point:
 * rename the reference, or move the entry back to the log as `[not codified]`
 * with what is missing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOG = 'AGENTS/AGENT_MISTAKES.md';
const ARCHIVE = 'AGENTS/AGENT_MISTAKES_ARCHIVE.md';
const SELF = 'scripts/check-learned.mjs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
	cwd: root,
	encoding: 'utf8'
})
	.split('\n')
	.filter((f) => f && existsSync(join(root, f)));
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

/** The repo's code, its tests and scripts (not this file, which names examples), to find a name an entry gives. */
const code = files
	.filter((f) => f !== SELF && /\.(?:ts|mts|mjs|js|svelte|sh|css|yaml|sql|conf|template)$/.test(f))
	.map((f) => readFileSync(join(root, f), 'utf8'))
	.join('\n');
const inCode = (name) =>
	new RegExp(`(?<![\\w$-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$-])`).test(code);

/** `AGENTS/` and DNA files named in plain words: `ARCHITECTURE`, `ENVIRONMENT_NOTES`. */
const docWords = new RegExp(
	`\\b(?:${files
		.filter((f) => f.startsWith('AGENTS/') && f.endsWith('.md'))
		.map((f) => basename(f, '.md'))
		.join('|')})\\b`
);
/** A name specific enough to be a guard: an identifier, a header, a dotted path, with a capital, `_`, `.` or `-` in it. */
const SPECIFIC = /^(?=[\w$.-]*[A-Z_.-])[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/;
const PATHLIKE =
	/^(?:scripts|packages|src|test|AGENTS|\.claude|nginx|terraform|local)\/|\.(?:ts|mts|mjs|sh|md|svelte|sql|yaml|json)$/;

/** A backticked name as a path: no `:line`, no trailing punctuation. */
const asPath = (name) =>
	name
		.replace(/:\d+(?:-\d+)?$/, '')
		.replace(/[):,.]+$/, '')
		.replace(/^\.\//, '');

/** Does a name, read as a path of the repo, exist? */
function exists(name) {
	const clean = asPath(name);
	if (/[*<>{}\s]/.test(clean)) return true; // a pattern or a placeholder, not a file
	if (paths.has(clean) || dirs.has(clean.replace(/\/$/, ''))) return true;
	if (!clean.includes('/')) return names.has(clean);
	// A path from inside a package (`src/save/autosave.ts`, `test/…`): any package's.
	const tail = '/' + clean.replace(/\/$/, '');
	return files.some((f) => f.endsWith(tail)) || [...dirs].some((d) => d.endsWith(tail));
}

/** Every backticked name in a text, but one followed by " (now `…`)": a file's old name, told as history. */
function ticked(text) {
	const out = [];
	for (const m of text.matchAll(/`([^`\n]+)`/g)) {
		if (text.startsWith(' (now `', m.index + m[0].length)) continue;
		out.push(m[1]);
	}
	return out;
}

const problems = [];

function read(file) {
	if (!paths.has(file)) {
		problems.push(`${file} is missing`);
		return { patterns: '', entries: [] };
	}
	const lines = readFileSync(join(root, file), 'utf8').split('\n');
	// The entries come after the first `---`; what is above it is the header and, in the log, the patterns.
	const rule = lines.indexOf('---');
	const top = rule < 0 ? lines : lines.slice(0, rule);
	const entries = [];
	let current = null;
	lines.slice(rule < 0 ? lines.length : rule + 1).forEach((line, i) => {
		if (line.startsWith('### ')) {
			current = { file, line: rule + 2 + i, title: line, body: [] };
			entries.push(current);
		} else if (current) current.body.push(line);
	});
	return { patterns: top.join('\n'), entries };
}

const log = read(LOG);
const archive = read(ARCHIVE);
if (log.entries.length + archive.entries.length === 0) problems.push('no entries found');

function checkNames(where, text) {
	for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
		if (!linkable.has(m[1].trim().toLowerCase()))
			problems.push(`${where}: [[${m[1].trim()}]] is no file of the repo`);
	}
	for (const t of ticked(text)) {
		if (PATHLIKE.test(asPath(t)) && !exists(t))
			problems.push(`${where}: \`${t}\` is no file of the repo`);
	}
}

checkNames(`${LOG} (header and patterns)`, log.patterns);
for (const e of [...log.entries, ...archive.entries]) {
	const where = `${e.file}:${e.line}`;
	const learned = /\[learned\]/i.test(e.title);
	const open = /\[not codified\]/i.test(e.title);
	const text = [e.title, ...e.body].join('\n');
	checkNames(where, text);
	if (learned === open)
		problems.push(
			`${where}: the heading carries ${learned ? 'both [learned] and [not codified]' : 'neither [learned] nor [not codified]'}; give it one`
		);
	if (e.file === ARCHIVE && !learned)
		problems.push(`${where}: only [learned] entries belong in the archive`);
	if (e.file === LOG && learned) problems.push(`${where}: a [learned] entry belongs in ${ARCHIVE}`);
	if (!learned) continue;
	if (/would become/i.test(text))
		problems.push(`${where}: [learned], but it says what it would take to become so`);
	const names = ticked(text);
	const guarded =
		/CLAUDE\.md/.test(text) ||
		/\[\[[^\]]+\]\]/.test(text) ||
		docWords.test(text) ||
		names.some((n) => PATHLIKE.test(asPath(n)) && exists(n)) ||
		names.some((n) => SPECIFIC.test(n.replace(/\(\)$/, '')) && inCode(n.replace(/\(\)$/, '')));
	if (!guarded) {
		problems.push(
			`${where}: [learned] names no guard (CLAUDE.md, a DNA file, a file or a name the code has)`
		);
	}
}

if (problems.length > 0) {
	console.error(`check-learned: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
	process.exit(1);
}
console.log(
	`check-learned: ${log.entries.length} open and ${archive.entries.length} learned entries, each learned one naming a guard the repo has`
);
