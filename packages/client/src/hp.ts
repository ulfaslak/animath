import { getAnimal, type AnimalInstance } from '@mathgame/engine';
import { t } from './copy';

/**
 * HP as the screen shows it: the colour of an HP bar (`ui/HpBar.svelte`),
 * and what a card of several animals says about them (`ui/BundleCard.svelte`,
 * the pause menu's rows).
 */

/** An HP bar's colour: good above a half, warn above a fifth, bad at a fifth and under. */
export type HpBand = 'good' | 'warn' | 'bad';

/** The colour of a bar showing `hp` of `max`. */
export function hpBand(hp: number, max: number): HpBand {
	const fraction = max > 0 ? hp / max : 0;
	return fraction > 0.5 ? 'good' : fraction > 0.2 ? 'warn' : 'bad';
}

/**
 * A card of several animals, counted: `ready` to play with some HP to spare,
 * `tiredSoon` (still playing, but their bar is red: a fifth of their HP or
 * less), `tired` (0 HP); and the HP of all of them together, of `max`.
 */
export interface StackHealth {
	ready: number;
	tiredSoon: number;
	tired: number;
	hp: number;
	max: number;
}

export function stackHealth(animals: readonly AnimalInstance[]): StackHealth {
	const health: StackHealth = { ready: 0, tiredSoon: 0, tired: 0, hp: 0, max: 0 };
	for (const animal of animals) {
		const max = getAnimal(animal.speciesId).maxHp;
		health.hp += animal.hp;
		health.max += max;
		if (animal.hp <= 0) health.tired++;
		else if (hpBand(animal.hp, max) === 'bad') health.tiredSoon++;
		else health.ready++;
	}
	return health;
}

/**
 * How a card of several animals is doing, in words, one part for each kind
 * of animal it holds: "All ready", "All tired soon", "All tired" when they
 * are all one kind, else each count that isn't zero ("3 ready", "2 tired
 * soon", "1 tired"), shown with " · " between them. "All ready" is never
 * said of a card with an animal whose bar is red.
 */
export function stackSummary(animals: readonly AnimalInstance[]): string[] {
	const { ready, tiredSoon, tired } = stackHealth(animals);
	const all = animals.length;
	if (ready === all) return [t('team.allReady')];
	if (tiredSoon === all) return [t('team.allTiredSoon')];
	if (tired === all) return [t('team.allTired')];
	const parts: string[] = [];
	if (ready > 0) parts.push(t('team.ready', { count: ready }));
	if (tiredSoon > 0) parts.push(t('team.tiredSoon', { count: tiredSoon }));
	if (tired > 0) parts.push(t('team.tired', { count: tired }));
	return parts;
}
