import { ANIMALS, ATTACK_LEVELS, type AnimalSpec } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import {
	actionAt,
	actionCount,
	attackRows,
	firstPickable,
	listKey,
	menuKey,
	rowOf,
	type Menu
} from '../src/battle/menu';

/**
 * The battle menu's rows and levels as the panel draws them (`attackRows`)
 * and what each key does to them (`menuKey`), for every species in the
 * catalog. A level belongs to one attack row: a bug once shared one level
 * across the rows and named each row by its puzzle's difficulty, so moving
 * the top row's level relabelled the bottom row, and a squirrel's levels
 * read "easy, easy, medium".
 */
const press = (menu: Menu, spec: AnimalSpec, ...keys: string[]): Menu =>
	keys.reduce((m, key) => menuKey(m, key, spec).menu, menu);

const words = (spec: AnimalSpec, menu: Menu) => attackRows(spec, menu.levels).map((r) => r.word);

describe('attack rows', () => {
	for (const spec of ANIMALS) {
		it(`${spec.name}: every row's level is its own, and reads easy, medium, hard`, () => {
			const n = spec.attacks.length;
			for (let row = 0; row < n; row++) {
				// Walk to the row from the top, then step its level up and back down.
				const start = press({ cursor: 0, levels: {} }, spec, ...Array(row).fill('ArrowDown'));
				expect(start.cursor).toBe(row);
				const seen: string[] = [words(spec, start)[row]!];
				let menu = start;
				for (const key of ['ArrowRight', 'd', 'ArrowRight', 'ArrowLeft', 'a', 'a']) {
					menu = press(menu, spec, key);
					const now = words(spec, menu);
					seen.push(now[row]!);
					// Every other row is untouched.
					now.forEach((word, i) => i !== row && expect(word).toBe('easy'));
				}
				expect(seen).toEqual(['easy', 'medium', 'hard', 'hard', 'medium', 'easy', 'easy']);
				const levels = attackRows(spec, menu.levels).map((r) => r.level);
				expect(levels).toEqual(Array(n).fill(1));
			}
		});
	}

	it('keeps each row where it was left while the others move', () => {
		const rabbit = ANIMALS.find((a) => a.id === 'rabbit')!;
		let menu = press({ cursor: 0, levels: {} }, rabbit, 'ArrowRight', 'ArrowRight');
		menu = press(menu, rabbit, 'ArrowDown', 'ArrowDown', 'ArrowRight');
		expect(words(rabbit, menu)).toEqual(['hard', 'easy', 'medium']);
		// Another species' rows start at easy: levels are per attack.
		const fox = ANIMALS.find((a) => a.id === 'fox')!;
		expect(words(fox, menu)).toEqual(['easy', 'easy', 'easy']);
	});
});

describe('menu keys', () => {
	for (const spec of ANIMALS) {
		it(`${spec.name}: the cursor wraps, and each row does its own thing`, () => {
			const n = spec.attacks.length;
			const rows = actionCount(n);
			expect(rows).toBe(n + 3);
			expect(press({ cursor: 0, levels: {} }, spec, 'ArrowUp').cursor).toBe(rows - 1);
			expect(press({ cursor: rows - 1, levels: {} }, spec, 's').cursor).toBe(0);

			for (let cursor = 0; cursor < rows; cursor++) {
				const menu: Menu = { cursor, levels: {} };
				const action = actionAt(cursor, n);
				const enter = menuKey(menu, 'Enter', spec).choice;
				const three = menuKey(menu, '3', spec);
				if (action.kind === 'attack') {
					expect(enter).toEqual({ kind: 'attack', attackIndex: cursor + 1, level: 1 });
					// A level key sets that row's level and attacks with it.
					expect(three.choice).toEqual({ kind: 'attack', attackIndex: cursor + 1, level: 3 });
					expect(attackRows(spec, three.menu.levels)[cursor]!.word).toBe('hard');
				} else {
					expect(enter).toEqual({ kind: action.kind });
					expect(three.choice).toBeUndefined();
					// Left and right do nothing off an attack row.
					expect(press(menu, spec, 'ArrowLeft', 'ArrowRight')).toEqual(menu);
				}
			}
			expect(actionAt(rowOf('leash', n), n)).toEqual({ kind: 'leash' });
			expect(actionAt(rowOf('switch', n), n)).toEqual({ kind: 'switch' });
			expect(actionAt(rowOf('run', n), n)).toEqual({ kind: 'run' });
			expect(menuKey({ cursor: 0, levels: {} }, 'x', spec).handled).toBe(false);
		});
	}

	it('uses each level word once, in order', () => {
		const squirrel = ANIMALS[0]!;
		const menu = press({ cursor: 0, levels: {} }, squirrel);
		const all = ATTACK_LEVELS.map((level) => {
			const m = press(menu, squirrel, String(level));
			return attackRows(squirrel, m.levels)[0]!.word;
		});
		expect(all).toEqual(['easy', 'medium', 'hard']);
	});
});

describe('party list keys', () => {
	it('moves over every animal, wrapping round, and picks or goes back', () => {
		expect(listKey(0, 'ArrowUp', 3).cursor).toBe(2);
		expect(listKey(2, 'ArrowDown', 3).cursor).toBe(0);
		expect(listKey(1, 'w', 3).cursor).toBe(0);
		expect(listKey(1, 's', 3).cursor).toBe(2);
		expect(listKey(1, 'Enter', 3)).toEqual({ cursor: 1, handled: true, choice: 'pick' });
		expect(listKey(1, ' ', 3).choice).toBe('pick');
		expect(listKey(1, 'Escape', 3)).toEqual({ cursor: 1, handled: true, choice: 'back' });
		expect(listKey(1, 'ArrowLeft', 3)).toEqual({ cursor: 1, handled: false });
	});

	it('starts on the first animal who can step in', () => {
		expect(firstPickable([false, false, true, true])).toBe(2);
		expect(firstPickable([true])).toBe(0);
		expect(firstPickable([false])).toBe(0);
	});
});
