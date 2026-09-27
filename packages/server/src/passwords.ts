import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing: Node's built-in scrypt with a random salt per password.
 * What length a password may have is the engine's rule (`checkPassword`);
 * this module only ever sees a password that passed it.
 *
 * A hash is stored as one string that carries its own parameters,
 * `$scrypt$ln=15,r=8,p=1$<salt>$<key>` (salt and key in base64url), so the
 * cost can be raised later without breaking a single stored password.
 *
 * The cost: N = 2^15, r = 8, p = 1 takes 32 MiB and about 50 ms per hash on
 * one core. Node runs it on the libuv thread pool, off the event loop, and
 * the login and register rate limits bound how many a client can ask for.
 */

interface Params {
	/** log2 of scrypt's N (cost). */
	ln: number;
	/** Block size. */
	r: number;
	/** Parallelization. */
	p: number;
}

const CURRENT: Params = { ln: 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Bounds on what `verifyPassword` accepts from a stored hash: every hash this
 * module writes is well inside them, and a corrupted row cannot make a login
 * allocate more than `MAX_MEMORY` (scrypt takes 128·N·r bytes) or work more
 * than `MAX_WORK` times as long as a hash of today's cost (N·r·p).
 */
const LIMITS = { ln: [10, 20], r: [1, 32], p: [1, 16], salt: [8, 64], key: [16, 64] } as const;
const MAX_MEMORY = 64 * 1024 * 1024;
const MAX_WORK = 4 * 2 ** CURRENT.ln * CURRENT.r * CURRENT.p;

const FORMAT =
	/^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function derive(password: string, salt: Buffer, keyBytes: number, params: Params): Promise<Buffer> {
	const N = 2 ** params.ln;
	const options: ScryptOptions = {
		N,
		r: params.r,
		p: params.p,
		// scrypt needs 128·N·r bytes; Node's default ceiling is exactly that at
		// the current cost, so give it room.
		maxmem: 256 * N * params.r
	};
	// The engine's `checkPassword` already gives NFC; normalizing again means a
	// caller that skipped it still cannot lock a tablet out of its account.
	return new Promise((resolve, reject) => {
		scrypt(password.normalize('NFC'), salt, keyBytes, options, (error, key) =>
			error ? reject(error) : resolve(key)
		);
	});
}

/** A new salted hash of `password`, with its parameters. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const key = await derive(password, salt, KEY_BYTES, CURRENT);
	const { ln, r, p } = CURRENT;
	return `$scrypt$ln=${ln},r=${r},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function within(value: number, [low, high]: readonly [number, number]): boolean {
	return value >= low && value <= high;
}

/** The parameters, salt and key of a stored hash, or null when it is not one this module wrote. */
function parse(stored: string): { params: Params; salt: Buffer; key: Buffer } | null {
	const match = FORMAT.exec(stored);
	if (!match) return null;
	const params = { ln: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
	const salt = Buffer.from(match[4]!, 'base64url');
	const key = Buffer.from(match[5]!, 'base64url');
	const sane =
		within(params.ln, LIMITS.ln) &&
		within(params.r, LIMITS.r) &&
		within(params.p, LIMITS.p) &&
		within(salt.length, LIMITS.salt) &&
		within(key.length, LIMITS.key) &&
		128 * 2 ** params.ln * params.r <= MAX_MEMORY &&
		2 ** params.ln * params.r * params.p <= MAX_WORK;
	return sane ? { params, salt, key } : null;
}

/**
 * Whether `password` is the one `stored` was made from. The keys are compared
 * in constant time. A stored value this module cannot read never matches.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parsed = parse(stored);
	if (!parsed) {
		console.error('a stored password hash is not in the scrypt format; nobody can log in with it');
		return false;
	}
	const key = await derive(password, parsed.salt, parsed.key.length, parsed.params);
	return timingSafeEqual(key, parsed.key);
}

let decoy: Promise<string> | null = null;

/**
 * Spends the time a real check takes, for a name that has no account, so the
 * answer's timing does not tell a taken name from a free one. Always false.
 */
export async function verifyDecoy(password: string): Promise<false> {
	decoy ??= hashPassword('not a password anyone has');
	await verifyPassword(password, await decoy);
	return false;
}
