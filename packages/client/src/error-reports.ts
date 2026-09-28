/**
 * Error reports ([[DECISIONS]] § Deployment): an error nothing on the page
 * caught, an exception or a promise nobody handled, goes to the server
 * (`POST /api/client-errors`), which keeps it for the admin (`admin errors`)
 * and the health watch on the developer's Mac. So the first error a kid's
 * browser meets, in a Safari on an iPad the game was never tried on, is known
 * without the kid telling anyone.
 *
 * A report holds the error's message and a trimmed stack, the build
 * (`animath-build`), what the page showed (`mode`), the browser's family and
 * version with the kind of device (`browserOf`), and the window's size.
 * Nothing in it says whose page it was: no name, no account, no save, no
 * cookie (`credentials: 'omit'`), the kid's own words (`ReportContext.words`)
 * hidden in its text, and the page's addresses in it without their host,
 * query or fragment, where a welcome link's token can be (`scrubbed`).
 *
 * The page listens from its first script: `boot.ts` imports this module
 * before anything else, and the build makes it a script of its own that the
 * page runs before `boot.ts`'s (`errorReportsFirst` in `vite.config.ts`), so
 * even a script the browser cannot read is reported. Each error goes once a
 * page, and a page sends `MAX_REPORTS` at most. Reporting never throws, and
 * nothing waits on it. The module imports nothing and keeps to syntax older
 * browsers read (no class fields, no `?.`, no `??`, no regular expression a
 * browser could refuse as it reads the script), so that a browser too old for
 * the rest of the game still runs it: it is what tells of the browsers that
 * fall short.
 */

/** What a page sends; the server's `ClientErrorReport` less `test`. */
export interface ErrorReport {
	message: string;
	stack: string;
	build: string;
	mode: string;
	browser: string;
	screen: string;
}

/** What the page is doing, which a report tells; `boot.ts` and then `main.ts` set it. */
export interface ReportContext {
	/** What the page shows: `explore`, `battle`, `title`, … (lower-case letters and dashes). */
	mode: () => string;
	/** The kid's own words on the page, hidden in a report's text: names, nicknames, what is typed in a box. */
	words: () => readonly (string | null | undefined)[];
}

export interface ErrorReports {
	/**
	 * Reports what was thrown: an `Error`, or anything a promise was rejected
	 * with (`rejected`). `where` (a script's address, line and column) stands
	 * in for a stack the error does not have. Never throws.
	 */
	report(thrown: unknown, rejected?: boolean, where?: string): void;
	setContext(context: ReportContext): void;
}

export interface ReporterOptions {
	send: (report: ErrorReport) => void;
	build: string;
	browser: string;
	screen: () => string;
}

/** The most reports one page sends, each a different error. */
export const MAX_REPORTS = 10;
/** The server keeps a message of 300 characters and a stack of 20 lines and 2,000 characters. */
const MESSAGE_MAX = 300;
const STACK_LINES = 20;
const STACK_MAX = 2000;
/** A word this short is hidden nowhere: it names nobody, and would blot out the text. */
const WORD_MIN = 2;
const MODE = /^[a-z][a-z-]{0,23}$/;

export function errorReporter(options: ReporterOptions): ErrorReports {
	let context: ReportContext = { mode: () => 'boot', words: () => [] };
	const seen: string[] = [];

	function modeNow(): string {
		try {
			const mode = context.mode();
			return MODE.test(mode) ? mode : 'unknown';
		} catch (e) {
			return 'unknown';
		}
	}

	function wordsNow(): string[] {
		try {
			const words: string[] = [];
			for (const word of context.words()) {
				const w = typeof word === 'string' ? word.trim() : '';
				if (w.length >= WORD_MIN) words.push(w);
			}
			return words;
		} catch (e) {
			return [];
		}
	}

	return {
		setContext(next) {
			context = next;
		},
		report(thrown, rejected = false, where = '') {
			try {
				if (seen.length >= MAX_REPORTS) return;
				const words = wordsNow();
				const told = described(thrown, rejected);
				const message = shorten(oneLine(scrubbed(told.message, words)), MESSAGE_MAX);
				const stack = trimmedStack(scrubbed(told.stack || where, words));
				const key = `${message}\n${stack.split('\n')[0]}`;
				if (message === '' || seen.indexOf(key) !== -1) return;
				seen.push(key);
				options.send({
					message,
					stack,
					build: options.build,
					mode: modeNow(),
					browser: options.browser,
					screen: options.screen()
				});
			} catch (e) {
				// A report that could not be made is not sent: never an error of its own.
			}
		}
	};
}

