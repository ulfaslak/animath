import { hashString, type Direction } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { t } from '../src/copy';
import { doctorWords } from '../src/doctor/lines';
import { ExploreController } from '../src/explore/controller';
import type { Keyboard } from '../src/input/keyboard';
import type { GameRenderer } from '../src/render/renderer';
import { game } from '../src/state/game.svelte';
import { HINT_STEPS, MESSAGE_SECONDS, hud } from '../src/state/hud.svelte';

/**
 * The explore message line (UI_SPEC § Explore mode): what was said last fades
 * after a few seconds of the HUD being on screen, the controls hint goes after
 * a few steps, facing a tent shows how to talk to the doctor, and Enter with
 * no tent in front says how to find one. Lines the client words itself are
 * worded when shown (DECISIONS § Copy and languages).
 */
function setup() {
	const authority = new LocalAuthority();
	const renderer = {
		setWorld() {},
		setPlayer() {},
		ensureChunksAround() {}
	} as unknown as GameRenderer;
	let enter = false;
	const keyboard = {
		takeTap: () => undefined,
		heldDirection: () => undefined,
		takeSlot: () => undefined,
		takeInteract: () => {
			const pressed = enter;
			enter = false;
			return pressed;
		}
	} as unknown as Keyboard;
	const explore = new ExploreController(authority, renderer, keyboard);
	const events: string[] = [];
	authority.subscribe((e) => {
		events.push(e.type);
		game.apply(e);
		hud.apply(e);
		explore.handle(e);
	});
	authority.start();
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

	it('keeps a line said while the HUD is off screen until it is back', () => {
		setup();
		// Said while the battle screen or the doctor's card is up: no ticks meanwhile.
		hud.apply({ type: 'message', line: JOINED });
		hud.tick(0.5);
		expect(hud.message).toBe('Rabbit joins your team!');
	});

	it("words the doctor's goodbye and the line after a lost battle from their events", () => {
		setup();
		game.apply({ type: 'welcome', playerId: 'p', seed: 1, pos: { x: 0, y: 0 }, party: [] });
		hud.apply({
			type: 'doctor-visit-ended',
			visit: 1,
			state: { step: 1, party: [], phase: { kind: 'ended' } }
		});
		hud.tick(0);
		expect(hud.message).toBe(doctorWords({ say: 'goodbye' }));
		expect(hud.message).toBe(t('doctor.goodbye'));
		const taken = (tent: { x: number; y: number } | null) =>
			hud.apply({
				type: 'taken-to-doctor',
				playerId: 'p',
				pos: { x: 3, y: 3 },
				dir: 'up',
				tent,
				party: []
			});
		taken({ x: 3, y: 2 });
		hud.tick(0);
		expect(hud.message).toBe(t('doctor.rescuedAtTent'));
		taken(null);
		hud.tick(0);
		expect(hud.message).toBe(t('doctor.rescuedHere'));
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
		// A player put beside the tent (a knock-out, or a save) before walking much.
		game.apply({
			type: 'welcome',
			playerId: 'p',
			seed: hashString('prototype'),
			pos: { x: 5, y: 6 },
			party: []
		});
		game.apply({ type: 'player-blocked', playerId: 'p', dir: 'down' });
		expect(game.steps).toBeLessThan(HINT_STEPS);
		expect(hud.hint).toBe(t('explore.talkPrompt'));
	});
});
