import {
	ATTACK_LEVELS,
	attackDamage,
	getAnimal,
	type AnimalInstance,
	type AttackLevel,
	type BattleState,
	type GameEvent,
	type Intent
} from '@mathgame/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CueName } from '../src/audio/cues';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { BattleController, ENTER_SECONDS, IRIS_OPEN_SECONDS } from '../src/battle/controller';
import { actionAt, attackRows } from '../src/battle/menu';
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

function name(animal: AnimalInstance): string {
	return animal.nickname ?? getAnimal(animal.speciesId).name;
}

/** The previous test's cue listener, dropped when the next one starts listening. */
let stopListening: (() => void) | undefined;

function setup() {
	const authority = new LocalAuthority();
	const shown: unknown[] = [];
	const renderer = {
		setBattle: (scene: unknown) => shown.push(scene),
		playerScreenPoint: () => ({ x: 640, y: 380 })
	} as unknown as GameRenderer;
	// Every cue the screen asks for, in order (no sound in tests: nothing unlocks it).
	const cues: CueName[] = [];
	stopListening?.();
	stopListening = sfx.onCue((cue) => cues.push(cue));
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
	/** The battle as the authority last reported it (ahead of the screen). */
	const latest = (): BattleState => {
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]!;
			if (e.type === 'battle-updated' || e.type === 'battle-started') return e.state;
		}
		throw new Error('no battle yet');
	};
	/** The party as the authority last reported it (a lost battle's trip to the tent heals it). */
	const partyNow = (): AnimalInstance[] => {
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]!;
			if (e.type === 'party-changed' || e.type === 'welcome' || e.type === 'taken-to-doctor') {
				return e.party;
			}
		}
		return [];
	};
	/**
	 * Catch animals until the party has `size`, driving the authority directly
	 * (the screen plays along), and leave each result card. The wild animal is
	 * worn down with the hardest hit that leaves it standing, then leashed.
	 */
	const growParty = (size: number) => {
		for (let battles = 0; partyNow().length < size; battles++) {
			if (battles > 60) throw new Error('caught nothing');
			walkIntoBattle();
			for (let turn = 0; turn < 80 && latest().phase.kind !== 'ended'; turn++) {
				const s = latest();
				if (s.phase.kind === 'choose-animal') {
					const partyIndex = s.party.findIndex((a) => a.hp > 0);
					authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex } });
					continue;
				}
				const mine = getAnimal(s.party[s.active]!.speciesId);
				let best: { attackIndex: number; level: AttackLevel; damage: number } | null = null;
				for (let n = 1; n <= mine.attacks.length; n++) {
					for (const level of ATTACK_LEVELS) {
						const damage = attackDamage(mine, n, level, true);
						if (damage < s.opponent.hp && (!best || damage > best.damage)) {
							best = { attackIndex: n, level, damage };
						}
					}
				}
				if (best && s.opponent.hp * 3 > getAnimal(s.opponent.speciesId).maxHp) {
					const { attackIndex, level } = best;
					authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex, level } });
					const phase = latest().phase;
					if (phase.kind !== 'solving') throw new Error(`no puzzle: ${phase.kind}`);
					const input = String(phase.puzzle.answer);
					authority.dispatch({ type: 'battle', intent: { type: 'answer', input } });
				} else {
					authority.dispatch({ type: 'battle', intent: { type: 'throw-leash' } });
				}
			}
			runUntil(() => battle.screen === 'result', 300);
			run(1);
			press('Enter');
		}
	};
	/** Lose a battle on purpose, every answer wrong: the trip to the tent heals everyone. */
	const restAll = () => {
		walkIntoBattle();
		for (let i = 0; i < 400 && latest().phase.kind !== 'ended'; i++) {
			const s = latest();
			if (s.phase.kind === 'choose-animal') {
				const partyIndex = s.party.findIndex((a) => a.hp > 0);
				authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex } });
				continue;
			}
			authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 1 } });
			authority.dispatch({ type: 'battle', intent: { type: 'answer', input: 'x' } });
		}
		runUntil(() => battle.screen === 'result', 300);
		run(1);
		press('Enter');
		for (const a of partyNow()) expect(a.hp).toBe(getAnimal(a.speciesId).maxHp);
	};
	return {
		authority,
		controller,
		events,
		sent,
		shown,
		cues,
		run,
		runUntil,
		press,
		walkIntoBattle,
		latest,
		partyNow,
		growParty,
		restAll
	};
}

