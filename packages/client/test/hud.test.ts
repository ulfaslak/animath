import { hashString, type Direction } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, NOT_AT_A_TENT } from '../src/authority/local';
import { doctorLines } from '../src/doctor/lines';
import { game } from '../src/state/game.svelte';
import { HINT_MOVES, MESSAGE_SECONDS, hud, hudLines } from '../src/state/hud.svelte';

/**
 * The explore message line (UI_SPEC § Explore mode): what was said last fades
 * after a few seconds of the HUD being on screen, the controls hint goes after
 * a few moves, and facing a tent shows how to talk to the doctor. The doctor's
 * goodbye and the line after a lost battle are worded here from their events.
 */
function setup() {
	const authority = new LocalAuthority();
	authority.subscribe((e) => {
		game.apply(e);
		hud.apply(e);
	});
	authority.start();
	hud.tick(0);
	const move = (...dirs: Direction[]) =>
		dirs.forEach((dir) => authority.dispatch({ type: 'move', dir }));
	/** `seconds` of the explore HUD on screen, a frame at a time. */
	const tick = (seconds: number) => {
		for (let t = 0; t < seconds; t += 1 / 60) hud.tick(1 / 60);
	};
	return { authority, move, tick };
}

describe('the explore message line', () => {
	it('shows a message for a few seconds on screen, and again when it is said again', () => {
		const t = setup();
		expect(hud.message).toBe('');
		t.authority.dispatch({ type: 'interact' }); // not at a tent
		hud.tick(0);
		expect(hud.message).toBe(NOT_AT_A_TENT);
		t.tick(MESSAGE_SECONDS - 0.1);
		expect(hud.message).toBe(NOT_AT_A_TENT);
		t.tick(0.2);
		expect(hud.message).toBe('');

		t.authority.dispatch({ type: 'interact' });
		hud.tick(1 / 60);
		expect(hud.message).toBe(NOT_AT_A_TENT);
	});

	it('keeps a line said while the HUD is off screen until it is back', () => {
		const t = setup();
		// Said while the battle screen or the doctor's card is up: no ticks meanwhile.
		t.authority.dispatch({ type: 'interact' });
		hud.tick(0.5);
		expect(hud.message).toBe(NOT_AT_A_TENT);
	});

	it("words the doctor's goodbye and the line after a lost battle itself", () => {
		setup();
		game.apply({ type: 'welcome', playerId: 'p', seed: 1, pos: { x: 0, y: 0 }, party: [] });
		hud.apply({
			type: 'doctor-visit-ended',
			state: { step: 1, party: [], phase: { kind: 'ended' }, log: [] }
		});
		hud.tick(0);
		expect(hud.message).toBe(doctorLines.bye);
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
		expect(hud.message).toBe(doctorLines.rescued(true));
		taken(null);
		hud.tick(0);
		expect(hud.message).toBe(doctorLines.rescued(false));
	});

	it('shows the controls hint until the player has moved a few times, walked or bumped', () => {
		const t = setup();
		expect(hud.hint).toBe(hudLines.controls);
		t.move('up'); // bumps the river
		t.move(...Array<Direction>(HINT_MOVES - 2).fill('right'));
		expect(hud.hint).toBe(hudLines.controls);
		t.move('right');
		expect(hud.hint).toBe('');
	});

	it('facing a tent, says how to talk to the doctor; turning away, stops', () => {
		const t = setup();
		t.move(...Array<Direction>(7).fill('right'));
		expect(game.pos).toEqual({ x: 5, y: 6 });
		expect(hud.hint).toBe(''); // beside the tent, facing along it
		t.move('down'); // bumps the tent
		expect(hud.hint).toBe(hudLines.talk);
		t.move('left');
		expect(hud.hint).toBe('');
	});

	it('the prompt comes before the controls hint', () => {
		// A player put beside the tent (a knock-out, or a save) before moving much.
		game.apply({
			type: 'welcome',
			playerId: 'p',
			seed: hashString('prototype'),
			pos: { x: 5, y: 6 },
			party: []
		});
		game.apply({ type: 'player-blocked', playerId: 'p', dir: 'down' });
		expect(game.moves).toBeLessThan(HINT_MOVES);
		expect(hud.hint).toBe(hudLines.talk);
	});
});
