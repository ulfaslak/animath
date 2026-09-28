import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	browserOf,
	errorReporter,
	errorReports,
	listenTo,
	MAX_REPORTS,
	postReport,
	scrubbed,
	thrownBy,
	type ErrorReport,
	type ErrorReports
} from '../src/error-reports';

// Error reports from the page (DECISIONS § Deployment): what a report holds,
// and what it never holds: whose page it was.

afterEach(() => {
	vi.unstubAllGlobals();
});

/** What the server takes as a browser (`BROWSER` in the server's client-errors.ts). */
const SERVER_BROWSER = /^[A-Za-z][A-Za-z0-9 ._()-]{0,59}$/;

const SAFARI_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

describe('browserOf', () => {
	it.each([
		[SAFARI_MAC, 0, 'Safari 26.0 (Mac)'],
		// An iPad asks for the desktop site, as a Mac; its touch points give it away.
		[SAFARI_MAC, 5, 'Safari 26.0 (iPad)'],
		[
			'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
			5,
			'Safari 26.0 (iPad)'
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Mobile/15E148 Safari/604.1',
			5,
			'Safari 26.0 (iPhone)'
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
			5,
			'Chrome 140.0 (iPhone)'
		],
		[
			'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
			5,
			'Firefox 143.0 (iPad)'
		],
		[
			'Mozilla/5.0 (iPad; CPU OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
			5,
			'WebView 17.5 (iPad)'
		],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			0,
			'Chrome 140.0 (Windows)'
		],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54',
			0,
			'Edge 140.0 (Windows)'
		],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
			0,
			'Opera 124.0 (Windows)'
		],
		[
			'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
			5,
			'Chrome 140.0 (Android)'
		],
		[
			'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
			5,
			'Samsung Internet 28.0 (Android)'
		],
		[
			'Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
			5,
			'WebView 140.0 (Android)'
		],
		[
			'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
			0,
			'Firefox 143.0 (Linux)'
		],
		[
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
			0,
			'Firefox 143.0 (Mac)'
		],
		[
			'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			0,
			'Chrome 140.0 (ChromeOS)'
		],
		// An automated browser (an agent's check, scripts/screenshot.mjs) says so.
		[
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
			0,
			'HeadlessChrome 140.0 (Mac)'
		],
		['curl/8.7.1', 0, 'Other (other)'],
		['', 0, 'Other (other)']
	])('%s with %i touch points is %s, as the server takes it', (userAgent, touchPoints, browser) => {
		expect(browserOf(userAgent, touchPoints)).toBe(browser);
		expect(browser).toMatch(SERVER_BROWSER);
	});

	it('never sends the user agent itself, even an odd one', () => {
		const odd = 'Mozilla/5.0 (Macintosh) Version/9<script>.1 Safari/1 Emil';
		expect(browserOf(odd, 0)).toBe('Other (Mac)');
	});
});

describe('scrubbed', () => {
	it.each([
		[
			'render@https://animath.xyz/immutable/main-B2x.js:1:2345',
			'render@/immutable/main-B2x.js:1:2345'
		],
		[
			'    at render (https://animath.xyz/immutable/main-B2x.js:1:2345)',
			'    at render (/immutable/main-B2x.js:1:2345)'
		],
		['global code@https://animath.xyz/?party=bear:10#welcome=AbC_12-xy:12:5', 'global code@/:12:5'],
		['http://localhost:5180/src/main.ts?t=1790000000:40:7', '/src/main.ts:40:7'],
		['Error: no welcome=AbCdEf-12 here', 'Error: no welcome=[hidden] here'],
		['Failed to fetch https://animath.xyz/api/x?welcome=abc', 'Failed to fetch /api/x']
	])('%s is %s', (text, expected) => {
		expect(scrubbed(text, [])).toBe(expected);
	});

	it("hides the kid's own words where they stand alone, in any case, and nowhere else", () => {
		expect(scrubbed('Emil saw EMIL and emil, not Emilie or xEmil', ['Emil'])).toBe(
			'[hidden] saw [hidden] and [hidden], not Emilie or xEmil'
		);
		expect(scrubbed('Søren: SØREN, sørens', ['søren'])).toBe('[hidden]: [hidden], sørens');
		expect(scrubbed('a.b (a.b) ab', ['a.b'])).toBe('[hidden] ([hidden]) ab');
		expect(scrubbed('Mr Fluffy Paws ran', ['Mr Fluffy Paws'])).toBe('[hidden] ran');
		expect(scrubbed('pw: hunter2!', ['hunter2'])).toBe('pw: [hidden]!');
	});
});

