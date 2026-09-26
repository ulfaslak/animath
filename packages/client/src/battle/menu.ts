import { ATTACK_LEVELS, type AnimalSpec, type AttackLevel } from '@mathgame/engine';
import { t } from '../copy';
import { tappedLevel, tappedRow } from '../input/press';
import { attackName } from '../names';

/**
 * The battle menus as pure data: which row the cursor is on, the level each
 * attack is set to, and what a key does on the action menu and on the party
 * list. `BattleController` keeps the state in the `battle` view and asks
 * these functions what each key means, and `BattlePanel` draws the attack
 * rows from `attackRows`, so `test/battle-menu.test.ts` checks what the kid
 * sees without a screen.
 */

/** What a row of the action menu does: every attack in order, then Leash, Switch and Run. */
export type BattleAction =
	{ kind: 'attack'; index: number } | { kind: 'leash' } | { kind: 'switch' } | { kind: 'run' };

const AFTER_ATTACKS = ['leash', 'switch', 'run'] as const;
type OtherAction = (typeof AFTER_ATTACKS)[number];

/** What the menu row at `cursor` does, given how many attacks the animal has. */
export function actionAt(cursor: number, attackCount: number): BattleAction {
	if (cursor < attackCount) return { kind: 'attack', index: cursor + 1 };
	const i = Math.min(cursor - attackCount, AFTER_ATTACKS.length - 1);
	return { kind: AFTER_ATTACKS[i]! };
}

/** Rows in the action menu: every attack, then Leash, Switch and Run. */
export function actionCount(attackCount: number): number {
	return attackCount + AFTER_ATTACKS.length;
}

/** The row Leash, Switch or Run sits on. */
export function rowOf(kind: OtherAction, attackCount: number): number {
	return attackCount + AFTER_ATTACKS.indexOf(kind);
}

/**
 * The level each attack is set to, by species and attack, so every row has
 * its own and a squirrel's Nut Toss keeps its level from battle to battle.
 * An attack that was never set is at level 1.
 */
export type Levels = Readonly<Record<string, AttackLevel>>;

export function levelOf(levels: Levels, speciesId: string, attackId: string): AttackLevel {
	return levels[`${speciesId}/${attackId}`] ?? ATTACK_LEVELS[0];
}

function withLevel(levels: Levels, spec: AnimalSpec, attack: number, level: AttackLevel): Levels {
	return { ...levels, [`${spec.id}/${spec.attacks[attack - 1]!.id}`]: level };
}

function clampLevel(level: number): AttackLevel {
	const lo = ATTACK_LEVELS[0];
	const hi = ATTACK_LEVELS[ATTACK_LEVELS.length - 1]!;
	return Math.max(lo, Math.min(hi, level)) as AttackLevel;
}

/** What a level is called, in the language on screen: easy, medium or hard. */
export function levelWord(level: AttackLevel): string {
	switch (level) {
		case 1:
			return t('battle.level.easy');
		case 2:
			return t('battle.level.medium');
		case 3:
			return t('battle.level.hard');
	}
}

/** One attack row as the panel draws it: its name, its own level and that level's word. */
export interface AttackRow {
	/** 1-based, as the engine counts attacks. */
	index: number;
	/** In the language on screen. */
	name: string;
	level: AttackLevel;
	word: string;
}

export function attackRows(spec: AnimalSpec, levels: Levels): AttackRow[] {
	return spec.attacks.map((attack, i) => {
		const level = levelOf(levels, spec.id, attack.id);
		return { index: i + 1, name: attackName(spec.id, i + 1), level, word: levelWord(level) };
	});
}

export interface Menu {
	/** Highlighted row: the attacks, then Leash, Switch and Run. */
	cursor: number;
	levels: Levels;
}

/** What a key on the action menu picked. `switch` opens the party list. */
export type MenuChoice =
	| { kind: 'attack'; attackIndex: number; level: AttackLevel }
	| { kind: 'leash' }
	| { kind: 'switch' }
	| { kind: 'run' };

export interface MenuKey {
	menu: Menu;
	/** False for a key the menu has no use for, so the browser keeps it. */
	handled: boolean;
	choice?: MenuChoice;
}

/**
 * One key on the action menu of the animal `spec`. Up/down (W/S) move the
 * cursor, wrapping round; left/right (A/D) change the highlighted attack's
 * own level and nothing else; 1/2/3 set that level and attack at once;
 * Enter or Space pick the highlighted row. `key` is the key's `keyName`, so
 * a W typed with Caps Lock on is a `w` here.
 *
 * A pointer's keys (`input/press.ts`): a tap on a row highlights it, and a
 * tap on the row already highlighted picks it, as Enter does, since a pick
 * spends the turn and the kid should see what the row does first; a tap on
 * a level button sets the highlighted attack's level, as left/right do.
 */
