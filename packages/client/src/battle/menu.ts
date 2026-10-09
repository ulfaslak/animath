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

/**
 * The moves in the row under the attacks, in order: a wild battle's Leash,
 * Switch and Run. The menu takes the row as a list, so a screen with other
 * moves (a friendly match's Switch and Leave) passes its own and every
 * function here works the same on it.
 */
export const WILD_MOVES = ['leash', 'switch', 'run'] as const;
export type WildMove = (typeof WILD_MOVES)[number];

/** A friendly match's moves: Switch, then Leave (the other player wins). */
export const MATCH_MOVES = ['switch', 'leave'] as const;
export type MatchMove = (typeof MATCH_MOVES)[number];

/** Any move of either row. */
export type FightMove = WildMove | MatchMove;

/** What a row of the action menu does: every attack in order, then the moves. */
export type BattleAction<M extends string = WildMove> =
	{ kind: 'attack'; index: number } | { kind: M };

/** What the menu row at `cursor` does, given how many attacks the animal has and the moves after them. */
export function actionAt<M extends string>(
	cursor: number,
	attackCount: number,
	moves: readonly M[]
): BattleAction<M> {
	if (cursor < attackCount) return { kind: 'attack', index: cursor + 1 };
	const i = Math.min(cursor - attackCount, moves.length - 1);
	return { kind: moves[i]! };
}

/** Rows in the action menu: every attack, then the moves. */
export function actionCount(attackCount: number, moves: readonly string[]): number {
	return attackCount + moves.length;
}

/** The row a move (Leash, Switch, Run) sits on. */
export function rowOf<M extends string>(kind: M, attackCount: number, moves: readonly M[]): number {
	return attackCount + moves.indexOf(kind);
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

/** What a key on the action menu picked: an attack at its level, or a move (`switch` opens the party list). */
export type MenuChoice<M extends string = WildMove> =
	{ kind: 'attack'; attackIndex: number; level: AttackLevel } | { kind: M };

export interface MenuKey<M extends string = WildMove> {
	menu: Menu;
	/** False for a key the menu has no use for, so the browser keeps it. */
	handled: boolean;
	choice?: MenuChoice<M>;
}

/**
 * One key on the action menu of the animal `spec`, whose attacks are
 * followed by `moves`. Up/down (W/S) move the cursor through every row,
 * wrapping round; on an attack, left/right (A/D) change its own level and
 * nothing else, and 1/2/3 set that level and attack at once; on the moves,
 * which have no level, left/right go along their row, wrapping round;
 * Enter or Space pick the highlighted row. `key` is the key's `keyName`, so
 * a W typed with Caps Lock on is a `w` here.
 *
 * A pointer's keys (`input/press.ts`): a tap on a row highlights it and a
 * tap on a level button sets the highlighted attack's level, as the arrows
 * do; neither ever picks. A pick spends the turn, so it is Go's (Enter's)
 * alone: the kid sees what the row does, and at what level, before it goes.
 */
export function menuKey<M extends string>(
	menu: Menu,
	key: string,
	spec: AnimalSpec,
	moves: readonly M[]
): MenuKey<M> {
	const attacks = spec.attacks.length;
	const rows = actionCount(attacks, moves);
	const cursor = Math.min(Math.max(0, menu.cursor), rows - 1);
	const row = tappedRow(key);
	if (row !== undefined) {
		return { menu: row < rows ? { ...menu, cursor: row } : menu, handled: true };
	}
	const action = actionAt(cursor, attacks, moves);
	const attack = 'index' in action ? action.index : 0;
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
			const step = key === 'ArrowLeft' || key === 'a' ? -1 : 1;
			if (attack) return { menu: setLevel(clampLevel(level + step)), handled: true };
			// A move has no level: along the row of moves instead, round and round.
			const along = (cursor - attacks + step + moves.length) % moves.length;
			return { menu: { ...menu, cursor: attacks + along }, handled: true };
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
			return { menu, handled: true, choice: { kind: action.kind as M } };
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
 * back is allowed is the caller's to decide. A tap on a row highlights it
 * and never picks: sending an animal in is Go's (Enter's), as on the menu.
 *
 * `groups` are the rows where each species' animals start (the party is in
 * bundles): left/right (A/D) jump to the first animal of the previous or
 * next species, wrapping round, so a long list is a few presses from end to
 * end. Without them, left and right do nothing.
 */
export function listKey(
	cursor: number,
	key: string,
	count: number,
	groups: readonly number[] = []
): { cursor: number; handled: boolean; choice?: ListChoice } {
	const row = tappedRow(key);
	if (row !== undefined) return { cursor: row < count ? row : cursor, handled: true };
	switch (key) {
		case 'ArrowUp':
		case 'w':
			return { cursor: (cursor + count - 1) % count, handled: true };
		case 'ArrowDown':
		case 's':
			return { cursor: (cursor + 1) % count, handled: true };
		case 'ArrowLeft':
		case 'a':
		case 'ArrowRight':
		case 'd': {
			if (groups.length < 2) return { cursor, handled: false };
			// The group the cursor is in: the last one starting at or before it.
			let at = 0;
			for (let g = 0; g < groups.length; g++) if (groups[g]! <= cursor) at = g;
			const by = key === 'ArrowLeft' || key === 'a' ? -1 : 1;
			return { cursor: groups[(at + by + groups.length) % groups.length]!, handled: true };
		}
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

export type LeashBand = 'good' | 'warn' | 'bad';

/**
 * The leash's catch hint for a throw's real chance (UI_SPEC): at least one
 * in two is a good chance, at least one in ten is a maybe, anything less is
 * hard. One in ten, not one in five: the fiercest animals' best chance, at
 * 1 HP, is just under one in five, so a bear said "Hard to catch" all the
 * way down and wearing it out changed nothing on screen.
 */
export function leashBand(chance: number): LeashBand {
	return chance >= 0.5 ? 'good' : chance >= 0.1 ? 'warn' : 'bad';
}
