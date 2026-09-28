import {
	ANIMALS,
	ATTACK_LEVELS,
	attackDamage,
	getAnimal,
	newGame,
	readSave,
	restoreGame,
	saveDocument,
	spawnPoint,
	step,
	tileAtWorld,
	worldSeed,
	type AnimalInstance,
	type AttackLevel,
	type BattleOutcome,
	type BattleState,
	type GameEvent,
	type Intent,
	type Puzzle,
	type SavedGame
} from '@mathgame/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CueName } from '../src/audio/cues';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import {
	BattleController,
	ENTER_SECONDS,
	IRIS_OPEN_SECONDS,
	LANDING_WAIT_SECONDS
} from '../src/battle/controller';
import { actionAt, attackRows, rowOf, WILD_MOVES } from '../src/battle/menu';
import { parseParty } from '../src/flags';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { levelKey, rowKey } from '../src/input/press';
import { everyMash } from './mash';
import { words } from '../src/lines';
import { nameOf } from '../src/names';
import { BattleScene } from '../src/render/battle-scene';
import type { GameRenderer } from '../src/render/renderer';
import { battle } from '../src/state/battle.svelte';

/**
 * The battle screen's input and pacing, driven by keys against the real
 * authority: what a key does in each screen, what it must never do (a held
 * walking key scrolling the menu, an empty Enter spending the turn, a mashed
 * Enter skipping the result card), and that events for a battle no longer on
 * screen are ignored. The Three.js scene is built but never drawn.
 */

/** The page's clock in ms, for the key events' `timeStamp`: every frame below moves it on. */
let now = 0;

function key(name: string, repeat = false): KeyboardEvent {
	return {
		key: name,
		repeat,
		timeStamp: now,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		preventDefault() {}
	} as unknown as KeyboardEvent;
}

function name(animal: AnimalInstance): string {
	return nameOf(animal);
}

/** The narration line as the panel words it: in English, as tests run. */
function said(): string {
	return battle.line ? words(battle.line) : '';
}

/** A closing line that arrives after its battle is over. */
const LATE = { key: 'battle.closing.fled', params: { animal: { speciesId: 'fox' } } } as const;

/** The previous test's cue listener, dropped when the next one starts listening. */
let stopListening: (() => void) | undefined;

/** A save round trip, as a reload does it: JSON through storage, then restored. */
function throughSave(game: SavedGame): SavedGame {
	const doc = saveDocument(game, { lineage: 'test', seq: 1 });
	const read = readSave(JSON.parse(JSON.stringify(doc)));
	if (!read.ok) throw new Error(read.error);
	return restoreGame(read.save);
}

/**
 * A game to play: a starting party (`?party=` style), or a saved game to pick
 * up; `landing`, what explore says of a flight still coming down on screen.
 */