describe('errorReporter', () => {
	function reporter(): { reports: ErrorReports; sent: ErrorReport[] } {
		const sent: ErrorReport[] = [];
		const reports = errorReporter({
			send: (report) => sent.push(report),
			build: '0123456789abcdef0123456789abcdef01234567',
			browser: 'Safari 26.0 (iPad)',
			screen: () => '1180x820'
		});
		return { reports, sent };
	}

	it('sends the message, a trimmed stack, the build, the mode, the browser and the size, and nothing else', () => {
		const { reports, sent } = reporter();
		const error = new TypeError("Cannot read properties of undefined (reading 'hp')");
		error.stack = [
			"TypeError: Cannot read properties of undefined (reading 'hp')",
			...Array.from(
				{ length: 30 },
				(_, i) => `    at f${i} (https://animath.xyz/immutable/main-B2x.js:1:${i})`
			)
		].join('\n');
		reports.report(error);
		expect(sent).toHaveLength(1);
		const [report] = sent;
		expect(Object.keys(report!).sort()).toEqual([
			'browser',
			'build',
			'message',
			'mode',
			'screen',
			'stack'
		]);
		expect(report).toMatchObject({
			message: "TypeError: Cannot read properties of undefined (reading 'hp')",
			build: '0123456789abcdef0123456789abcdef01234567',
			mode: 'boot',
			browser: 'Safari 26.0 (iPad)',
			screen: '1180x820'
		});
		const frames = report!.stack.split('\n');
		expect(frames).toHaveLength(20);
		expect(frames[0]).toBe('at f0 (/immutable/main-B2x.js:1:0)');
	});

	it("tells what the page shows, and hides the kid's words in the message and the stack", () => {
		const { reports, sent } = reporter();
		reports.setContext({ mode: () => 'battle', words: () => ['Emil', null, '', 'Pip', 'x'] });
		const error = new Error('Emil’s Pip is not a function');
		error.stack =
			'hit@https://animath.xyz/immutable/main.js:1:2\nPip@https://animath.xyz/?name=Emil:3:4';
		reports.report(error);
		expect(sent[0]).toMatchObject({
			message: 'Error: [hidden]’s [hidden] is not a function',
			stack: 'hit@/immutable/main.js:1:2\n[hidden]@/:3:4',
			mode: 'battle'
		});
	});

	it('says unknown for a mode it cannot tell, and still reports when the words cannot be read', () => {
		const { reports, sent } = reporter();
		reports.setContext({
			mode: () => {
				throw new ReferenceError('not yet');
			},
			words: () => {
				throw new ReferenceError('not yet');
			}
		});
		reports.report(new Error('one'));
		reports.setContext({ mode: () => 'Explore!', words: () => [] });
		reports.report(new Error('two'));
		expect(sent.map((r) => [r.message, r.mode])).toEqual([
			['Error: one', 'unknown'],
			['Error: two', 'unknown']
		]);
	});

	it('sends each error once a page, and at most ten', () => {
		const { reports, sent } = reporter();
		const again = () => {
			const error = new Error('again');
			error.stack = 'frame@/a.js:1:1';
			return error;
		};
		reports.report(again());
		reports.report(again());
		const elsewhere = new Error('again');
		elsewhere.stack = 'other@/a.js:9:9';
		reports.report(elsewhere);
		expect(sent).toHaveLength(2);
		for (let i = 0; i < 20; i++) reports.report(new Error(`error ${i}`));
		expect(sent).toHaveLength(MAX_REPORTS);
	});

	it('reports anything thrown or rejected, and a place for one without a stack', () => {
		const { reports, sent } = reporter();
		reports.report('plain text', true);
		reports.report(42);
		reports.report(
			{ message: 'SyntaxError: Unexpected token' },
			false,
			'https://animath.xyz/immutable/boot.js:1:99'
		);
		const hostile = {
			toString() {
				throw new Error('no');
			}
		};
		reports.report(hostile);
		expect(sent.map((r) => [r.message, r.stack])).toEqual([
			['rejected with: plain text', ''],
			['thrown: 42', ''],
			['SyntaxError: Unexpected token', '/immutable/boot.js:1:99'],
			['thrown: object', '']
		]);
	});

	it('cuts a long message to 300 characters, one line', () => {
		const { reports, sent } = reporter();
		reports.report(new Error(`line one\nline two ${'x'.repeat(400)}`));
		expect(sent[0]!.message).toHaveLength(300);
		expect(sent[0]!.message).toMatch(/^Error: line one line two x+…$/);
	});

	it('never throws, whatever sending does', () => {
		const reports = errorReporter({
			send: () => {
				throw new Error('offline');
			},
			build: 'dev',
			browser: 'Other (other)',
			screen: () => '1x1'
		});
		expect(() => reports.report(new Error('x'))).not.toThrow();
	});
});

