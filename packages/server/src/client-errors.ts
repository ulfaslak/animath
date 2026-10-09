import { lt, sql, type SQL } from 'drizzle-orm';
import { db } from './db/index.js';
import { clientErrors } from './db/schema.js';

/**
 * Error reports from the game's pages ([[DECISIONS]] § Deployment): an error
 * nothing on a kid's page caught, with what the page showed (`mode`), the
 * build, the browser's family and version and the window's size. Nothing in
 * one says whose page it was: the page sends no name, no account, no save and
 * no cookie, and hides the kid's own words in the text it sends (the client's
 * `error-reports.ts`); the route reads no session, and counts the address a
 * report came from for its limits, in memory, never keeping or logging it.
 *
 * Anyone can send a report, so each is read as a stranger's: every field
 * checked, its text cleaned of what could steer a terminal or reorder what one
 * shows (`cleanLine`), everything bounded, and the table kept to `KEEP_DAYS`
 * and `KEEP_ROWS`. Only the admin reads them (`admin errors`), never a player.
 */

/** The largest report the route reads. One a page builds is under 3 KiB. */
export const REPORT_MAX_BYTES = 8 * 1024;
/** How much of an error's message is kept. */
export const MESSAGE_MAX_LENGTH = 300;
/** How much of its stack: this many lines at most, and this many characters in all. */
export const STACK_MAX_LINES = 20;
export const STACK_MAX_LENGTH = 2000;
/** A report older than this goes, and so does every one but the newest `KEEP_ROWS`. */
export const KEEP_DAYS = 30;
export const KEEP_ROWS = 5000;

/** A report as it is kept. */
export interface ClientErrorReport {
	/** The error's name and message (`TypeError: …`), one line. */
	message: string;
	/** Where it was thrown, a frame a line: the page's own addresses, without host, query or fragment. */
	stack: string;
	/** The commit the page was built from (its `animath-build`), or `dev`. */
	build: string;
	/** What the page showed: `explore`, `battle`, `title`, … */
	mode: string;
	/** The browser's family and version, and the kind of device: `Safari 26.0 (iPad)`. */
	browser: string;
	/** The window's size in CSS pixels: `1180x820`. */
	screen: string;
	/** Sent by hand to check the route, not by a page. */
	test: boolean;
}

const BUILD = /^(?:[0-9a-f]{7,40}|dev)$/;
const MODE = /^[a-z][a-z-]{0,23}$/;
const BROWSER = /^[A-Za-z][A-Za-z0-9 ._()-]{0,59}$/;
const SCREEN = /^\d{1,5}x\d{1,5}$/;

export type ReadReport = { ok: true; report: ClientErrorReport } | { ok: false; detail: string };

/**
 * A report from a request's body, checked and cleaned, or the field that is
 * wrong. `stack` and `test` may be left out; a field it does not know is
 * dropped, never kept.
 */
export function readReport(body: unknown): ReadReport {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return wrong('report');
	const fields = body as Record<string, unknown>;
	const { message, build, mode, browser, screen } = fields;
	const stack = fields.stack === undefined ? '' : fields.stack;
	const test = fields.test === undefined ? false : fields.test;
	if (typeof message !== 'string') return wrong('message');
	const line = shorten(cleanLine(message), MESSAGE_MAX_LENGTH);
	if (line === '') return wrong('message');
	if (typeof stack !== 'string') return wrong('stack');
	if (typeof build !== 'string' || !BUILD.test(build)) return wrong('build');
	if (typeof mode !== 'string' || !MODE.test(mode)) return wrong('mode');
	if (typeof browser !== 'string' || !BROWSER.test(browser)) return wrong('browser');
	if (typeof screen !== 'string' || !SCREEN.test(screen)) return wrong('screen');
	if (typeof test !== 'boolean') return wrong('test');
	return {
		ok: true,
		report: { message: line, stack: cleanStack(stack), build, mode, browser, screen, test }
	};
}

function wrong(detail: string): ReadReport {
	return { ok: false, detail };
}

/** Half of a surrogate pair without its other half. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * One line of a stranger's text as it may be kept and printed: a control
 * character (every terminal escape sequence starts with one) or a line or
 * paragraph separator is a space, a format character (a bidirectional
 * override, which reorders what a terminal shows, or a zero-width one) is
 * gone, a lone surrogate is U+FFFD (Postgres takes no other), and a run of
 * spaces is one.
 */
export function cleanLine(text: string): string {
	return text
		.replace(LONE_SURROGATE, '�')
		.replace(/\p{Cf}/gu, '')
		.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
}

/** A stack: each line cleaned, empty ones dropped, at most `STACK_MAX_LINES` and `STACK_MAX_LENGTH`. */
function cleanStack(text: string): string {
	const lines: string[] = [];
	let length = 0;
	for (const raw of text.split(/\r\n|\r|\n/)) {
		if (lines.length === STACK_MAX_LINES) break;
		const line = cleanLine(raw);
		if (line === '') continue;
		const room = STACK_MAX_LENGTH - length - (lines.length > 0 ? 1 : 0);
		if (room < 2) break;
		const kept = shorten(line, room);
		lines.push(kept);
		length += kept.length + (lines.length > 1 ? 1 : 0);
	}
	return lines.join('\n');
}