function setup(from: { party?: string; game?: SavedGame; landing?: () => boolean } = {}) {
	const authority = new LocalAuthority(from.party ? { party: parseParty(from.party)! } : {});
	const shown: unknown[] = [];
	const renderer = {
		setBattle: (scene: unknown) => shown.push(scene),
		playerScreenPoint: () => ({ x: 640, y: 380 })
	} as unknown as GameRenderer;
	// Every cue the screen asks for, in order (no sound in tests: nothing unlocks it).
	const cues: CueName[] = [];
	stopListening?.();
	stopListening = sfx.onCue((cue) => cues.push(cue));
	const controller = new BattleController(authority, renderer, from.landing);
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
	authority.start(from.game ? { game: from.game } : {});
	/** One frame of the game loop. */
	const frame = () => {
		controller.update(1 / 60);
		now += 1000 / 60;
	};
	/** Advance the screen by `seconds`, a frame at a time. */
	const run = (seconds: number) => {
		for (let t = 0; t < seconds; t += 1 / 60) frame();
	};
	/** Advance a frame at a time until `done()`; fail after `max` seconds. */
	const runUntil = (done: () => boolean, max = 20) => {
		for (let t = 0; !done(); t += 1 / 60) {
			if (t > max) throw new Error('timed out');
			frame();
		}
	};
	/**
	 * Press keys, as the game loop would see them: `gap` seconds apart, or
	 * 0.35 s by default, a kid's quick deliberate pace. Two picks that close
	 * together are a mash (`input/pick-guard.ts`): `pick` waits a quiet moment first.
	 */
	const pressEvery = (gap: number, ...names: string[]) =>
		names.forEach((n) => {
			controller.onKey(key(n));
			run(gap);
		});
	const press = (...names: string[]) => pressEvery(0.35, ...names);
	/** A deliberate pick: a quiet moment, then each key. */
	const pick = (...names: string[]) =>
		names.forEach((n) => {
			run(PICK_QUIET_SECONDS);
			press(n);
		});
	/** Play the narration until the action menu is back and past its quiet moment, so it takes a pick. */
	const toMenu = () => {
		runUntil(() => battle.screen === 'actions');
		run(PICK_QUIET_SECONDS);
	};
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
	/** The party as the authority last reported it. */
	const partyNow = (): AnimalInstance[] => {
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]!;
			if (e.type === 'party-changed' || e.type === 'welcome') return e.party;
		}
		return [];
	};
	/**
	 * Play one battle out trying to catch the wild animal, driving the
	 * authority directly (the screen plays along), until its result card is
	 * up. The wild animal is worn down with the hardest hit that leaves it
	 * standing, then leashed. The outcome: a catch, or a battle won or lost.
	 */
	const playForCatch = (): BattleOutcome => {
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
		return battle.outcome!;
	};
	/** Leave the result card: wait out its guard, then Enter. */
	const leaveResult = () => {
		run(1);
		press('Enter');
		expect(battle.active).toBe(false);
	};
	/**
	 * Every animal back to full HP, as the doctor leaves them: the game picked
	 * up again where it stands with the team fit (a lost battle heals nobody,
	 * and the doctor's own heal is the doctor's tests').
	 */
	const restAll = () => {
		const now = authority.snapshot();
		const party = now.party.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
		authority.start({ game: { ...now, party } });
		for (const a of partyNow()) expect(a.hp).toBe(getAnimal(a.speciesId).maxHp);
	};
	/** Catch animals until the party has `size`, leaving each result card; a lost battle is rested from. */
	const growParty = (size: number) => {
		for (let battles = 0; partyNow().length < size; battles++) {
			if (battles > 60) throw new Error('caught nothing');
			const outcome = playForCatch();
			leaveResult();
			if (outcome === 'lost') restAll();
		}
	};
	/** Play battles until one ends in a catch, and stay on its result card. */
	const catchOne = () => {
		for (let battles = 0; ; battles++) {
			if (battles > 60) throw new Error('caught nothing');
			const outcome = playForCatch();
			if (outcome === 'caught') return;
			leaveResult();
			if (outcome === 'lost') restAll();
		}
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
		pressEvery,
		pick,
		toMenu,
		walkIntoBattle,
		latest,
		partyNow,
		growParty,
		catchOne,
		leaveResult,
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
		expect(said()).toBe(`A wild ${name(battle.opponent!)} appears!`);
		expect(battle.screen).toBe('busy');
		t.run(3);
		expect(battle.screen).toBe('actions');
		expect(said()).toBe('What will Squirrel do?');
	});

	it('a battle in the air waits for the landing on screen, then closes its iris on the kid, down, and opens on the bird swooping down (#91)', () => {
		/** From World 1's start up over the lake, a robin in the team: a robin notices the glider on step 4. */
		const flight = (landing: () => boolean) => {
			const game = {
				...newGame(1),
				pos: { x: -2, y: 6 },
				facing: 'up' as const,
				items: ['glider'],
				party: [{ id: 'red', speciesId: 'robin', hp: 19 }]
			};
			const t = setup({ game, landing });
			t.authority.dispatch({ type: 'take-off' });
			for (let i = 0; i < 18; i++) t.authority.dispatch({ type: 'glide' });
			expect(t.events.some((e) => e.type === 'bird-follows')).toBe(true);
			expect(battle.active && battle.entering).toBe(true);
			return t;
		};
		let down = false;
		const t = flight(() => !down);
		// The world is still bringing the kid down: no iris, no jingle, no scene.
		t.run(1.5);
		expect(battle.entering).toBe(true);
		expect(battle.transition).toBeNull();
		expect(t.cues).not.toContain('encounter');
		expect(t.shown).toEqual([]);
		// Down: now the iris closes on the kid, and the scene opens in the sky.
		down = true;
		t.run(1 / 60);
		expect(battle.transition).toMatchObject({ kind: 'iris', closing: true });
		expect(t.cues).toContain('encounter');
		t.run(ENTER_SECONDS + 0.05);
		expect(t.shown).toHaveLength(1);
		expect(battle.realm).toBe('air');
		expect(said()).toBe(`A wild ${name(battle.opponent!)} swoops down!`);
		// However long the world takes, the iris waits no longer than LANDING_WAIT_SECONDS.
		const stuck = flight(() => true);
		stuck.run(LANDING_WAIT_SECONDS - 0.1);
		expect(battle.transition).toBeNull();
		stuck.run(0.2);
		expect(battle.transition).toMatchObject({ kind: 'iris', closing: true });
		// Not flying: the iris closes at once, as ever.
		battle.reset();
		const walked = setup({ landing: () => false });
		walked.walkIntoBattle();
		expect(battle.transition).toMatchObject({ kind: 'iris', closing: true, p: 0 });
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
		expect(said()).toBe(`A wild ${name(battle.opponent!)} appears!`);
		t.run(IRIS_OPEN_SECONDS + 0.05);
		expect(battle.transition).toBeNull();
		// Leaving never leaves a transition behind.
		t.toMenu();
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
		t.toMenu();
		for (let i = 0; i < 3; i++) t.controller.onKey(key('ArrowDown', true));
		expect(battle.cursor).toBe(0);
		t.press('ArrowDown');
		expect(battle.cursor).toBe(1);

		t.press('ArrowUp', 'Enter'); // Nut Toss, level 1
		expect(battle.screen).toBe('puzzle');
		const puzzle = battle.puzzle as Puzzle;
		t.press(...String(puzzle.answer), 'Enter');
		const before = t.sent.length;
		t.press('Enter', '1', 'Enter', 'ArrowDown', ' ');
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('busy');
	});

	it('does not take an empty answer, caps its length and lets Backspace fix it', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
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
		t.toMenu();
		const hp = battle.opponent!.hp;
		t.press('1');
		const answer = (battle.puzzle as Puzzle).answer;
		t.press(...String(answer + 1), 'Enter');
		t.run(0.1);
		expect(battle.judged).toEqual({ correct: false });
		expect(said()).toBe('Not quite!');
		t.run(1.1);
		expect(said()).toBe(`Missed! The wild ${name(battle.opponent!)} shrugs it off.`);
		t.run(8);
		expect(battle.screen).toBe('actions');
		expect(battle.opponent!.hp).toBe(hp);
	});

	it('keeps the result card up through a mashed Enter, however long, then leaves on the next one', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		expect(battle.outcome).toBe('fled');
		expect(battle.closing && words(battle.closing)).toBe(
			`The wild ${name(battle.opponent!)} stays in the grass.`
		);
		t.press('Enter');
		expect(battle.active).toBe(true);
		t.run(1);
		t.press('Enter');
		expect(battle.active).toBe(false);
		expect(t.shown.at(-1)).toBeNull();

		// An Enter mashed from the pick through the narration and on for two
		// seconds of the card doesn't skip it either; after a pause, one does.
		t.walkIntoBattle();
		t.toMenu();
		t.press('ArrowUp');
		t.pressEvery(0.15, 'Enter'); // Run
		expect(battle.screen).not.toBe('actions');
		for (let i = 0; battle.screen !== 'result'; i++) {
			if (i > 100) throw new Error('no result card');
			t.pressEvery(0.15, 'Enter');
		}
		t.pressEvery(0.15, ...Array<string>(14).fill('Enter'));
		expect(battle.active).toBe(true);
		t.pick('Enter');
		expect(battle.active).toBe(false);
	});

	it('frees both figures once the result card is left', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		const scene = t.shown[0] as BattleScene;
		const figures = () =>
			scene.scene.children.filter((o) => ANIMALS.some((a) => a.id === o.name)).map((o) => o.name);
		expect(figures()).toHaveLength(2);
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		t.run(1);
		// Still on screen behind the result card.
		expect(figures()).toHaveLength(2);
		t.press('Enter');
		expect(battle.active).toBe(false);
		expect(figures()).toEqual([]);
	});

	it('ignores events for a battle that is no longer on screen', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		t.press('ArrowUp', 'Enter'); // Run
		t.runUntil(() => battle.screen === 'result');
		t.run(1);
		t.press('Enter');
		expect(battle.active).toBe(false);
		const stale = t.events.filter((e) => e.type === 'battle-updated').at(-1)!;
		const shown = t.shown.length;

		// Back in explore: a late update changes nothing.
		t.controller.handle(stale);
		t.controller.handle({ type: 'message', line: LATE });
		t.run(3);
		expect(battle.active).toBe(false);
		expect(t.shown).toHaveLength(shown);

		// In the next battle: the old battle's end must not end this one.
		t.walkIntoBattle();
		t.run(4);
		expect(battle.screen).toBe('actions');
		const view = { line: battle.line, opponent: battle.opponent };
		t.controller.handle(stale);
		t.controller.handle({ type: 'message', line: LATE });
		t.run(3);
		expect(battle.screen).toBe('actions');
		expect({ line: battle.line, opponent: battle.opponent }).toEqual(view);
	});
});

