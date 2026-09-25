import { canTalkToDoctor, type GameEvent } from '@mathgame/engine';
import { doctorLines } from '../doctor/lines';
import { game } from './game.svelte';

/**
 * What the explore HUD's message line says (UI_SPEC § Explore mode): the
 * latest thing said, for a few seconds, and under it the doctor prompt while
 * the player faces a tent, or the controls hint for the first few moves.
 *
 * Things said are the authority's `message` events, plus the doctor's lines
 * the client words itself: the goodbye after a visit and the line after a
 * lost battle's trip to the tent.
 *
 * Their seconds count only while the explore HUD is on screen (`tick`, from
 * the frame loop), so a line said while the battle screen or the doctor's
 * card is up — the doctor's line after a lost battle — is still there to read
 * when the player is back in the world.
 */

/** Seconds a message stays on the line while the explore HUD is on screen. */
export const MESSAGE_SECONDS = 5;
/** Moves (walked or bumped) after which the controls hint goes away. */
export const HINT_MOVES = 5;
/** The message line's own words. */
export const hudLines = {
	talk: 'Press Enter to talk to the doctor',
	controls: 'Arrows / WASD to walk'
};

class HudView {
	/** The latest thing said while it is fresh, else ''. */
	message = $state('');
	/** The line under it: the doctor prompt, the controls hint, or ''. */
	hint = $derived(
		canTalkToDoctor(game.seed, game.pos, game.facing)
			? hudLines.talk
			: game.moves < HINT_MOVES
				? hudLines.controls
				: ''
	);
	private said = '';
	private age = MESSAGE_SECONDS;

	/** Call after `game.apply(event)`, which knows who the player is. */
	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.say('');
				break;
			case 'message':
				this.say(event.text);
				break;
			case 'taken-to-doctor':
				if (event.playerId === game.playerId) this.say(doctorLines.rescued(event.tent !== null));
				break;
			case 'doctor-visit-ended':
				this.say(doctorLines.bye);
				break;
		}
	}

	/** Advance the message clock by `dt` seconds of the explore HUD being on screen. */
	tick(dt: number): void {
		const text = this.age < MESSAGE_SECONDS ? this.said : '';
		this.age += dt;
		if (this.message !== text) this.message = text;
	}

	private say(text: string): void {
		this.said = text;
		this.age = 0;
	}
}

export const hud = new HudView();