describe('thrownBy', () => {
	it('skips what tells nothing, and keeps where an error came from', () => {
		expect(
			thrownBy({ message: 'ResizeObserver loop completed with undelivered notifications.' })
		).toBeNull();
		expect(thrownBy({ message: 'Script error.', filename: '' })).toBeNull();
		const error = new TypeError('x');
		expect(
			thrownBy({
				error,
				message: 'Uncaught TypeError: x',
				filename: 'https://a/b.js',
				lineno: 3,
				colno: 4
			})
		).toEqual({ thrown: error, where: 'https://a/b.js:3:4' });
		expect(
			thrownBy({
				error: null,
				message: 'Uncaught SyntaxError: bad',
				filename: 'https://a/b.js',
				lineno: 1,
				colno: 2
			})
		).toEqual({ thrown: { message: 'SyntaxError: bad' }, where: 'https://a/b.js:1:2' });
	});
});

describe('the page', () => {
	it('reports what nothing caught on it, without a cookie, as it happens', () => {
		const listeners = new Map<string, (event: unknown) => void>();
		const page = {
			navigator: { userAgent: SAFARI_MAC, maxTouchPoints: 5 },
			innerWidth: 1180.4,
			innerHeight: 819.6,
			addEventListener: (type: string, listener: (event: unknown) => void) =>
				listeners.set(type, listener)
		} as unknown as Window;
		const sent: ErrorReport[] = [];
		listenTo(page, (report) => sent.push(report));
		listeners.get('error')!({
			error: new TypeError('x is undefined'),
			message: 'Uncaught TypeError: x is undefined',
			filename: 'https://animath.xyz/immutable/main.js',
			lineno: 1,
			colno: 2
		});
		listeners.get('error')!({ error: null, message: 'ResizeObserver loop limit exceeded' });
		listeners.get('unhandledrejection')!({ reason: new DOMException('denied', 'NotAllowedError') });
		expect(sent.map((r) => [r.message, r.browser, r.screen, r.build])).toEqual([
			['TypeError: x is undefined', 'Safari 26.0 (iPad)', '1180x820', 'dev'],
			['NotAllowedError: denied', 'Safari 26.0 (iPad)', '1180x820', 'dev']
		]);
	});

	it('posts a report as JSON without the cookie, and lets a failed post go', async () => {
		const calls: unknown[][] = [];
		vi.stubGlobal('fetch', (...args: unknown[]) => {
			calls.push(args);
			return Promise.reject(new TypeError('offline'));
		});
		const report: ErrorReport = {
			message: 'Error: x',
			stack: '',
			build: 'dev',
			mode: 'explore',
			browser: 'Other (other)',
			screen: '1x1'
		};
		postReport(report);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toEqual([
			[
				'/api/client-errors',
				{
					method: 'POST',
					credentials: 'omit',
					keepalive: true,
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(report)
				}
			]
		]);
	});

	it('has no reporter where there is no page', () => {
		expect(errorReports).toBeNull();
	});
});
