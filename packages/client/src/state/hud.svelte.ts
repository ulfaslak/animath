import { canTalkToDoctor, type GameEvent } from '@mathgame/engine';
import { t } from '../copy';
import { doctorWords, type DoctorLine } from '../doctor/lines';
import { game } from './game.svelte';

/**
 * What the explore HUD's message line says (UI_SPEC § Explore mode): the
 * latest thing said, for a few seconds, and under it the doctor prompt while
 * the player faces a tent, or the controls hint for the first few steps.
 *
 * Things said are the authority's `message` events, plus lines the client
 * words itself: the doctor's goodbye after a visit, the doctor's line after a
 * lost battle's trip to the tent, and the hint for Enter away from a tent.
 * They are kept as data and worded when shown, in the language on screen.
 *
 * Their seconds count only while the explore HUD is on screen (`tick`, from
 * the frame loop), so a line said while the battle screen or the doctor's
 * card is up — the doctor's line after a lost battle — is still there to read
 * when the player is back in the world.
 */

/** Seconds a message stays on the line while the explore HUD is on screen. */
export const MESSAGE_SECONDS = 5;
/** Steps walked after which the controls hint goes away. */
export const HINT_STEPS = 5;

/** A line on the message line, as data. */
export type Said =
	/** The authority's `message`, as it sent it. */
	| { text: string }
	| { doctor: DoctorLine }
	/** Enter with no tent in front of the player. */
	| { explore: 'notAtTent' };

export function saidWords(said: Said): string {
	if ('text' in said) return said.text;
	if ('doctor' in said) return doctorWords(said.doctor);
	return t('explore.notAtTent');
}

class HudView {
	#said = $state<Said | null>(null);
	#fresh = $state(false);
	private age = MESSAGE_SECONDS;

	#facingTent = $derived(canTalkToDoctor(game.seed, game.pos, game.facing));
	/**
	 * The latest thing said while it is fresh, worded now, else ''. "Walk up to
	 * a tent" is over once the player faces one: the prompt below says what next.
	 */
	message = $derived(
		this.#fresh && this.#said && !('explore' in this.#said && this.#facingTent)
			? saidWords(this.#said)
			: ''
	);
	/** The line under it: the doctor prompt, the controls hint, or ''. */
	hint = $derived(
		this.#facingTent
			? t('explore.talkPrompt')
			: game.steps < HINT_STEPS
				? t('explore.controls')
				: ''
	);

	/** Call after `game.apply(event)`, which knows who the player is. */
	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.#said = null;
				this.age = MESSAGE_SECONDS;
				this.#fresh = false;
				break;
			case 'message':
				this.say({ text: event.text });
				break;
			case 'taken-to-doctor':
				if (event.playerId === game.playerId) {
					this.say({ doctor: { say: 'rescued', atTent: event.tent !== null } });
				}
				break;
			case 'doctor-visit-ended':
				this.say({ doctor: { say: 'goodbye' } });
				break;
		}
	}

	/** Put a line on the message line; it stays for `MESSAGE_SECONDS` of the HUD on screen. */
	say(said: Said): void {
		this.#said = said;
		this.age = 0;
	}

	/** Advance the message clock by `dt` seconds of the explore HUD being on screen. */
	tick(dt: number): void {
		const fresh = this.#said !== null && this.age < MESSAGE_SECONDS;
		this.age += dt;
		if (this.#fresh !== fresh) this.#fresh = fresh;
	}
}

export const hud = new HudView();