describe('attack levels', () => {
	it('each attack row has its own level, read as easy, medium or hard, kept from battle to battle', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
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
		t.press(...String((battle.puzzle as Puzzle).answer + 1), 'Enter');
		t.toMenu();
		t.press('ArrowUp', 'ArrowUp', 'Enter'); // Scurry Kick → Nut Toss → Run
		t.runUntil(() => battle.screen === 'result');
		t.run(1);
		t.press('Enter');

		// The next battle remembers both rows; a level key sets its row and attacks.
		t.walkIntoBattle();
		t.toMenu();
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
		for (let i = 0; actionAt(battle.cursor, attacks(), WILD_MOVES).kind !== 'switch'; i++) {
			if (i > 8) throw new Error('no Switch row');
			t.press('ArrowDown');
		}
	}

	it('with a party of one, the Switch row does nothing', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
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
		t.toMenu();
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
		t.pick('Enter');
		t.press('ArrowUp');
		expect(battle.partyCursor).toBe(0);
		const before = t.sent.length;
		t.pick('Enter');
		expect(t.sent.length).toBe(before);
		expect(battle.refused).toBe(1);
		expect(battle.screen).toBe('party');

		t.press('s');
		t.pick('Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
		t.run(0.1);
		expect(said()).toBe(`Come back, ${name(first!)}!`);
		expect(battle.front).toBe(0);
		t.run(0.9);
		expect(said()).toBe(`Go, ${name(second!)}!`);
		expect(battle.front).toBe(1);
		// The switch took the turn: the wild animal's reply comes next.
		t.run(1.0);
		expect(said()).toMatch(new RegExp(`^Wild ${name(battle.opponent!)} used `));
		t.runUntil(() => battle.screen === 'actions');
		expect(said()).toBe(`What will ${name(second!)} do?`);
		expect(battle.cursor).toBe(0);
		expect(battle.party[0]).toEqual(first);
		expect(t.latest().active).toBe(1);
	});

	/**
	 * Answer wrong, with the second attack, until the animal in front is tired
	 * and the list of who goes next is up; with `mash`, Enter is mashed from
	 * every answer on, as a kid hurrying the text along would.
	 */
	function knockOutFront(t: ReturnType<typeof setup>, mash = false): void {
		t.press('ArrowDown');
		for (let i = 0; battle.screen !== 'party'; i++) {
			if (i > 40) throw new Error('never knocked out');
			t.press('1');
			t.press(...String((battle.puzzle as Puzzle).answer + 1), 'Enter');
			for (let j = 0; j < 300 && !['actions', 'party'].includes(battle.screen); j++) {
				if (mash) t.pressEvery(0.15, 'Enter');
				else t.run(1 / 60);
			}
			if (battle.screen === 'actions') t.run(1);
		}
	}

	it('after a knock-out: who goes next, no way back, no to a tired one, and the pick is free', () => {
		const t = setup();
		t.growParty(2);
		t.restAll();
		t.walkIntoBattle();
		t.toMenu();
		const tired = { ...battle.party[0]!, hp: 0 };
		const next = battle.party[1]!;
		knockOutFront(t);
		expect(battle.mustPick).toBe(true);
		expect(said()).toBe(`${name(tired)} is tired. Who goes next?`);
		expect(battle.party[0]).toEqual(tired);
		expect(battle.partyCursor).toBe(1);

		// An Enter pressed the moment the list comes up doesn't pick for the kid.
		const before = t.sent.length;
		t.press('Enter', ' ', 'Enter');
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('party');
		t.run(1);

		// No way back, and a level key means nothing here (left and right jump between kinds).
		t.press('Escape', '1');
		expect(battle.screen).toBe('party');
		t.press('ArrowUp');
		t.pick('Enter');
		expect(t.sent.length).toBe(before);
		expect(battle.refused).toBe(1);

		const hp = { wild: battle.opponent!.hp, next: next.hp };
		t.press('ArrowDown');
		t.pick('Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
		const update = t.events.at(-1);
		expect(update?.type === 'battle-updated' && update.events.map((e) => e.type)).toEqual([
			'switched'
		]);
		t.run(0.1);
		expect(said()).toBe(`Go, ${name(next)}!`);
		t.runUntil(() => battle.screen === 'actions');
		expect(said()).toBe(`What will ${name(next)} do?`);
		expect(battle.cursor).toBe(0);
		expect({ wild: battle.opponent!.hp, next: battle.party[1]!.hp }).toEqual(hp);
	});

	it('after a knock-out, an Enter mashed on and on through the list never picks', () => {
		const t = setup();
		t.growParty(2);
		t.restAll();
		t.walkIntoBattle();
		t.toMenu();
		knockOutFront(t, true);
		// The mash goes on for three seconds of the list, at every pace: nothing is
		// picked, nothing refused.
		const before = t.sent.length;
		for (const { name: mash, gaps } of everyMash(3)) {
			for (const gap of gaps) t.pressEvery(gap, 'Enter');
			expect(t.sent.length, mash).toBe(before);
			expect(battle.refused, mash).toBe(0);
			expect(battle.screen, mash).toBe('party');
		}
		// After a pause, one press picks.
		t.pick('Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
	});

	it('after a switch, even one that ends back on the same animal, the menu starts at the top', () => {
		const t = setup();
		t.growParty(2); // no rest: the caught animal is weak, so a reply can knock it out on arrival
		t.walkIntoBattle();
		t.toMenu();
		// Switch from the Switch row until the wild animal's reply knocks the newcomer out.
		for (let i = 0; !(battle.screen === 'party' && battle.mustPick); i++) {
			if (i > 20 || battle.screen === 'result') throw new Error('no newcomer was knocked out');
			toSwitchRow(t);
			t.pick('Enter', 'Enter');
			t.runUntil(() => ['actions', 'party', 'result'].includes(battle.screen), 30);
			if (battle.screen === 'actions') t.run(PICK_QUIET_SECONDS);
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

/**
 * A click or a tap reaches the screen as a key press (`input/press.ts`): a
 * row's key, a level button's, Go's Enter, Back's Escape. Nothing a pointer
 * does spends the turn but Go, and Go waits wherever Enter waits.
 */
describe('a pointer', () => {
	it('a tap highlights and a level button sets, sending nothing; Go does the tapped attack at that level', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		const before = t.sent.length;
		t.press(rowKey(1), levelKey(3), rowKey(1), rowKey(1));
		expect(battle.cursor).toBe(1);
		expect(attackRows(getAnimal('squirrel'), battle.levels).map((r) => r.word)).toEqual([
			'easy',
			'hard'
		]);
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('actions');
		t.press('Enter');
		expect(t.sent.at(-1)).toEqual({
			type: 'battle',
			intent: { type: 'attack', attackIndex: 2, level: 3 }
		});
	});

	it('a tap works while a turn is narrated only as far as a key does: Go waits out the quiet moment', () => {
		const t = setup();
		t.walkIntoBattle();
		t.runUntil(() => battle.screen === 'actions');
		// The menu has just come back: a tap highlights at once, as the arrows do, but Go waits.
		t.pressEvery(0.05, rowKey(1), 'Enter');
		expect(battle.cursor).toBe(1);
		expect(t.sent.filter((i) => i.type === 'battle')).toEqual([]);
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(t.sent.at(-1)).toMatchObject({ intent: { type: 'attack', attackIndex: 2 } });
		// While the turn plays, a tap does nothing at all.
		t.runUntil(() => battle.screen === 'busy' || battle.screen === 'puzzle');
		const cursor = battle.cursor;
		const sent = t.sent.length;
		t.press(rowKey(0), levelKey(1), 'Enter');
		expect(battle.cursor).toBe(cursor);
		expect(t.sent.length).toBe(sent);
	});

	it('the switch list: a tap highlights, Go sends in or shakes, Back is Escape', () => {
		const t = setup({ party: 'squirrel,rabbit' });
		t.walkIntoBattle();
		t.toMenu();
		const switchRow = rowOf('switch', getAnimal('squirrel').attacks.length, WILD_MOVES);
		t.press(rowKey(switchRow));
		expect(battle.screen).toBe('actions');
		t.press('Enter');
		expect(battle.screen).toBe('party');
		expect(battle.partyCursor).toBe(1);
		// The one in front: highlighted by a tap, refused by Go, with a shake.
		const before = t.sent.length;
		t.press(rowKey(0));
		t.pick('Enter');
		expect(battle.partyCursor).toBe(0);
		expect(battle.refused).toBe(1);
		expect(t.sent.length).toBe(before);
		// A tap elsewhere stops the shake; Back goes back to the menu, on Switch.
		t.press(rowKey(1));
		expect(battle.refused).toBe(0);
		t.press('Escape');
		expect(battle.screen).toBe('actions');
		expect(battle.cursor).toBe(switchRow);
		t.press('Enter', rowKey(1), rowKey(1));
		expect(t.sent.length).toBe(before);
		t.press('Enter');
		expect(t.sent.at(-1)).toEqual({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
	});
});

describe('mashing through the narration', () => {
	it('Enter, Space or a level key mashed through a turn never picks, however long the mash goes on', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		t.press('1');
		t.press(...String((battle.puzzle as Puzzle).answer), 'Enter');
		const answered = t.sent.length;
		const levels = { ...battle.levels };
		// Every key that picks on the menu, about six a second (the issue's own
		// mash), through the whole turn and on for two seconds of the menu.
		const mash = ['Enter', '3', ' ', '2', 'Enter', '1'];
		let pressed = 0;
		const hit = () => {
			t.controller.onKey(key(mash[pressed++ % mash.length]!));
			t.run(0.18);
		};
		while (battle.screen !== 'actions') {
			if (pressed > 200) throw new Error('the menu never came back');
			hit();
		}
		for (let s = 0; s < 2; s += 0.18) hit();
		expect(pressed).toBeGreaterThan(30);
		expect(t.sent.length).toBe(answered);
		expect(battle.screen).toBe('actions');
		expect(battle.levels).toEqual(levels);
		// The arrows move at once, and Go stays dimmed; after a pause, one press picks.
		t.press('ArrowDown');
		expect(battle.cursor).toBe(1);
		expect(battle.ready).toBe(false);
		t.pick('Enter');
		expect(t.sent.at(-1)).toEqual({
			type: 'battle',
			intent: { type: 'attack', attackIndex: 2, level: 1 }
		});
	});

	it('an Enter mashed at any pace — 2, 4 or 8 a second, uneven, or late every fourth — never picks', () => {
		for (const { name: mash, gaps } of everyMash(3)) {
			battle.reset();
			const t = setup();
			t.walkIntoBattle();
			t.toMenu();
			t.press('1');
			t.press(...String((battle.puzzle as Puzzle).answer));
			const before = t.sent.length;
			const hit = (gap: number) => {
				t.controller.onKey(key('Enter'));
				t.run(gap);
			};
			// The Enter that answers, then on through the turn and three seconds of the menu.
			let g = 0;
			for (; battle.screen !== 'actions'; g++) {
				if (g > 400) throw new Error(`${mash}: the menu never came back`);
				hit(gaps[g % gaps.length]!);
			}
			for (const gap of gaps) hit(gap);
			expect(
				t.sent.slice(before).map((i) => i.type === 'battle' && i.intent.type),
				mash
			).toEqual(['answer']);
			expect(battle.screen, mash).toBe('actions');
			expect(battle.ready, mash).toBe(false);
			// A pause, and Go lights up: one press picks.
			t.run(PICK_QUIET_SECONDS);
			expect(battle.ready, mash).toBe(true);
			t.press('Enter');
			expect(t.sent.length, mash).toBe(before + 2);
		}
	});

	it('"You won!" holds through an Enter mashed at any pace from the winning answer on', () => {
		for (const { name: mash, gaps } of everyMash(3)) {
			battle.reset();
			const t = setup();
			t.walkIntoBattle();
			t.toMenu();
			t.press('ArrowDown');
			let g = 0;
			const hit = () => {
				t.controller.onKey(key('Enter'));
				t.run(gaps[g++ % gaps.length]!);
			};
			// Scurry Kick on hard, answered right with the Enter that starts the mash,
			// until the wild animal is down.
			for (let turn = 0; battle.screen !== 'result'; turn++) {
				if (turn > 10) throw new Error(`${mash}: the wild animal never went down`);
				t.press('3');
				t.press(...String((battle.puzzle as Puzzle).answer));
				hit();
				while (!['actions', 'result'].includes(battle.screen)) hit();
				if (battle.screen === 'actions') t.run(PICK_QUIET_SECONDS);
			}
			expect(battle.outcome, mash).toBe('won');
			for (let i = 0; i < gaps.length; i++) hit();
			expect(battle.screen, mash).toBe('result');
			expect(battle.ready, mash).toBe(false);
			t.pick('Enter');
			expect(battle.active, mash).toBe(false);
		}
	});

	it('a single key the moment the menu comes back waits too, slow and deliberate as it is', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		t.press('1');
		t.press(...String((battle.puzzle as Puzzle).answer), 'Enter');
		const answered = t.sent.length;
		t.runUntil(() => battle.screen === 'actions');
		// One press, a long while after the answer, but before the kid has seen the menu.
		t.press('Enter');
		expect(t.sent.length).toBe(answered);
		t.pick('Enter');
		expect(t.sent.length).toBe(answered + 1);
	});

	it('the first menu of a battle waits too, after the opening lines', () => {
		const t = setup();
		t.walkIntoBattle();
		const before = t.sent.length;
		t.runUntil(() => battle.screen === 'actions');
		t.press('Enter', '2', ' ');
		expect(t.sent.length).toBe(before);
		expect(battle.screen).toBe('actions');
		t.run(PICK_QUIET_SECONDS);
		t.press('2');
		expect(t.sent.at(-1)).toEqual({
			type: 'battle',
			intent: { type: 'attack', attackIndex: 1, level: 2 }
		});
	});
});

describe('W A S D', () => {
	it('steer the menu and the switch list in capitals, as Caps Lock sends them', () => {
		const t = setup();
		t.growParty(2);
		t.restAll();
		t.walkIntoBattle();
		t.toMenu();
		const squirrel = getAnimal('squirrel');
		t.press('S');
		expect(battle.cursor).toBe(1);
		t.press('D');
		expect(attackRows(squirrel, battle.levels)[1]!.level).toBe(2);
		t.press('A', 'W');
		expect(attackRows(squirrel, battle.levels)[1]!.level).toBe(1);
		expect(battle.cursor).toBe(0);
		// Down past Leash to Switch, into the list, and up the list.
		t.press('S', 'S', 'S');
		expect(actionAt(battle.cursor, squirrel.attacks.length, WILD_MOVES).kind).toBe('switch');
		t.press('Enter');
		expect(battle.screen).toBe('party');
		expect(battle.partyCursor).toBe(1);
		t.press('W');
		expect(battle.partyCursor).toBe(0);
	});
});

describe('a battle picked up from a save', () => {
	it('mid-puzzle, the menu beside the puzzle lights the attack and level it belongs to', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		t.press('ArrowDown', '3'); // Scurry Kick, on hard
		t.runUntil(() => battle.screen === 'puzzle');
		const puzzle = battle.puzzle;
		const saved = throughSave(t.authority.snapshot());

		// A reload: a new page, which knows no levels, picks the battle up from the save.
		battle.reset();
		battle.levels = {};
		const u = setup({ game: saved });
		u.runUntil(() => battle.screen === 'puzzle');
		expect(battle.puzzle).toEqual(puzzle);
		expect(battle.cursor).toBe(1);
		const rows = attackRows(getAnimal('squirrel'), battle.levels);
		expect(rows.map((r) => r.word)).toEqual(['easy', 'hard']);
		expect(said()).toBe(`Squirrel tries ${rows[1]!.name}!`);
	});
});

describe('a big team', () => {
	it('a catch always joins the team, the seventh and the eighth too, and the card says so', () => {
		const t = setup({ party: 'squirrel*6' });
		for (const size of [7, 8]) {
			t.catchOne();
			expect(battle.outcome).toBe('caught');
			expect(t.partyNow()).toHaveLength(size);
			expect(t.partyNow().map((a) => a.id)).toContain(battle.opponent!.id);
			expect(battle.closing && words(battle.closing)).toBe(
				`${name(battle.opponent!)} joins your team!`
			);
			t.leaveResult();
		}
	});
});

describe('sounds', () => {
	/** Answer the puzzle on screen, right or wrong. */
	const answer = (t: ReturnType<typeof setup>, right: boolean) => {
		const correct = (battle.puzzle as Puzzle).answer;
		t.press(...String(right ? correct : correct + 1), 'Enter');
	};

	it('each cue plays with the moment on screen it goes with', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
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
		t.press(...String((battle.puzzle as Puzzle).answer));
		expect(t.cues).toEqual(['confirm']);
		t.press('Enter');
		expect(battle.judged).toEqual({ correct: true });
		expect(t.cues).toEqual(['confirm', 'correct']);
		t.runUntil(() => battle.hit !== null);
		expect(t.cues.at(-1)).toBe('hit');
	});

	it('a guarded or mashed pick makes no sound', () => {
		const t = setup();
		t.walkIntoBattle();
		t.runUntil(() => battle.screen === 'actions');
		t.cues.length = 0;
		t.press('Enter'); // before the kid has seen the menu: ignored, and silent
		expect(t.cues).toEqual([]);
		t.pressEvery(0.25, 'Enter', 'Enter', 'Enter'); // a mash, past the guard: silent too
		expect(t.cues).toEqual([]);
	});

	it('a miss bonks, the leash whooshes and ticks, then holds or springs free', () => {
		const t = setup();
		t.walkIntoBattle();
		t.toMenu();
		t.press('1');
		t.cues.length = 0;
		answer(t, false);
		expect(t.cues).toEqual(['wrong']);
		t.toMenu();

		const spec = getAnimal(t.latest().party[t.latest().active]!.speciesId);
		t.cues.length = 0;
		for (let i = 0; i < spec.attacks.length; i++) t.press('ArrowDown'); // to Leash
		t.press('Enter');
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
		t.run(1.2);
		expect(t.cues.at(-1)).toBe('wobble');
		t.run(0.4);
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
			t.run(PICK_QUIET_SECONDS);
			t.press('3'); // the first attack, hard
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

describe('another world', () => {
	it("a battle after travelling is fought on the new world's ground, not the old one's", () => {
		// A world whose spawn has tall grass beside it, on a biome World 1 does not have there.
		const WORLD_ONE = worldSeed(1);
		let found: {
			world: number;
			grass: { x: number; y: number };
			dir: 'up' | 'down' | 'left' | 'right';
		} | null = null;
		for (let world = 2; world < 200 && !found; world++) {
			const seed = worldSeed(world);
			const spawn = spawnPoint(seed);
			for (const dir of ['up', 'down', 'left', 'right'] as const) {
				const grass = step(spawn, dir);
				const tile = tileAtWorld(seed, grass.x, grass.y);
				if (tile.kind !== 'tallgrass') continue;
				if (tileAtWorld(WORLD_ONE, grass.x, grass.y).biome === tile.biome) continue;
				found = { world, grass, dir };
				break;
			}
		}
		expect(found).not.toBeNull();
		const { world, grass, dir } = found!;
		const back = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
		const begin = vi.spyOn(BattleScene.prototype, 'begin');
		const { authority } = setup();
		authority.dispatch({ type: 'travel', world });
		for (let i = 0; !battle.active; i++) {
			if (i > 400) throw new Error('no encounter');
			authority.dispatch({ type: 'move', dir: i % 2 === 0 ? dir : back[dir] });
		}
		expect(begin).toHaveBeenCalledTimes(1);
		expect(begin.mock.calls[0]![0]).toBe(tileAtWorld(worldSeed(world), grass.x, grass.y).biome);
		begin.mockRestore();
	});
});
