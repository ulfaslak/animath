import {
	ANIMALS,
	getAnimal,
	hashString,
	newGame,
	type AnimalInstance,
	type Direction,
	type SavedGame
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { t } from '../src/copy';
import { doctorWords } from '../src/doctor/lines';
import { ExploreController } from '../src/explore/controller';
import { hpBand, stackHealth, stackSummary } from '../src/hp';
import type { Keyboard } from '../src/input/keyboard';
import { touch } from '../src/input/touch.svelte';
import type { GameRenderer } from '../src/render/renderer';
import { game } from '../src/state/game.svelte';
import { HINT_STEPS, MESSAGE_SECONDS, hud } from '../src/state/hud.svelte';
import { besideA, gameBeside } from './clearing';
import { skyPieces } from './sky-pieces';

/**
 * The explore message line (UI_SPEC § Explore mode): what was said last fades
 * after a few seconds of the HUD being on screen, the controls hint goes after
 * a few steps, facing a tent shows how to talk to the doctor, and Enter with
 * no tent in front says how to find one. Lines the client words itself are
 * worded when shown (DECISIONS § Copy and languages). And what a card of
 * several animals says about them.
 */
function setup(start?: SavedGame) {
	const authority = new LocalAuthority();
	const sky = skyPieces();
	const renderer = {
		setWorld() {},
		setBoat() {},
		setGlider() {},
		setLandingSpot() {},
		setPlayer() {},
		ensureChunksAround() {},
		cleared() {},
		trainerPoint: sky.trainerPoint,
		chaser: sky.chaser
	} as unknown as GameRenderer;
	let enter = false;
	const keyboard = {
		tick: () => {},
		takeTap: () => undefined,
		heldDirection: () => undefined,
		takeTeamPick: () => undefined,
		takeInteract: () => {
			const pressed = enter;
			enter = false;
			return pressed;
		},
		talkKey: 'enter',
		setGlider: () => {},
		takeTakeOff: () => false,
		flyHeld: () => false,
		windUp: () => 0,
		dropTaps: () => {}
	} as unknown as Keyboard;
	const explore = new ExploreController(authority, renderer, keyboard);
	const events: string[] = [];
	authority.subscribe((e) => {
		events.push(e.type);
		game.apply(e);
		hud.apply(e);
		explore.handle(e);
	});
	authority.start(start ? { game: start } : {});
	hud.tick(0);
	const move = (...dirs: Direction[]) =>
		dirs.forEach((dir) => authority.dispatch({ type: 'move', dir }));
	/** Enter in explore, once any step on screen has landed. */
	const pressEnter = () => {
		explore.update(1);
		enter = true;
		explore.update(1 / 60);
	};
	/** `seconds` of the explore HUD on screen, a frame at a time. */
	const tick = (seconds: number) => {
		for (let s = 0; s < seconds; s += 1 / 60) hud.tick(1 / 60);
	};
	return { authority, events, move, pressEnter, tick };
}

/** The authority's closing lines after a battle with a wild rabbit, as it sends them. */
const rabbit = { speciesId: 'rabbit' };
const WON = { key: 'battle.closing.won', params: { animal: rabbit } } as const;
const JOINED = { key: 'battle.closing.joined', params: { animal: rabbit } } as const;

describe('the explore message line', () => {
	it('shows what was said for a few seconds on screen, and again when it is said again', () => {
		const s = setup();
		expect(hud.message).toBe('');
		hud.apply({ type: 'message', line: WON });
		hud.tick(0);
		expect(hud.message).toBe('The wild Rabbit runs home to rest.');
		s.tick(MESSAGE_SECONDS - 0.1);
		expect(hud.message).toBe('The wild Rabbit runs home to rest.');
		s.tick(0.2);
		expect(hud.message).toBe('');

		hud.apply({ type: 'message', line: WON });
		hud.tick(1 / 60);
		expect(hud.message).toBe('The wild Rabbit runs home to rest.');
	});

	it('never brings a line the kid read back after a battle or a match; one said while it was up waits for the HUD', () => {
		const s = setup();
		hud.notice('save.welcomeBack');
		s.tick(3);
		expect(hud.message).toBe(t('save.welcomeBack'));
		// A friendly match (or a battle) takes the screen for a while: the HUD is away.
		for (let frame = 0; frame < 600; frame++) hud.covered();
		expect(hud.message).toBe('');
		s.tick(1 / 60);
		expect(hud.message).toBe('');
		// A line said while the battle's screen is up is there to read afterwards, all of it.
		hud.apply({ type: 'message', line: WON });
		for (let frame = 0; frame < 600; frame++) hud.covered();
		s.tick(MESSAGE_SECONDS - 0.2);
		expect(hud.message).toBe('The wild Rabbit runs home to rest.');
		// Read, it goes with the next battle too.
		for (let frame = 0; frame < 10; frame++) hud.covered();
		expect(hud.message).toBe('');
	});

	it("says how to fly, or to ride, when the doctor's card closes on a glider or a harness just bought, and the goodbye otherwise", () => {
		setup();
		const visit = (before: string[], after: string[]) => {
			const state = (items: string[]) => ({
				step: 1,
				party: [],
				tokens: 0,
				items,
				shop: [],
				phase: { kind: 'ended' as const }
			});
			hud.apply({ type: 'doctor-visit-started', visit: 1, state: state(before) });
			hud.apply({ type: 'doctor-visit-ended', visit: 1, state: state(after) });
			hud.tick(0);
			return hud.message;
		};
		expect(visit([], ['glider'])).toBe(t('explore.holdToFly'));
		expect(visit(['axe'], ['axe', 'glider'])).toBe(t('explore.holdToFly'));
		// Owned already, or something else bought: the doctor's goodbye.
		expect(visit(['glider'], ['glider'])).toBe(t('doctor.goodbye'));
		expect(visit([], ['boat'])).toBe(t('doctor.goodbye'));
		// The harness just bought: put a big animal first and hop on.
		expect(visit(['glider'], ['glider', 'harness'])).toBe(t('explore.rideBig'));
		expect(visit(['harness'], ['harness'])).toBe(t('doctor.goodbye'));
		// With the touch controls on, it names the Fly button.
		touch.on = true;
		try {
			expect(visit([], ['glider'])).toBe(t('explore.holdToFlyTouch'));
		} finally {
			touch.on = false;
		}
	});

	it('keeps a line said while the HUD is off screen until it is back', () => {
		setup();
		// Said while the battle screen or the doctor's card is up: no ticks meanwhile.
		hud.apply({ type: 'message', line: JOINED });
		hud.tick(0.5);
		expect(hud.message).toBe('Rabbit joins your team!');
	});

	it("words the doctor's goodbye and the line after a lost battle from their events", () => {
		setup();
		game.apply({
			type: 'welcome',
			playerId: 'p',
			name: null,
			world: 1,
			home: 1,
			seed: 1,
			pos: { x: 0, y: 0 },
			facing: 'down',
			party: [],
			tokens: 0,
			items: [],
			solved: 0,
			seen: [],
			caught: [],
			newGame: true,
			edits: []
		});
		hud.apply({
			type: 'doctor-visit-ended',
			visit: 1,
			state: { step: 1, party: [], tokens: 0, items: [], shop: [], phase: { kind: 'ended' } }
		});
		hud.tick(0);
		expect(hud.message).toBe(doctorWords({ say: 'goodbye' }));
		expect(hud.message).toBe(t('doctor.goodbye'));
		// A lost battle's closing line is the authority's, with no animal in it.
		hud.apply({ type: 'message', line: { key: 'battle.closing.lost', params: {} } });
		hud.tick(0);
		expect(hud.message).toBe(t('battle.closing.lost'));
		hud.apply({ type: 'message', line: { key: 'doctor.came', params: {} } });
		hud.tick(0);
		expect(hud.message).toBe(t('doctor.came'));
	});

	it('while the team is tired, the line under it says to walk to a tent, until a doctor has helped', () => {
		const squirrel = { id: 'sq', speciesId: 'squirrel', hp: 0 };
		const s = setup({ ...newGame(1), party: [squirrel] });
		expect(hud.tired).toBe(true);
		// Before the controls hint, from the first step: this is what to do now.
		expect(hud.hint).toBe(t('explore.tired'));
		s.move(...Array<Direction>(7).fill('right'));
		expect(hud.hint).toBe(t('explore.tired'));
		// Facing the tent, the prompt says what Enter does there.
		s.move('down');
		expect(hud.hint).toBe(t('explore.talkPrompt'));
		// Healed at the doctor: the line is gone, and the prompt stays while the tent is faced.
		const healed = [{ ...squirrel, hp: getAnimal('squirrel').maxHp }];
		game.apply({ type: 'party-changed', party: healed });
		hud.apply({ type: 'party-changed', party: healed });
		expect(hud.tired).toBe(false);
		expect(hud.hint).toBe(t('explore.talkPrompt'));
		s.move('left');
		expect(hud.hint).toBe('');
	});

	it('out on the water only a team with nobody standing at all is tired: a walker in the boat can still battle on land', () => {
		const otter = { id: 'ot', speciesId: 'otter', hp: 0 };
		const squirrel = { id: 'sq', speciesId: 'squirrel', hp: 20 };
		const atSea = { ...newGame(1), pos: { x: -2, y: 2 }, items: ['boat'] };
		setup({ ...atSea, party: [otter] });
		expect(game.realm).toBe('water');
		expect(hud.hint).toBe(t('explore.tiredSail'));
		// A squirrel in the boat can fight on land: sailing with it is sailing in peace.
		setup({ ...atSea, party: [otter, squirrel] });
		expect(hud.tired).toBe(false);
		expect(hud.hint).toBe(t('explore.controls'));
		// On land, a crab standing is nobody who can fight there.
		setup({
			...newGame(1),
			party: [
				{ ...squirrel, hp: 0 },
				{ id: 'cr', speciesId: 'crab', hp: 20 }
			]
		});
		expect(hud.hint).toBe(t('explore.tired'));
	});

	it('Enter with no tent in front says how to find a doctor; facing one, the doctor answers', () => {
		const s = setup();
		s.move(...Array<Direction>(7).fill('right')); // (5, 6), beside the tent, facing along it
		const quiet = s.events.length;
		s.pressEnter();
		// The authority says what happened, without words; the line is worded here.
		expect(s.events.slice(quiet)).toEqual(['nothing-to-interact']);
		hud.tick(0);
		expect(hud.message).toBe(t('explore.notAtTent'));

		s.move('down'); // bumps the tent: now facing it
		// Advice followed: the prompt takes over at once, the hint does not linger above it.
		hud.tick(1 / 60);
		expect(hud.message).toBe('');
		expect(hud.hint).toBe(t('explore.talkPrompt'));
		s.pressEnter();
		expect(s.events.at(-1)).toBe('doctor-visit-started');
		hud.tick(0);
		expect(hud.message).toBe('');
	});

	it('shows the controls hint until the player has walked a few steps; bumps do not count', () => {
		const s = setup();
		expect(hud.hint).toBe(t('explore.controls'));
		for (let i = 0; i < 30; i++) s.move('up'); // a key held against the river: a bump a frame
		expect(game.steps).toBe(0);
		expect(hud.hint).toBe(t('explore.controls'));
		s.move(...Array<Direction>(HINT_STEPS - 1).fill('right'));
		expect(hud.hint).toBe(t('explore.controls'));
		s.move('right');
		expect(hud.hint).toBe('');
	});

	it('facing a tent, says how to talk to the doctor; turning away, stops', () => {
		const s = setup();
		s.move(...Array<Direction>(7).fill('right'));
		expect(game.pos).toEqual({ x: 5, y: 6 });
		expect(hud.hint).toBe(''); // beside the tent, facing along it
		s.move('down'); // bumps the tent
		expect(hud.hint).toBe(t('explore.talkPrompt'));
		s.move('left');
		expect(hud.hint).toBe('');
	});

	it('the prompt comes before the controls hint', () => {
		// A player put beside the tent (a save) before walking much.
		game.apply({
			type: 'welcome',
			playerId: 'p',
			name: null,
			world: 1,
			home: 1,
			seed: hashString('prototype'),
			pos: { x: 5, y: 6 },
			facing: 'left',
			party: [{ id: 'sq', speciesId: 'squirrel', hp: 20 }],
			tokens: 0,
			items: [],
			solved: 0,
			seen: [],
			caught: [],
			newGame: false,
			edits: []
		});
		expect(hud.hint).toBe(t('explore.controls'));
		game.apply({ type: 'player-blocked', playerId: 'p', dir: 'down' });
		expect(game.steps).toBeLessThan(HINT_STEPS);
		expect(hud.hint).toBe(t('explore.talkPrompt'));
	});

	it('a game picked up facing a tent shows the prompt at once', () => {
		// Saved while facing the tent below (5, 6): `welcome` carries the facing.
		game.apply({
			type: 'welcome',
			playerId: 'p',
			name: null,
			world: 1,
			home: 1,
			seed: hashString('prototype'),
			pos: { x: 5, y: 6 },
			facing: 'down',
			party: [],
			tokens: 0,
			items: [],
			solved: 0,
			seen: [],
			caught: [],
			newGame: false,
			edits: []
		});
		expect(hud.hint).toBe(t('explore.talkPrompt'));
	});
});

describe('trees and rocks in the way', () => {
	const tree = besideA('tree');
	const rock = besideA('rock');

	it('facing a tree with the axe: the prompt says Enter chops it, the Talk button says Chop, and then it is gone', () => {
		const s = setup(gameBeside(tree, ['axe']));
		expect(game.facing).toBe(tree.facing);
		expect(hud.action).toBe('chop');
		expect(hud.hint).toBe(t('explore.chopPrompt'));
		touch.on = true;
		expect(hud.hint).toBe(t('explore.chopPromptTouch'));
		touch.on = false;
		s.pressEnter();
		expect(s.events.at(-1)).toBe('tile-cleared');
		// Nothing left to chop: the controls hint is back, and nothing is said.
		expect(hud.action).toBeNull();
		expect(hud.hint).toBe(t('explore.controls'));
		hud.tick(0);
		expect(hud.message).toBe('');
		// The UI's world is the authority's.
		expect(game.edits.encode()).toEqual(s.authority.snapshot().edits);
		expect(game.edits.has(tree.target.x, tree.target.y)).toBe(true);
	});

	it('facing a rock with the pickaxe: Enter breaks it; with only the axe, nothing is offered', () => {
		setup(gameBeside(rock, ['axe']));
		expect(hud.action).toBeNull();
		expect(hud.hint).toBe(t('explore.controls'));
		const s = setup(gameBeside(rock, ['pickaxe']));
		expect(hud.action).toBe('break');
		expect(hud.hint).toBe(t('explore.breakPrompt'));
		touch.on = true;
		expect(hud.hint).toBe(t('explore.breakPromptTouch'));
		touch.on = false;
		s.pressEnter();
		expect(s.events.at(-1)).toBe('tile-cleared');
		expect(hud.action).toBeNull();
	});

	it('without the tool, the first bump says the doctor sells one, once a game; Enter says it every time', () => {
		const back = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
		const s = setup(gameBeside(tree, []));
		s.move(back[tree.facing]); // turned away (or a step away), then back to the tree
		if (game.pos.x !== tree.stand.x || game.pos.y !== tree.stand.y) s.move(tree.facing);
		s.tick(MESSAGE_SECONDS);
		expect(hud.message).toBe('');
		s.move(tree.facing); // a bump into the tree
		expect(s.events.at(-1)).toBe('player-blocked');
		hud.tick(0);
		expect(hud.message).toBe(t('explore.needAxe'));
		expect(hud.hint).not.toBe(t('explore.chopPrompt'));
		s.tick(MESSAGE_SECONDS);
		// A key held against the tree bumps every frame: said once, not on every bump.
		for (let i = 0; i < 30; i++) s.move(tree.facing);
		hud.tick(0);
		expect(hud.message).toBe('');
		// Enter asks: it is said again.
		s.pressEnter();
		expect(s.events.at(-1)).toBe('tool-needed');
		hud.tick(0);
		expect(hud.message).toBe(t('explore.needAxe'));
		// A rock is its own hint, and a new game says each again.
		setup(gameBeside(rock, ['axe']));
		const r = setup(gameBeside(rock, ['axe']));
		r.move(rock.facing);
		hud.tick(0);
		expect(hud.message).toBe(t('explore.needPickaxe'));
	});

	it('Enter at tall grass, water or a tent never clears it, whatever tools the kid has', () => {
		// On the spawn tile a river reed is to the left and water above; the tent is at (5, 7).
		const at = { ...gameBeside(tree, ['axe', 'pickaxe']), pos: { x: -2, y: 6 } };
		const s = setup({ ...at, facing: 'left' });
		expect(hud.action).toBeNull();
		s.pressEnter();
		expect(s.events.at(-1)).toBe('nothing-to-interact');
		const t2 = setup({ ...at, facing: 'up' });
		expect(hud.action).toBeNull();
		t2.pressEnter();
		expect(t2.events.at(-1)).toBe('nothing-to-interact');
		t2.move(...Array<Direction>(7).fill('right'), 'down');
		expect(hud.action).toBe('talk');
		t2.pressEnter();
		expect(t2.events.at(-1)).toBe('doctor-visit-started');
		expect(t2.authority.snapshot().edits).toEqual([]);
		expect(s.authority.snapshot().edits).toEqual([]);
	});
});

describe('a card of several animals', () => {
	let made = 0;
	const one = (speciesId: string, hp: number): AnimalInstance => ({
		id: `a${made++}`,
		speciesId,
		hp
	});
	const fox = (hp: number) => one('fox', hp);
	const FOX = getAnimal('fox').maxHp;

	it('never says "All ready" while one of them is tired soon, its HP bar red, of any kind', () => {
		const bad: string[] = [];
		for (const { id, maxHp } of ANIMALS) {
			for (let low = 0; low <= maxHp; low++) {
				const card = [one(id, maxHp), one(id, low)];
				const red = low > 0 && hpBand(low, maxHp) === 'bad';
				const words = stackSummary(card);
				const { ready, tiredSoon, tired } = stackHealth(card);
				if (ready + tiredSoon + tired !== 2)
					bad.push(`${id} at ${low}: counts ${ready}/${tiredSoon}/${tired}`);
				if (red !== (tiredSoon === 1))
					bad.push(`${id} at ${low}: tired soon ${tiredSoon}, bar red ${red}`);
				if (red && words.includes(t('team.allReady')))
					bad.push(`${id} at ${low}: ${words.join(' · ')}`);
			}
		}
		expect(bad.slice(0, 20), `${bad.length} in all`).toEqual([]);
	});

	it('says how many are ready, tired soon and tired, or that all of them are one of those', () => {
		const fifth = Math.floor(FOX / 5);
		expect(stackSummary([fox(FOX), fox(fifth + 1)])).toEqual([t('team.allReady')]);
		expect(stackSummary([fox(fifth), fox(1)])).toEqual([t('team.allTiredSoon')]);
		expect(stackSummary([fox(0), fox(0)])).toEqual([t('team.allTired')]);
		expect(stackSummary([fox(FOX), fox(0)])).toEqual([
			t('team.ready', { count: 1 }),
			t('team.tired', { count: 1 })
		]);
		expect(stackSummary([fox(FOX), fox(2), fox(3), fox(0), fox(FOX)])).toEqual([
			t('team.ready', { count: 2 }),
			t('team.tiredSoon', { count: 2 }),
			t('team.tired', { count: 1 })
		]);
		expect(stackSummary([fox(2), fox(0), fox(0)])).toEqual([
			t('team.tiredSoon', { count: 1 }),
			t('team.tired', { count: 2 })
		]);
		// And their HP together, for the card's slim bar.
		expect(stackHealth([fox(FOX), fox(2), fox(0)])).toMatchObject({ hp: FOX + 2, max: 3 * FOX });
	});
});
