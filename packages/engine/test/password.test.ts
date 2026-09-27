import { describe, expect, it, vi } from 'vitest';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPassword } from '../src/index.js';

describe('checkPassword', () => {
	it('takes four characters, counted as characters rather than UTF-16 units', () => {
		expect(PASSWORD_MIN_LENGTH).toBe(4);
		expect(checkPassword('abcd')).toEqual({ ok: true, password: 'abcd' });
		expect(checkPassword('æøå1')).toEqual({ ok: true, password: 'æøå1' });
		// Four emoji are four characters and eight UTF-16 units.
		expect(checkPassword('🐰🦊🐢🐸')).toEqual({ ok: true, password: '🐰🦊🐢🐸' });
		expect(checkPassword('🐰🦊🐢')).toEqual({ ok: false, reason: 'short' });
	});

	it('refuses an empty or three-character password as short', () => {
		for (const raw of ['', 'a', 'ab', 'abc', 'nin']) {
			expect(checkPassword(raw)).toEqual({ ok: false, reason: 'short' });
		}
	});

	it('counts a decomposed letter as the one character it is once composed', () => {
		const decomposed = 'åbc'; // "å" as "a" plus a combining ring, then "bc"
		expect(checkPassword(decomposed)).toEqual({ ok: false, reason: 'short' });
		const typed = checkPassword('åbcd');
		expect(typed).toEqual({ ok: true, password: 'åbcd' });
	});

	it('gives one text to hash for the same password typed on two keyboards', () => {
		const laptop = checkPassword('blåbær');
		const tablet = checkPassword('blåbær');
		expect(laptop.ok && tablet.ok && laptop.password === tablet.password).toBe(true);
	});

	it('keeps spaces: a password is never trimmed', () => {
		expect(checkPassword(' ab ')).toEqual({ ok: true, password: ' ab ' });
		expect(checkPassword('    ')).toEqual({ ok: true, password: '    ' });
	});

	it('takes exactly the maximum and refuses one more, however the characters are written', () => {
		expect(PASSWORD_MAX_LENGTH).toBe(128);
		expect(checkPassword('x'.repeat(128))).toEqual({ ok: true, password: 'x'.repeat(128) });
		expect(checkPassword('x'.repeat(129))).toEqual({ ok: false, reason: 'long' });
		expect(checkPassword('🐰'.repeat(128)).ok).toBe(true);
		expect(checkPassword('🐰'.repeat(129))).toEqual({ ok: false, reason: 'long' });
		// 128 composed letters typed as 256 units still fit.
		expect(checkPassword('å'.repeat(128)).ok).toBe(true);
	});

	it('refuses a huge input as long without normalizing it', () => {
		const normalize = vi.spyOn(String.prototype, 'normalize');
		try {
			expect(checkPassword('a'.repeat(5_000_000))).toEqual({ ok: false, reason: 'long' });
			expect(normalize).not.toHaveBeenCalled();
		} finally {
			normalize.mockRestore();
		}
	});
});
