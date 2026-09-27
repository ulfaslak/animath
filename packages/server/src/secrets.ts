import { createHash, randomBytes } from 'node:crypto';

/**
 * Random tokens a browser holds and the server looks up: session tokens
 * (`sessions.ts`) and welcome links' (`welcome.ts`). Only a token's SHA-256
 * hash is stored, so a database dump cannot be replayed as a login. A token
 * is 256 bits of entropy, so an unsalted hash is enough — there is nothing to
 * brute-force.
 */

export function newSecret(): string {
	return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
	return createHash('sha256').update(secret, 'utf8').digest('hex');
}
