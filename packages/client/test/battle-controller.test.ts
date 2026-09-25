import type { GameEvent, Intent } from '@mathgame/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { BattleController } from '../src/battle/controller';
import type { GameRenderer } from '../src/render/renderer';
import { battle } from '../src/state/battle.svelte';

/**
 * The battle screen's input and pacing, driven by keys against the real
 * authority: what a key does in each screen, what it must never do (a held
 * walking key scrolling the menu, an empty Enter spending the turn, a mashed
 * Enter skipping the result card), and that events for a battle no longer on
 * screen are ignored. The Three.js scene is built but never drawn.
 */
function key(name: string, repeat = false): KeyboardEvent {
	return {
		key: name,
		repeat,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		preventDefault() {}
	} as unknown as KeyboardEvent;
}

function setup() {
	const authority = new LocalAuthority();
	const shown: unknown[] = [];
	const renderer = { setBattle: (scene: unknown) => shown.push(scene) } as unknown as GameRenderer;
	const controller = new BattleController(authority, renderer);
	const events: GameEvent[] = [];
	const sent: Intent[] = [];
	const dispatch = authority.dispatch.bind(authority);
	authority.dispatch = (intent) => {
		sent.push(intent);
		dispatch(intent);
	};
	authority.subscribe((e) => {
		events.push(e);
		controller.handle(e);
	});
	authority.start();
	/** Advance the screen by `seconds`, a frame at a time. */
	const run = (seconds: number) => {
		for (let t = 0; t < seconds; t += 1 / 60) controller.update(1 / 60);
	};
	/** Advance a frame at a time until `done()`; fail after `max` seconds. */
	const runUntil = (done: () => boolean, max = 20) => {
		for (let t = 0; !done(); t += 1 / 60) {
			if (t > max) throw new Error('timed out');
			controller.update(1 / 60);
		}
	};
	/** Press keys, one frame apart, as the game loop would see them. */
	const press = (...names: string[]) =>
		names.forEach((n) => {
			controller.onKey(key(n));
			controller.update(1 / 60);
		});
	/** Walk left/right past the reed by the spawn tile until an otter jumps out. */
	const walkIntoBattle = () => {
		for (let i = 0; !battle.active; i++) {
			if (i > 400) throw new Error('no encounter');
			authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		}
	};
	return { authority, controller, events, sent, shown, run, runUntil, press, walkIntoBattle };
}

beforeEach(() => {
	battle.reset();
	battle.level = 1;
});

describe('battle screen', () => {
	it('appears once the step into the grass has landed, then narrates the start', () => {
		const t = setup();
		t.walkIntoBattle();
		expect(battle.entering).toBe(true);
		expect(t.shown).toEqual([]);
		t.run(0.4);
		expect(battle.entering).toBe(false);
		expect(t.shown).toHaveLength(1);
		expect(battle.line).toBe('A wild Otter appears!');
		expect(battle.screen).toBe('busy');
		t.run(3);
		expect(battle.screen).toBe('actions');
		expect(battle.line).toBe('What will Squirrel do?');
	});

	it('ignores a key held down from walking and every key while a turn plays', () => {
		const t = setup();
		t.walkIntoBattle();
		// The arrow that walked into the grass is still down: only repeats arrive.
		for (let i = 0; i < 20; i++) t.controller.onKey(key('ArrowDown', true));
		t.run(3);
		for (let i = 0; i < 20; i++) t.controller.onKey(key('ArrowDown', true));
		expect(battle.cursor).toBe(0);
		t.press('ArrowDown');
		expect(battle.cursor).toBe(1);

		t.press('ArrowUp', 'Enter'); // Nut Toss, level 1
		expect(battle.screen).toBe('puzzle');
		const puzzle = battle.puzzle!;
		t.press(...String(puzzle.answer), 'Enter');
		const before = t.sent.length;
		t.press('Enter', '1', 'Enter', 'ArrowDown', ' ');
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('busy');
	});

	it('does not take an empty answer, caps its length and lets Backspace fix it', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		t.press('1');
		expect(battle.screen).toBe('puzzle');
		const before = t.sent.length;
		t.press('Enter', '-', 'Enter', 'x', '.', 'ArrowLeft');
		expect(t.sent.length).toBe(before);
		expect(battle.input).toBe('-');
		t.press('-', '1', '2', '3', '4', '5', '6', '7', '8');
		expect(battle.input).toBe('-123456');
		t.press(
			'Backspace',
			'Backspace',
			'Backspace',
			'Backspace',
			'Backspace',
			'Backspace',
			'Backspace'
		);
		expect(battle.input).toBe('');
		t.press('0', '0', '7', 'Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'answer', input: '007' } });
	});

	it('shows the right answer after a wrong one, and the damage the wild animal deals', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		t.press('1');
		const answer = battle.puzzle!.answer;
		t.press(...String(answer + 1), 'Enter');
		t.run(0.1);
		expect(battle.judged).toEqual({ correct: false, answer });
		expect(battle.line).toBe(`Not quite! It was ${answer}.`);
		t.run(8);
		expect(battle.screen).toBe('actions');
		expect(battle.party[0]!.hp).toBeLessThan(20);
		expect(battle.opponent!.hp).toBe(32);
	});

	it('keeps the result card up through a mashed Enter, then leaves on the next one', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		expect(battle.outcome).toBe('fled');
		expect(battle.closing).toBe('The wild Otter stays in the grass.');
		t.press('Enter');
		expect(battle.active).toBe(true);
		t.run(1);
		t.press('Enter');
		expect(battle.active).toBe(false);
		expect(t.shown.at(-1)).toBeNull();
	});

	it('ignores battle events that arrive when no battle is on screen', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		const updated = (): Extract<GameEvent, { type: 'battle-updated' }> => {
			const e = t.events.findLast((e) => e.type === 'battle-updated');
			if (e?.type !== 'battle-updated') throw new Error('no update');
			return e;
		};
		t.press('ArrowUp', 'Enter');
		t.run(3);
		t.press('Enter');
		expect(battle.active).toBe(false);
		const shown = t.shown.length;
		t.controller.handle(updated());
		t.controller.handle({ type: 'message', text: 'late' });
		t.run(3);
		expect(battle.active).toBe(false);
		expect(battle.screen).toBe('busy');
		expect(battle.line).toBe('');
		expect(t.shown).toHaveLength(shown);
	});
});