beforeEach(() => {
	battle.reset();
	battle.levels = {};
});

describe('battle screen', () => {
	it('appears once the step into the grass has landed, then narrates the start', () => {
		const t = setup();
		t.walkIntoBattle();
		expect(battle.entering).toBe(true);
		expect(t.shown).toEqual([]);
		t.run(ENTER_SECONDS + 0.05);
		expect(battle.entering).toBe(false);
		expect(t.shown).toHaveLength(1);
		expect(battle.line).toBe(`A wild ${name(battle.opponent!)} appears!`);
		expect(battle.screen).toBe('busy');
		t.run(3);
		expect(battle.screen).toBe('actions');
		expect(battle.line).toBe('What will Squirrel do?');
	});

	it('closes an iris on the player, then opens it on the wild animal while the first line reads', () => {
		const t = setup();
		t.walkIntoBattle();
		expect(t.cues).toEqual(['encounter']);
		expect(battle.transition).toEqual({ kind: 'iris', closing: true, p: 0, x: 640, y: 380 });
		t.run(ENTER_SECONDS * 0.5);
		const closing = battle.transition!;
		expect(closing.closing).toBe(true);
		expect(closing.p).toBeGreaterThan(0.3);
		expect(closing.p).toBeLessThan(1);
		// Closed: the battle scene takes over and the iris opens on the wild animal.
		t.run(ENTER_SECONDS * 0.5 + 0.05);
		expect(t.shown).toHaveLength(1);
		expect(battle.transition).toMatchObject({ kind: 'iris', closing: false });
		expect(battle.line).toBe(`A wild ${name(battle.opponent!)} appears!`);
		t.run(IRIS_OPEN_SECONDS + 0.05);
		expect(battle.transition).toBeNull();
		// Leaving never leaves a transition behind.
		t.run(3);
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		t.run(1);
		t.press('Enter');
		expect(battle.transition).toBeNull();
	});

	it('ignores a key held down from walking and every key while a turn plays', () => {
		const t = setup();
		t.walkIntoBattle();
		// The arrow that walked into the grass is still down: only repeats arrive.
		for (let i = 0; i < 20; i++) t.controller.onKey(key('ArrowDown', true));
		t.run(3);
		for (let i = 0; i < 3; i++) t.controller.onKey(key('ArrowDown', true));
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

	it('says "Not quite!" after a wrong answer and never shows the right one', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		const hp = battle.opponent!.hp;
		t.press('1');
		const answer = battle.puzzle!.answer;
		t.press(...String(answer + 1), 'Enter');
		t.run(0.1);
		expect(battle.judged).toEqual({ correct: false });
		expect(battle.line).toBe('Not quite!');
		t.run(1.1);
		expect(battle.line).toBe(`Missed! The wild ${name(battle.opponent!)} shrugs it off.`);
		t.run(8);
		expect(battle.screen).toBe('actions');
		expect(battle.opponent!.hp).toBe(hp);
	});

	it('keeps the result card up through a mashed Enter, then leaves on the next one', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		expect(battle.outcome).toBe('fled');
		expect(battle.closing).toBe(`The wild ${name(battle.opponent!)} stays in the grass.`);
		t.press('Enter');
		expect(battle.active).toBe(true);
		t.run(1);
		t.press('Enter');
		expect(battle.active).toBe(false);
		expect(t.shown.at(-1)).toBeNull();
	});

	it('ignores events for a battle that is no longer on screen', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		t.run(1);
		t.press('Enter');
		expect(battle.active).toBe(false);
		const stale = t.events.filter((e) => e.type === 'battle-updated').at(-1)!;
		const shown = t.shown.length;

		// Back in explore: a late update changes nothing.
		t.controller.handle(stale);
		t.controller.handle({ type: 'message', text: 'late' });
		t.run(3);
		expect(battle.active).toBe(false);
		expect(t.shown).toHaveLength(shown);

		// In the next battle: the old battle's end must not end this one.
		t.walkIntoBattle();
		t.run(4);
		expect(battle.screen).toBe('actions');
		const view = { line: battle.line, opponent: battle.opponent };
		t.controller.handle(stale);
		t.controller.handle({ type: 'message', text: 'late' });
		t.run(3);
		expect(battle.screen).toBe('actions');
		expect({ line: battle.line, opponent: battle.opponent }).toEqual(view);
	});
});