/** The message and stack of anything thrown. */
function described(thrown: unknown, rejected: boolean): { message: string; stack: string } {
	if (typeof thrown === 'object' && thrown !== null && ('message' in thrown || 'stack' in thrown)) {
		const error = thrown as { name?: unknown; message?: unknown; stack?: unknown };
		const name = typeof error.name === 'string' ? error.name : '';
		const text = typeof error.message === 'string' ? error.message : '';
		const message = name !== '' && text !== '' ? `${name}: ${text}` : name || text;
		let stack = typeof error.stack === 'string' ? error.stack : '';
		// Chrome's stack starts with the message, which the report already holds.
		if (message !== '' && stack.indexOf(message) === 0) stack = stack.slice(message.length);
		return { message: message || (rejected ? 'rejected' : 'thrown'), stack };
	}
	let text: string;
	try {
		text = String(thrown);
	} catch (e) {
		text = typeof thrown;
	}
	return { message: `${rejected ? 'rejected with' : 'thrown'}: ${text}`, stack: '' };
}

/** A web address: a scheme, `://`, and everything up to a space, a bracket or a quote. */
const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s()'"<>]+/gi;

/**
 * An address as a report may carry it: its path, and the line and column a
 * stack gives after it, without the host, the query or the fragment.
 */
function pathOf(address: string): string {
	const rest = address.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
	const place = /(?::\d+){1,2}$/.exec(rest);
	const tail = place ? place[0] : '';
	const path = rest.slice(0, rest.length - tail.length).split(/[?#]/)[0];
	return (path || '/') + tail;
}

/**
 * A pattern for `word` standing alone, in any case: not inside a longer word
 * (letters and digits of any script, where the browser knows them).
 */
function wholeWord(word: string): RegExp {
	const escaped = word.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
	try {
		return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'giu');
	} catch (e) {
		return new RegExp(
			`(^|[^A-Za-z0-9\\u00C0-\\uFFFF])${escaped}(?=$|[^A-Za-z0-9\\u00C0-\\uFFFF])`,
			'gi'
		);
	}
}

/**
 * A report's text as it may leave the page: every address as its path
 * (`pathOf`), a welcome link's token hidden wherever it is, and each of the
 * kid's own words hidden wherever it stands alone.
 */
export function scrubbed(text: string, words: readonly string[]): string {
	let out = text.replace(ADDRESS, pathOf).replace(/(welcome[=/:])[^\s&#/?'")]+/gi, '$1[hidden]');
	for (const word of words) out = out.replace(wholeWord(word), '$1[hidden]');
	return out;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function shorten(text: string, max: number): string {
	if (text.length <= max) return text;
	let cut = text.slice(0, max - 1);
	if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
	return `${cut}…`;
}

/** A stack as the server keeps it: a frame a line, no empty ones, `STACK_LINES` and `STACK_MAX` at most. */
function trimmedStack(stack: string): string {
	const lines: string[] = [];
	for (const raw of stack.split('\n')) {
		const line = oneLine(raw);
		if (line !== '') lines.push(line);
		if (lines.length === STACK_LINES) break;
	}
	let out = lines.join('\n');
	if (out.length > STACK_MAX) {
		const lastWhole = out.lastIndexOf('\n', STACK_MAX);
		out = lastWhole > 0 ? out.slice(0, lastWhole) : shorten(out, STACK_MAX);
	}
	return out;
}

/** Browser families, the first whose mark is in the user agent, with its version. */
const FAMILIES: readonly (readonly [string, RegExp])[] = [
	['Edge', /\bEdg(?:e|A|iOS)?\/(\d+(?:\.\d+)?)/],
	['Samsung Internet', /\bSamsungBrowser\/(\d+(?:\.\d+)?)/],
	['Opera', /\b(?:OPR|OPiOS)\/(\d+(?:\.\d+)?)/],
	['Firefox', /\b(?:Firefox|FxiOS)\/(\d+(?:\.\d+)?)/],
	['WebView', /; wv\).*?\bChrome\/(\d+(?:\.\d+)?)/],
	['HeadlessChrome', /\bHeadlessChrome\/(\d+(?:\.\d+)?)/],
	['Chrome', /\b(?:Chrome|CriOS)\/(\d+(?:\.\d+)?)/],
	['Safari', /\bVersion\/(\d+(?:\.\d+)?)(?:\.\d+)*(?: Mobile\/\S+)? Safari\//],
	['WebView', /\bOS (\d+_\d+)(?:_\d+)? like Mac OS X\b/]
];

/**
 * The browser's family and version, and the kind of device, from its user
 * agent: `Safari 26.0 (iPad)`, `Chrome 140.0 (Android)`. An iPad asks for the
 * desktop site as a Mac does; its touch points (`navigator.maxTouchPoints`)
 * give it away. Nothing finer: the user agent itself is never sent.
 */
export function browserOf(userAgent: string, touchPoints: number): string {
	let family = 'Other';
	for (const [name, mark] of FAMILIES) {
		const found = mark.exec(userAgent);
		if (found) {
			family = `${name} ${(found[1] || '').replace('_', '.')}`;
			break;
		}
	}
	return `${family} (${deviceOf(userAgent, touchPoints)})`;
}

function deviceOf(userAgent: string, touchPoints: number): string {
	if (/\biPad\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && touchPoints > 1)) {
		return 'iPad';
	}
	if (/\b(?:iPhone|iPod)\b/.test(userAgent)) return 'iPhone';
	if (/\bAndroid\b/.test(userAgent)) return 'Android';
	if (/\bCrOS\b/.test(userAgent)) return 'ChromeOS';
	if (/\bWindows\b/.test(userAgent)) return 'Windows';
	if (/\bMacintosh\b/.test(userAgent)) return 'Mac';
	if (/\bLinux\b/.test(userAgent)) return 'Linux';
	return 'other';
}

/** What an `error` event on the page carries, as `thrownBy` reads it. */
export interface ErrorEventLike {
	error?: unknown;
	message?: string;
	filename?: string;
	lineno?: number;
	colno?: number;
}

/**
 * What an `error` event reports, as `report` takes it, or null for one there
 * is nothing to tell of: a script of another site, which the browser says
 * nothing about ("Script error."), and a `ResizeObserver` that ran again in
 * the same frame, which is no error.
 */
export function thrownBy(event: ErrorEventLike): { thrown: unknown; where: string } | null {
	const message = typeof event.message === 'string' ? event.message : '';
	if (/^ResizeObserver loop/.test(message)) return null;
	const where = event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '';
	if (event.error !== undefined && event.error !== null) return { thrown: event.error, where };
	if (where === '' && (message === '' || message === 'Script error.')) return null;
	return { thrown: { message: message.replace(/^Uncaught /, '') }, where };
}

/** Sends a report, and forgets it: no cookie, and a request that outlives the page. */
export function postReport(report: ErrorReport): void {
	fetch('/api/client-errors', {
		method: 'POST',
		credentials: 'omit',
		keepalive: true,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(report)
	}).catch(() => undefined);
}

/** Reports every error nothing on `page` catches, through `send`. */
export function listenTo(page: Window, send: (report: ErrorReport) => void = postReport) {
	const reports = errorReporter({
		send,
		build: String(import.meta.env.VITE_BUILD_SHA || 'dev'),
		browser: browserOf(page.navigator.userAgent, page.navigator.maxTouchPoints || 0),
		screen: () => `${Math.round(page.innerWidth)}x${Math.round(page.innerHeight)}`
	});
	page.addEventListener('error', (event) => {
		const found = thrownBy(event);
		if (found) reports.report(found.thrown, false, found.where);
	});
	page.addEventListener('unhandledrejection', (event) => reports.report(event.reason, true));
	return reports;
}

/** The page's reports, listening from the moment this module runs; null where there is no page (tests). */
export const errorReports: ErrorReports | null =
	typeof window === 'undefined' ? null : listenTo(window);