/** `text` in `max` UTF-16 units at most, ending in `…` when it was cut; a pair is never split. */
function shorten(text: string, max: number): string {
	if (text.length <= max) return text;
	let cut = text.slice(0, max - 1);
	if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
	return `${cut}…`;
}

/**
 * Keeps a report, then lets go of every report older than `KEEP_DAYS` and of
 * all but the newest `KEEP_ROWS`: the table stays small whoever sends what,
 * and a flood pushes out the oldest reports, never the newest.
 */
export async function keepReport(report: ClientErrorReport): Promise<void> {
	await db.insert(clientErrors).values(report);
	await db
		.delete(clientErrors)
		.where(lt(clientErrors.createdAt, sql`now() - make_interval(days => ${KEEP_DAYS})`));
	await db.execute(
		sql`delete from client_errors where id <= (select id from client_errors order by id desc offset ${KEEP_ROWS} limit 1)`
	);
}

/** The reports of one error: one message, from one build; a test report is never a page's. */
export interface ErrorGroup {
	message: string;
	build: string;
	test: boolean;
	count: number;
	first: Date;
	last: Date;
	/** How many came from each: what the page showed, the browser, the window's size. */
	modes: Record<string, number>;
	browsers: Record<string, number>;
	screens: Record<string, number>;
	/** The newest report's. */
	stack: string;
}

export interface ErrorGroups {
	since: Date;
	/** The database's clock as it was asked: the next `since` that misses nothing. */
	until: Date;
	/** The reports in every group. */
	reports: number;
	/** The group heard from last first. */
	groups: ErrorGroup[];
}

/** A time as the database gives it here: milliseconds since 1970 (drizzle hands a timestamp over as text). */
type Millis = number | string;

interface GroupRow extends Record<string, unknown> {
	message: string;
	build: string;
	test: boolean;
	count: number;
	first: Millis;
	last: Millis;
	modes: string[];
	browsers: string[];
	screens: string[];
	stack: string;
}

/** A timestamp in SQL as milliseconds since 1970, a `Millis`. */
const millis = (time: SQL) => sql`(extract(epoch from ${time}) * 1000)::float8`;

/**
 * How far behind the database's clock a window of new groups ends. A report's
 * `created_at` is when its insert began, which can be before a window's end
 * while the row lands after the window was read: it would fall between two
 * windows, and the next of its kind would not be new, never to be told. An
 * insert lands within milliseconds, so a window that ends this long ago has
 * every row it will ever hold.
 */
const NEW_WINDOW_LAG_MS = 10_000;

/**
 * The reports that came in from `since` until now, grouped by message and
 * build. With `onlyNew`, only the groups heard from for the first time since
 * then: no report of theirs came in before `since` (the health watch's "new
 * errors"), and the window ends `NEW_WINDOW_LAG_MS` ago. The end (`until`) is
 * the database's clock to the millisecond, and the start of the next window.
 */
export async function errorGroups(since: Date, onlyNew = false): Promise<ErrorGroups> {
	const lag = onlyNew ? NEW_WINDOW_LAG_MS : 0;
	const clock = await db.execute<{ now: Millis }>(
		sql`select ${millis(sql`date_trunc('milliseconds', now() - make_interval(secs => ${lag / 1000}))`)} as now`
	);
	const until = new Date(Number(clock.rows[0]!.now));
	const fresh = onlyNew
		? sql`and not exists (select 1 from client_errors o where o.message = e.message and o.build = e.build and o.test = e.test and o.created_at < ${since})`
		: sql``;
	const found = await db.execute<GroupRow>(sql`
		select e.message, e.build, e.test, count(*)::int as count,
			${millis(sql`min(e.created_at)`)} as first, ${millis(sql`max(e.created_at)`)} as last,
			array_agg(e.mode) as modes, array_agg(e.browser) as browsers, array_agg(e.screen) as screens,
			(array_agg(e.stack order by e.id desc))[1] as stack
		from client_errors e
		where e.created_at >= ${since} and e.created_at < ${until} ${fresh}
		group by e.message, e.build, e.test
		order by max(e.created_at) desc, e.message`);
	const groups = found.rows.map((row): ErrorGroup => ({
		message: row.message,
		build: row.build,
		test: row.test,
		count: row.count,
		first: new Date(Math.floor(Number(row.first))),
		last: new Date(Math.floor(Number(row.last))),
		modes: tally(row.modes),
		browsers: tally(row.browsers),
		screens: tally(row.screens),
		stack: row.stack
	}));
	return { since, until, reports: groups.reduce((n, g) => n + g.count, 0), groups };
}

/** How many times each value comes, the commonest first. */
function tally(values: readonly string[]): Record<string, number> {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