describe('attack levels', () => {
	it('each attack row has its own level, read as easy, medium or hard, kept from battle to battle', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		const squirrel = getAnimal('squirrel');
		const words = () => attackRows(squirrel, battle.levels).map((r) => r.word);
		expect(words()).toEqual(['easy', 'easy']);

		// Right on the top row changes the top row only, and stops at hard.
		t.press('ArrowRight');
		expect(words()).toEqual(['medium', 'easy']);
		t.press('d', 'ArrowRight');
		expect(words()).toEqual(['hard', 'easy']);
		// Left on the bottom row stops at easy; right moves the bottom row only.
		t.press('ArrowDown', 'ArrowLeft');
		expect(words()).toEqual(['hard', 'easy']);
		t.press('ArrowRight');
		expect(words()).toEqual(['hard', 'medium']);

		// Enter attacks at the highlighted row's own level.
		t.press('Enter');
		expect(t.sent.at(-1)).toEqual({
			type: 'battle',
			intent: { type: 'attack', attackIndex: 2, level: 2 }
		});
		t.press(...String(battle.puzzle!.answer + 1), 'Enter');
		t.runUntil(() => battle.screen === 'actions');
		t.press('ArrowUp', 'ArrowUp', 'Enter'); // Scurry Kick → Nut Toss → Run
		t.runUntil(() => battle.screen === 'result');
		t.run(1);
		t.press('Enter');

		// The next battle remembers both rows; a level key sets its row and attacks.
		t.walkIntoBattle();
		t.run(3);
		expect(words()).toEqual(['hard', 'medium']);
		t.press('1');
		expect(t.sent.at(-1)).toEqual({
			type: 'battle',
			intent: { type: 'attack', attackIndex: 1, level: 1 }
		});
		expect(words()).toEqual(['easy', 'medium']);
	});
});

