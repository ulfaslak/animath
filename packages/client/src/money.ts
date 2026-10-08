import type { CurrencyId, LandId } from '@mathgame/engine';
import { getLand } from '@mathgame/engine';
import { t, type ParamValue } from './copy';
import { game } from './state/game.svelte';

/**
 * What a land pays in, in the language on screen ([[PRODUCT]] §4 "Lands"):
 * Nordland's tokens, The Arctic's ice dollars. A sentence about money reads
 * `{money.word}` for one and `{money.words}` for more, so the same line says
 * "12 tokens" in Nordland and "12 ice dollars" in The Arctic.
 */

/** Each currency's group in the copy files (`currency.<key>.*`). */
const KEYS: Readonly<Record<CurrencyId, string>> = {
	tokens: 'tokens',
	'ice-dollars': 'iceDollars'
};

/** The money of `land` (the land on screen by default) as a line's `{money.form}` param. */
export function moneyWords(land: LandId = game.land): ParamValue {
	const key = KEYS[getLand(land).currency];
	return { word: t(`currency.${key}.word`), words: t(`currency.${key}.words`) };
}

/** The currency of `land` (the land on screen by default): what its coin looks like. */
export function currencyOf(land: LandId = game.land): CurrencyId {
	return getLand(land).currency;
}
