/**
 * In-memory rate limits for logging in and registering: so many tries per key
 * (an IP address, or a name) per window. One server process holds them, so
 * a restart forgets them, which is fine for slowing down guessing.
 *
 * The limiter's own memory is bounded: it keeps at most `maxKeys` keys. When
 * a new key would go past that, keys whose window has passed go first, then
 * the oldest windows, so a flood of made-up names or addresses can make the
 * limiter forget early but never grow.
 */

export interface LimitSpec {
	/** Tries allowed per window. */
	limit: number;
	windowMs: number;
	/** The most keys held at once. */
	maxKeys: number;
}

interface Window {
	count: number;
	resetAt: number;
}

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number };

export class RateLimiter {
	readonly #spec: LimitSpec;
	readonly #now: () => number;
	/** Insertion order is window start order: a key is re-inserted when its window starts over. */
	readonly #windows = new Map<string, Window>();

	constructor(spec: LimitSpec, now: () => number = Date.now) {
		if (spec.limit < 1 || spec.maxKeys < 1 || spec.windowMs <= 0) {
			throw new Error('a rate limit needs a positive limit, window and size');
		}
		this.#spec = spec;
		this.#now = now;
	}

	/** How many keys are held; never more than `maxKeys`. */
	get size(): number {
		return this.#windows.size;
	}

	/** Counts a try for `key` if it is allowed, and says whether it was. */
	hit(key: string): Verdict {
		const now = this.#now();
		const window = this.#live(key, now);
		if (window) {
			if (window.count >= this.#spec.limit) {
				return {
					ok: false,
					retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000))
				};
			}
			window.count++;
			return { ok: true };
		}
		// A new window: a key whose window has passed moves to the back of the line.
		this.#windows.delete(key);
		this.#makeRoom(now);
		this.#windows.set(key, { count: 1, resetAt: now + this.#spec.windowMs });
		return { ok: true };
	}

	/**
	 * Takes back one try `hit` counted for `key`. A login counts a failure for
	 * its name before it checks the password (so tries racing each other cannot
	 * all slip under the limit) and takes it back when the password was right.
	 */
	refund(key: string): void {
		const window = this.#live(key, this.#now());
		if (window && window.count > 0) window.count--;
	}

	#live(key: string, now: number): Window | null {
		const window = this.#windows.get(key);
		return window && window.resetAt > now ? window : null;
	}

	#makeRoom(now: number): void {
		if (this.#windows.size < this.#spec.maxKeys) return;
		for (const [key, window] of this.#windows) {
			if (window.resetAt <= now) this.#windows.delete(key);
		}
		for (const key of this.#windows.keys()) {
			if (this.#windows.size < this.#spec.maxKeys) break;
			this.#windows.delete(key);
		}
	}
}

/**
 * The limits on the account routes. Tests build an app with their own. An
 * "address" is `rateKey`'s: an IPv4 address, or an IPv6 /64.
 *
 * Wrong passwords are limited twice. From one address, a name gets a few
 * guesses; that is the limit a guesser meets, and a classmate who types
 * wrong on purpose shuts out only themselves, never the kid on their own
 * device. From everywhere together, a name gets several times more, which
 * bounds guessing from many addresses at once.
 */
export interface AccountLimits {
	/** Every login try from one address, right or wrong: the slow hashes one address can ask for. */
	loginPerIp: LimitSpec;
	/** Failed logins to one name from one address. A successful login does not count. */
	loginFailuresPerNameFromIp: LimitSpec;
	/** Failed logins to one name from every address together. A successful login does not count. */
	loginFailuresPerName: LimitSpec;
	/** Every register try from one address. */
	registerPerIp: LimitSpec;
	/** Every register try for one name, from anywhere. */
	registerPerName: LimitSpec;
	/** Save PUTs per account. A page sends one a second at most, and fewer as it walks. */
	savesPerAccount: LimitSpec;
	/**
	 * Every welcome link looked up or used from one address (`welcome.ts`): the
	 * login's limit per address. A link's token cannot be guessed; this bounds
	 * the asking.
	 */
	welcomePerIp: LimitSpec;
}

const MINUTE = 60_000;

/**
 * Sized for a class of kids behind one school address: 25 logging in, typos
 * and all, fit inside one quarter-hour, and 25 accounts inside one hour.
 */
export const ACCOUNT_LIMITS: AccountLimits = {
	loginPerIp: { limit: 60, windowMs: 15 * MINUTE, maxKeys: 10_000 },
	loginFailuresPerNameFromIp: { limit: 10, windowMs: 15 * MINUTE, maxKeys: 10_000 },
	loginFailuresPerName: { limit: 50, windowMs: 15 * MINUTE, maxKeys: 10_000 },
	registerPerIp: { limit: 30, windowMs: 60 * MINUTE, maxKeys: 10_000 },
	registerPerName: { limit: 10, windowMs: 15 * MINUTE, maxKeys: 10_000 },
	savesPerAccount: { limit: 120, windowMs: MINUTE, maxKeys: 10_000 },
	welcomePerIp: { limit: 60, windowMs: 15 * MINUTE, maxKeys: 10_000 }
};