describe('switching animals', () => {
	/** Move the menu cursor down to the Switch row. */
	function toSwitchRow(t: ReturnType<typeof setup>): void {
		const attacks = () => getAnimal(battle.party[battle.front]!.speciesId).attacks.length;
		for (let i = 0; actionAt(battle.cursor, attacks()).kind !== 'switch'; i++) {
			if (i > 8) throw new Error('no Switch row');
			t.press('ArrowDown');
		}
	}

	it('with a party of one, the Switch row does nothing', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		toSwitchRow(t);
		expect(battle.pickable).toEqual([false]);
		const before = t.sent.length;
		t.press('Enter', ' ', '1', 'ArrowRight');
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('actions');
	});

	it('from the menu: the list, Escape back, no to the one in front, then the switch and the reply', () => {
		const t = setup();
		t.growParty(2);
		t.restAll(); // a caught animal is weak; one hit could knock the newcomer out
		t.walkIntoBattle();
		// Who could step in is known from the first line, so Switch never shows greyed first.
		expect(battle.pickable).toEqual([false, true]);
		t.run(3);
		const [first, second] = battle.party.map((a) => ({ ...a }));
		expect(battle.front).toBe(0);
		toSwitchRow(t);
		const switchRow = battle.cursor;

		t.press('Enter');
		expect(battle.screen).toBe('party');
		expect(battle.mustPick).toBe(false);
		expect(battle.pickable).toEqual([false, true]);
		expect(battle.partyCursor).toBe(1);
		t.press('Escape');
		expect(battle.screen).toBe('actions');
		expect(battle.cursor).toBe(switchRow);

		// The animal already in front can be highlighted, but not picked.
		t.press('Enter', 'ArrowUp');
		expect(battle.partyCursor).toBe(0);
		const before = t.sent.length;
		t.press('Enter');
		expect(t.sent.length).toBe(before);
		expect(battle.refused).toBe(1);
		expect(battle.screen).toBe('party');

		t.press('s', 'Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
		t.run(0.1);
		expect(battle.line).toBe(`Come back, ${name(first!)}!`);
		expect(battle.front).toBe(0);
		t.run(0.9);
		expect(battle.line).toBe(`Go, ${name(second!)}!`);
		expect(battle.front).toBe(1);
		// The switch took the turn: the wild animal's reply comes next.
		t.run(1.0);
		expect(battle.line).toMatch(new RegExp(`^Wild ${name(battle.opponent!)} used `));
		t.runUntil(() => battle.screen === 'actions');
		expect(battle.line).toBe(`What will ${name(second!)} do?`);
		expect(battle.cursor).toBe(0);
		expect(battle.party[0]).toEqual(first);
		expect(t.latest().active).toBe(1);
	});

	it('after a knock-out: who goes next, no way back, no to a tired one, and the pick is free', () => {
		const t = setup();
		t.growParty(2);
		t.restAll();
		t.walkIntoBattle();
		t.run(3);
		const tired = { ...battle.party[0]!, hp: 0 };
		const next = battle.party[1]!;
		// Answer wrong, with the second attack, until the one in front is tired.
		t.press('ArrowDown');
		for (let i = 0; battle.screen !== 'party'; i++) {
			if (i > 40) throw new Error('never knocked out');
			t.press('1');
			t.press(...String(battle.puzzle!.answer + 1), 'Enter');
			t.runUntil(() => battle.screen === 'actions' || battle.screen === 'party', 30);
		}
		expect(battle.mustPick).toBe(true);
		expect(battle.line).toBe(`${name(tired)} is tired. Who goes next?`);
		expect(battle.party[0]).toEqual(tired);
		expect(battle.partyCursor).toBe(1);

		// An Enter mashed through the knock-out doesn't pick for the kid.
		const before = t.sent.length;
		t.press('Enter', ' ', 'Enter');
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('party');
		t.run(1);

		t.press('Escape', 'ArrowLeft', '1');
		expect(battle.screen).toBe('party');
		t.press('ArrowUp', 'Enter');
		expect(t.sent.length).toBe(before);
		expect(battle.refused).toBe(1);

		const hp = { wild: battle.opponent!.hp, next: next.hp };
		t.press('ArrowDown', 'Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
		const update = t.events.at(-1);
		expect(update?.type === 'battle-updated' && update.events.map((e) => e.type)).toEqual([
			'switched'
		]);
		t.run(0.1);
		expect(battle.line).toBe(`Go, ${name(next)}!`);
		t.runUntil(() => battle.screen === 'actions');
		expect(battle.line).toBe(`What will ${name(next)} do?`);
		expect(battle.cursor).toBe(0);
		expect({ wild: battle.opponent!.hp, next: battle.party[1]!.hp }).toEqual(hp);
	});

	it('after a switch, even one that ends back on the same animal, the menu starts at the top', () => {
		const t = setup();
		t.growParty(2); // no rest: the caught animal is weak, so a reply can knock it out on arrival
		t.walkIntoBattle();
		t.run(3);
		// Switch from the Switch row until the wild animal's reply knocks the newcomer out.
		for (let i = 0; !(battle.screen === 'party' && battle.mustPick); i++) {
			if (i > 20 || battle.screen === 'result') throw new Error('no newcomer was knocked out');
			toSwitchRow(t);
			t.press('Enter', 'Enter');
			t.runUntil(() => ['actions', 'party', 'result'].includes(battle.screen), 30);
		}
		// The animal that was in front before the switch goes back in: it is its menu again.
		const back = battle.partyCursor;
		t.run(1);
		t.press('Enter');
		t.runUntil(() => battle.screen === 'actions');
		expect(battle.front).toBe(back);
		expect(battle.cursor).toBe(0);
	});
});

describe('sounds', () => {
	/** Answer the puzzle on screen, right or wrong. */
	const answer = (t: ReturnType<typeof setup>, right: boolean) => {
		const correct = battle.puzzle!.answer;
		t.press(...String(right ? correct : correct + 1), 'Enter');
	};

	it('each cue plays with the moment on screen it goes with', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		expect(t.cues).toEqual(['encounter']);

		// The menu: a blip per move, the level's blip a step higher, a confirm to attack.
		t.press('ArrowDown', 'ArrowUp');
		expect(t.cues.slice(1)).toEqual(['move', 'move']);
		t.press('ArrowRight');
		expect(t.cues.at(-1)).toBe('move');
		t.cues.length = 0;
		t.press('3');
		expect(t.cues).toEqual(['confirm']);

		// Typing is quiet; "Correct!" chimes, and the hit thumps with its damage.
		t.run(0.1);
		t.press(...String(battle.puzzle!.answer));
		expect(t.cues).toEqual(['confirm']);
		t.press('Enter');
		expect(battle.judged).toEqual({ correct: true });
		expect(t.cues).toEqual(['confirm', 'correct']);
		t.runUntil(() => battle.hit !== null);
		expect(t.cues.at(-1)).toBe('hit');
	});

	it('a miss bonks, the leash whooshes and ticks, then holds or springs free', () => {
		const t = setup();
		t.walkIntoBattle();
		t.run(3);
		t.press('1');
		t.run(0.1);
		t.cues.length = 0;
		answer(t, false);
		t.run(0.1);
		expect(t.cues).toEqual(['wrong']);
		t.runUntil(() => battle.screen === 'actions', 30);

		const spec = getAnimal(t.latest().party[t.latest().active]!.speciesId);
		t.cues.length = 0;
		for (let i = 0; i < spec.attacks.length; i++) t.press('ArrowDown'); // to Leash
		t.press('Enter');
		t.run(0.1);
		expect(t.cues).toEqual([
			...Array(spec.attacks.length).fill('move'),
			'confirm',
			'throw',
			'wobble'
		]);
		const thrown = t.events
			.flatMap((e) => (e.type === 'battle-updated' ? e.events : []))
			.find((e) => e.type === 'leash-thrown');
		expect(thrown).toBeDefined();
		// The loop holds or pops off 1.8 s after the throw, with its own sound.
		t.run(1.6);
		expect(t.cues.at(-1)).toBe('wobble');
		t.run(0.3);
		expect(t.cues.at(-1)).toBe(thrown!.success ? 'caught' : 'boing');
	});

	it('a win ends on a fanfare with the result card, and leaving it confirms', () => {
		const t = setup();
		t.walkIntoBattle();
		const over = () => battle.screen === 'result';
		for (let turn = 0; ; turn++) {
			if (turn > 10) throw new Error('no win');
			t.runUntil(() => battle.screen === 'actions' || over(), 30);
			if (over()) break;
			t.press('3'); // the first attack, hard
			t.run(0.1);
			answer(t, true);
		}
		expect(battle.outcome).toBe('won');
		expect(t.cues).toContain('faint');
		expect(t.cues.at(-1)).toBe('won');
		t.run(1);
		t.press('Enter');
		expect(t.cues.at(-1)).toBe('confirm');
	});
});
