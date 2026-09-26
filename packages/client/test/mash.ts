/**
 * A kid's mash, as the controller tests press it (#37): `rate` presses a
 * second, and never like a metronome. Each gap is uneven by up to 30% either
 * way, as a hand mashes, from a fixed seed so a failure replays; `late` is the
 * issue's other pattern, three quick presses and then one a little late (130 ms).
 * Gaps are in seconds.
 */

/** The rates every mash test runs at: a slow mash, an ordinary one, a frantic one. */
export const MASH_RATES = [2, 4, 8] as const;

export function mashGaps(rate: number, count: number, seed = 1): number[] {
	let s = seed;
	const next = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	return Array.from({ length: count }, () => (0.7 + 0.6 * next()) / rate);
}

export function lateMash(rate: number, count: number): number[] {
	return Array.from({ length: count }, (_, i) => 1 / rate + (i % 4 === 3 ? 0.13 : 0));
}

/** Every mash a test runs: each rate, uneven, and each rate with a late press every fourth. */
export function everyMash(seconds: number): { name: string; gaps: number[] }[] {
	return MASH_RATES.flatMap((rate) => [
		{ name: `${rate} a second`, gaps: mashGaps(rate, Math.ceil(seconds * rate), rate) },
		{ name: `${rate} a second, every fourth late`, gaps: lateMash(rate, Math.ceil(seconds * rate)) }
	]);
}
