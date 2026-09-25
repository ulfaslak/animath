import { canTalkToDoctor } from '@mathgame/engine';
import { game } from './game.svelte';

/**
 * What the explore HUD's message line says (UI_SPEC § Explore mode): the
 * latest message for a few seconds, and under it the doctor prompt while the
 * player faces a tent, or the controls hint for the first few moves.
 *
 * A message's seconds count only while the explore HUD is on screen
 * (`tick`, from the frame loop), so a line said while the battle screen or
 * the doctor's card is up — the doctor's line after a lost battle — is still
 * there to read when the player is back in the world.
 */

/** Seconds a message stays on the line while the explore HUD is on screen. */
export const MESSAGE_SECONDS = 5;
/** Moves (walked or bumped) after which the controls hint goes away. */
export const HINT_MOVES = 5;
export const TALK_PROMPT = 'Press Enter to talk to the doctor';
export const CONTROLS_HINT = 'Arrows / WASD to walk';

class HudView {
	/** The latest message while it is fresh, else ''. */
	message = $state('');
	/** The line under it: the doctor prompt, the controls hint, or ''. */
	hint = $derived(
		canTalkToDoctor(game.seed, game.pos, game.facing)
			? TALK_PROMPT
			: game.moves < HINT_MOVES
				? CONTROLS_HINT
				: ''
	);
	private seq = 0;
	private age = 0;

	/** Advance the message clock by `dt` seconds of the explore HUD being on screen. */
	tick(dt: number): void {
		if (game.messageSeq !== this.seq) {
			this.seq = game.messageSeq;
			this.age = 0;
		} else {
			this.age += dt;
		}
		const text = this.age < MESSAGE_SECONDS ? game.message : '';
		if (this.message !== text) this.message = text;
	}
}

export const hud = new HudView();
