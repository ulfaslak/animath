import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';

/** A limiter on a clock the test moves. */
function limiter(limit: number, windowMs: number, maxKeys: number) {
	let now = 1_000_000;
	const l = new RateLimiter({ limit, windowMs, maxKeys }, () => now);
	return { l, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
	it('allows `limit` tries per key per window, then says how long to wait', () => {
		const { l, advance } = limiter(3, 60_000, 10);
		for (let i = 0; i < 3; i++) expect(l.hit('a')).toEqual({ ok: true });
		expect(l.hit('a')).toEqual({ ok: false, retryAfterSeconds: 60 });
		advance(59_001);
		expect(l.hit('a')).toEqual({ ok: false, retryAfterSeconds: 1 });
		expect(l.hit('b')).toEqual({ ok: true });
		advance(1_000);
		expect(l.hit('a')).toEqual({ ok: true });
	});

	it('does not count a refused try', () => {
		const { l, advance } = limiter(2, 10_000, 10);
		l.hit('a');
		l.hit('a');
		for (let i = 0; i < 50; i++) expect(l.hit('a').ok).toBe(false);
		advance(10_000);
		expect(l.hit('a').ok).toBe(true);
		expect(l.hit('a').ok).toBe(true);
		expect(l.hit('a').ok).toBe(false);
	});

	it('takes back a refunded try, and never goes below none', () => {
		const { l } = limiter(2, 10_000, 10);
		l.refund('a');
		l.hit('a');
		l.hit('a');
		l.refund('a');
		expect(l.hit('a').ok).toBe(true);
		expect(l.hit('a').ok).toBe(false);
	});

	it('never holds more than maxKeys keys, however many it is shown', () => {
		const { l, advance } = limiter(5, 60_000, 100);
		for (let i = 0; i < 10_000; i++) {
			l.hit(`key-${i}`);
			if (i % 997 === 0) advance(1_000);
			expect(l.size).toBeLessThanOrEqual(100);
		}
		expect(l.size).toBe(100);
	});

	it('makes room with keys whose window has passed before any live one', () => {
		const { l, advance } = limiter(1, 10_000, 3);
		l.hit('old');
		advance(10_000);
		l.hit('blocked-1');
		l.hit('blocked-2');
		l.hit('new');
		expect(l.size).toBe(3);
		expect(l.hit('blocked-1').ok).toBe(false);
		expect(l.hit('blocked-2').ok).toBe(false);
	});

	it('when full of live keys, forgets the oldest window first', () => {
		const { l, advance } = limiter(1, 60_000, 2);
		l.hit('first');
		advance(1);
		l.hit('second');
		advance(1);
		l.hit('third');
		expect(l.hit('second').ok).toBe(false);
		expect(l.hit('third').ok).toBe(false);
		expect(l.hit('first').ok).toBe(true);
	});

	it('refuses a limit that could never let anything through', () => {
		expect(() => new RateLimiter({ limit: 0, windowMs: 1, maxKeys: 1 })).toThrow();
		expect(() => new RateLimiter({ limit: 1, windowMs: 0, maxKeys: 1 })).toThrow();
		expect(() => new RateLimiter({ limit: 1, windowMs: 1, maxKeys: 0 })).toThrow();
	});
});
