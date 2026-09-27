import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyDecoy, verifyPassword } from '../src/passwords.js';

// Each hash is one scrypt at its real cost, about 150 ms at a load average of
// 14 (2026-09-27); these tests hash up to five times.
vi.setConfig({ testTimeout: 30_000 });

describe('password hashes', () => {
	it('carry their parameters and a salt, and differ for the same password', async () => {
		const a = await hashPassword('nini2026');
		const b = await hashPassword('nini2026');
		expect(a).toMatch(/^\$scrypt\$ln=15,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
		expect(await verifyPassword('nini2026', a)).toBe(true);
		expect(await verifyPassword('nini2026', b)).toBe(true);
		expect(await verifyPassword('nini2027', a)).toBe(false);
		expect(await verifyPassword('Nini2026', a)).toBe(false);
	});

	it('verify with the parameters stored in the hash, so the cost can change later', async () => {
		const salt = randomBytes(16);
		const key = scryptSync('blåbær', salt, 32, { N: 2 ** 12, r: 8, p: 1 });
		const stored = `$scrypt$ln=12,r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`;
		expect(await verifyPassword('blåbær', stored)).toBe(true);
		// The same password typed on a tablet, with the ring as its own mark.
		expect(await verifyPassword('blåbær', stored)).toBe(true);
		expect(await verifyPassword('blabær', stored)).toBe(false);
	});

	it('never match a stored value that is not a hash this server wrote, nor one with a cost past its bounds', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const salt = randomBytes(16).toString('base64url');
			const key = randomBytes(32).toString('base64url');
			for (const stored of [
				'',
				'nini2026',
				`$scrypt$ln=15,r=8,p=1$${salt}`,
				`$bcrypt$ln=15,r=8,p=1$${salt}$${key}`,
				// A cost that would take gigabytes, and one that is no cost at all.
				`$scrypt$ln=30,r=8,p=1$${salt}$${key}`,
				`$scrypt$ln=2,r=8,p=1$${salt}$${key}`,
				`$scrypt$ln=15,r=99,p=1$${salt}$${key}`,
				`$scrypt$ln=15,r=8,p=1$$${key}`
			]) {
				expect(await verifyPassword('nini2026', stored), stored).toBe(false);
			}
		} finally {
			error.mockRestore();
		}
	});

	it('refuse a stored cost that would take more than 64 MiB or four times the work, without trying it', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const salt = randomBytes(16).toString('base64url');
			const key = randomBytes(32).toString('base64url');
			const refused = [
				'ln=20,r=32,p=1', // 4 GiB
				'ln=17,r=8,p=1', // 128 MiB
				'ln=16,r=16,p=1', // 128 MiB
				'ln=15,r=8,p=5', // five times the work
				'ln=15,r=8,p=16'
			];
			for (const cost of refused) {
				expect(await verifyPassword('nini2026', `$scrypt$${cost}$${salt}$${key}`), cost).toBe(
					false
				);
			}
			// Each was turned away as unreadable: none was worked through.
			expect(error).toHaveBeenCalledTimes(refused.length);
		} finally {
			error.mockRestore();
		}
	});

	it('still verify a hash at the largest cost they take: 64 MiB', async () => {
		const salt = randomBytes(16);
		const key = scryptSync('nini2026', salt, 32, { N: 2 ** 16, r: 8, p: 1, maxmem: 2 ** 28 });
		const stored = `$scrypt$ln=16,r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`;
		expect(await verifyPassword('nini2026', stored)).toBe(true);
	});

	it('the decoy for a name with no account takes a real check and never matches', async () => {
		expect(await verifyDecoy('not a password anyone has')).toBe(false);
		expect(await verifyDecoy('nini2026')).toBe(false);
	});
});
