import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Player secrets: a random token the client holds and presents on every
 * request. Only its SHA-256 hash is stored, so a database dump cannot be
 * replayed as a player. The token is 256 bits of entropy, so an unsalted hash
 * is enough — there is nothing to brute-force.
 */

export function newSecret(): string {
	return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
	return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented secret against a stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
	const presented = Buffer.from(hashSecret(secret), 'hex');
	const stored = Buffer.from(storedHash, 'hex');
	return presented.length === stored.length && timingSafeEqual(presented, stored);
}