export function menuKey(menu: Menu, key: string, spec: AnimalSpec): MenuKey {
	const rows = actionCount(spec.attacks.length);
	const cursor = Math.min(Math.max(0, menu.cursor), rows - 1);
	const row = tappedRow(key);
	if (row !== undefined) {
		if (row >= rows) return { menu, handled: true };
		if (row !== cursor) return { menu: { ...menu, cursor: row }, handled: true };
		return menuKey({ ...menu, cursor }, 'Enter', spec);
	}
	const action = actionAt(cursor, spec.attacks.length);
	const attack = action.kind === 'attack' ? action.index : 0;
	const level = attack ? levelOf(menu.levels, spec.id, spec.attacks[attack - 1]!.id) : 1;
	const setLevel = (to: AttackLevel): Menu => ({
		cursor,
		levels: withLevel(menu.levels, spec, attack, to)
	});
	const tapped = tappedLevel(key);
	if (tapped !== undefined) {
		return { menu: attack ? setLevel(tapped) : menu, handled: true };
	}
	switch (key) {
		case 'ArrowUp':
		case 'w':
			return { menu: { ...menu, cursor: (cursor + rows - 1) % rows }, handled: true };
		case 'ArrowDown':
		case 's':
			return { menu: { ...menu, cursor: (cursor + 1) % rows }, handled: true };
		case 'ArrowLeft':
		case 'a':
		case 'ArrowRight':
		case 'd': {
			if (!attack) return { menu, handled: true };
			const step = key === 'ArrowLeft' || key === 'a' ? -1 : 1;
			return { menu: setLevel(clampLevel(level + step)), handled: true };
		}
		case '1':
		case '2':
		case '3': {
			if (!attack) return { menu, handled: true };
			const chosen = clampLevel(Number(key));
			return {
				menu: setLevel(chosen),
				handled: true,
				choice: { kind: 'attack', attackIndex: attack, level: chosen }
			};
		}
		case 'Enter':
		case ' ':
			if (attack) {
				return { menu, handled: true, choice: { kind: 'attack', attackIndex: attack, level } };
			}
			return { menu, handled: true, choice: { kind: action.kind as OtherAction } };
	}
	return { menu, handled: false };
}

/**
 * The menu as it stands while the puzzle of attack `attackIndex` (1-based)
 * at `level` is up: the cursor on that attack, set to that level. After a
 * pick nothing changes; a battle picked up from a save mid-puzzle needs it,
 * since the page forgot where the cursor was and every level but this one.
 */
export function pickedMenu(
	menu: Menu,
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel
): Menu {
	const attack = spec.attacks[attackIndex - 1];
	if (!attack) return menu;
	const cursor = attackIndex - 1;
	if (levelOf(menu.levels, spec.id, attack.id) === level) return { ...menu, cursor };
	return { cursor, levels: withLevel(menu.levels, spec, attackIndex, level) };
}

/** What a key on the party list picked: the highlighted animal, or going back to the menu. */
export type ListChoice = 'pick' | 'back';

/**
 * One key on the party list of `count` animals. Up/down (W/S) move the
 * cursor over every animal, wrapping round, tired ones included; Enter or
 * Space pick the highlighted one; Escape goes back. Whether a pick or going
 * back is allowed is the caller's to decide. A tap on a row highlights it,
 * and a tap on the highlighted row picks it, as on the action menu.
 */
export function listKey(
	cursor: number,
	key: string,
	count: number
): { cursor: number; handled: boolean; choice?: ListChoice } {
	const row = tappedRow(key);
	if (row !== undefined) {
		if (row >= count) return { cursor, handled: true };
		return row === cursor ? { cursor, handled: true, choice: 'pick' } : { cursor: row, handled: true };
	}
	switch (key) {
		case 'ArrowUp':
		case 'w':
			return { cursor: (cursor + count - 1) % count, handled: true };
		case 'ArrowDown':
		case 's':
			return { cursor: (cursor + 1) % count, handled: true };
		case 'Enter':
		case ' ':
			return { cursor, handled: true, choice: 'pick' };
		case 'Escape':
			return { cursor, handled: true, choice: 'back' };
	}
	return { cursor, handled: false };
}

/** Where the party list's cursor starts: the first animal who can step in. */
export function firstPickable(pickable: readonly boolean[]): number {
	return Math.max(0, pickable.indexOf(true));
}
