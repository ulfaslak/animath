import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { keepReport, readReport, REPORT_MAX_BYTES } from '../client-errors.js';
import { RateLimiter, type LimitSpec, type Verdict } from '../rate-limit.js';
import { clientIp, rateKey, readJson, sameOriginJson } from '../request.js';

/**
 * Error reports from the game's pages (`client-errors.ts`):
 *
 *   POST /api/client-errors  { message, stack?, build, mode, browser, screen, test? } → 204
 *
 * JSON from a page of this site (`sameOriginJson`: 415, 403), `REPORT_MAX_BYTES`
 * at most (413), a report `readReport` takes (400 with the field it did not),
 * and within the limits (429 with `Retry-After`): per address, counted before
 * the body is read, and for every address together, counted once a report is
 * read, so a flood from many addresses cannot fill the table faster than
 * `everyone` allows. 503 when the database does not take it. The route reads
 * no session and sends no cookie, and the address is only counted, in this
 * process's memory.
 */

export interface ReportLimits {
	/** Reports from one address (`rateKey`). */
	perAddress: LimitSpec;
	/** Reports from every address together. */
	everyone: LimitSpec;
}

const MINUTE = 60_000;

/**
 * A page sends 10 reports at most, each a different error: one kid's page
 * breaking badly is 10, and a class behind one school address whose pages
 * break the same way as they load, some 25. Every address together can send
 * 4,800 a day at most, under `KEEP_ROWS`: a flood pushes out no report less
 * than a day old.
 */
export const REPORT_LIMITS: ReportLimits = {
	perAddress: { limit: 30, windowMs: 10 * MINUTE, maxKeys: 10_000 },
	everyone: { limit: 200, windowMs: 60 * MINUTE, maxKeys: 1 }
};

function tooMany(c: Context, verdict: Extract<Verdict, { ok: false }>) {
	c.header('Retry-After', String(verdict.retryAfterSeconds));
	return c.json({ error: 'too many reports', retryAfter: verdict.retryAfterSeconds }, 429);
}

/** The SQLSTATE of a database error (drizzle keeps pg's as its `cause`), for a log line that holds no report. */
function codeOf(error: unknown): string {
	for (
		let e: unknown = error;
		typeof e === 'object' && e !== null;
		e = (e as { cause?: unknown }).cause
	) {
		const code = (e as { code?: unknown }).code;
		if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
	}
	return 'no code';
}

export function clientErrorsRoute(limits: ReportLimits) {
	const perAddress = new RateLimiter(limits.perAddress);
	const everyone = new RateLimiter(limits.everyone);

	const limited: MiddlewareHandler = async (c, next) => {
		const verdict = perAddress.hit(rateKey(clientIp(c)));
		if (!verdict.ok) return tooMany(c, verdict);
		await next();
	};

	return new Hono().post(
		'/',
		sameOriginJson,
		limited,
		bodyLimit({
			maxSize: REPORT_MAX_BYTES,
			onError: (c) => c.json({ error: `body is bigger than ${REPORT_MAX_BYTES} bytes` }, 413)
		}),
		async (c) => {
			const body = await readJson(c);
			if (body === undefined) return c.json({ error: 'body is not valid JSON' }, 400);
			const read = readReport(body);
			if (!read.ok) return c.json({ error: 'bad report', detail: read.detail }, 400);
			const verdict = everyone.hit('everyone');
			if (!verdict.ok) return tooMany(c, verdict);
			try {
				await keepReport(read.report);
			} catch (error) {
				// Never the report itself: a stranger's text has no place in the log.
				console.error(`client error report not kept (${codeOf(error)})`);
				return c.json({ error: 'not kept' }, 503);
			}
			return c.body(null, 204);
		}
	);
}
