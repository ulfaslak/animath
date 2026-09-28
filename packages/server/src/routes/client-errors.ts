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
 * and within the limit per address, counted before the body is read (429 with
 * `Retry-After`). 503 when the database does not take it. The route reads no
 * session and sends no cookie, and the address is only counted, in this
 * process's memory.
 *
 * There is no limit for every address together: a stranger with a few
 * addresses could use it up, and every kid's report would be refused while the
 * health watch said nothing new came in. A flood can only fill the table, which
 * keeps the newest `KEEP_ROWS`, and it shows as errors of its own.
 */

export interface ReportLimits {
	/** Reports from one address (`rateKey`). */
	perAddress: LimitSpec;
}

const MINUTE = 60_000;

/**
 * A page sends 3 reports an hour at most, each a different error, so a class
 * behind one school address whose pages all break the same way sends some 75,
 * of which the first 30 are kept. One address alone sends 4,320 a day at most,
 * under `KEEP_ROWS`. The count is this process's: a restart or a deploy starts
 * it again.
 */
export const REPORT_LIMITS: ReportLimits = {
	perAddress: { limit: 30, windowMs: 10 * MINUTE, maxKeys: 10_000 }
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
