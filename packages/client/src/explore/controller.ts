import {
	WorldEdits,
	bundles,
	clearingTool,
	editedTileAt,
	flightTile,
	hasItem,
	isClearable,
	isWater,
	landingDistance,
	canRide,
	leadIndex,
	step,
	tileAtWorld,
	type AnimalInstance,
	type Authority,
	type Direction,
	type Flight,
	type GameEvent,
	type GridPos,
	type PartyIntent
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import type { Keyboard, TeamPick } from '../input/keyboard';
import { motion } from '../motion';
import { BOAT_SWING_SECONDS } from '../render/boat';
import { HOVER_AHEAD, HOVER_UP } from '../render/chaser';
import { FISH_BITE_DELAY } from '../render/fishing';
import { SWING_STRIKE } from '../render/clearing';
import type { Follower } from '../render/follower';
import type { AirPose, GameRenderer } from '../render/renderer';
import { groundTop } from '../render/tiles';
import {
	DESCEND_SECONDS,
	GLIDE_SECONDS,
	RISE_SECONDS,
	SLIDE_SECONDS,
	STEP_SECONDS,
	slidesBetween
} from '../render/trainer';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';
import { hud } from '../state/hud.svelte';
import { team } from '../state/team.svelte';

/** Seconds of the little hop in place when a take-off is refused. */
const HOP_SECONDS = 0.3;
/** A unit step each way the trainer faces, in world x and z (grid y). */
const DELTA: Record<Direction, readonly [number, number]> = {
	up: [0, -1],
	down: [0, 1],
	left: [-1, 0],
	right: [1, 0]
};
/** How far the canopy has come out of its roll by the end of the wind-up (0 folded, 1 open): a jump is coming. */
const WIND_UP_OPEN = 0.45;

type TileCleared = Extract<GameEvent, { type: 'tile-cleared' }>;

/**
 * A flight on screen, from `took-off` until the trainer touches down (a
 * little after the authority's `landed`, once the descent is drawn).
 */
interface FlightOnScreen {
	/** The flight as the authority has it: `took-off`'s, flown on by every `glided`. */
	flight: Flight;
	/** Rising over the take-off tile, gliding from tile to tile, or coming down. */
	phase: 'rise' | 'glide' | 'descend';
	/** Seconds into the rise or the descent. */
	t: number;
	/** The kid let go: glide on to the landing tile, and down. For good, whatever is pressed next. */
	letGo: boolean;
	/** Where the authority put them down (`landed`): glide on to it, then come down. */
	landed: GridPos | null;
	/** The tree or rock that landing cleared, chopped as they come down onto it. */
	cleared: TileCleared | null;
}

/**
 * Explore mode: turns held keys into `move` intents, one per tile, and
 * animates the player mesh between tiles as `player-moved` events arrive. On
 * the ice a move is a whole slide (`tiles`), slid over a tile at a time at
 * `SLIDE_SECONDS` each, feet together; the next move waits for its end, and
 * so does a battle that starts on the tile it ends on (`landing`).
 * Enter is sent as `interact` (after the keyboard's quiet moment); what came
 * of it is the authority's to say. When it cleared a tile (`tile-cleared`),
 * the world on screen takes the change and the chop plays: the trainer's
 * swing, the tree tipping or the rock cracking, its sound as the tool lands.
 * The party column's picks become party
 * intents: a number key, or a click or tap on a card, `lead-species` for that
 * card's species (its first animal standing goes first); an animal on an
 * open card, `select-lead`; a card dropped at another place, `move-species`.
 * A tap on a card of several animals on a touch screen opens it (`team`),
 * and a step closes it.
 *
 * The lead walks behind the trainer (`render/follower.ts`): it steps onto
 * the tile each step leaves, is put beside the trainer whenever the trainer
 * is put somewhere without walking, and shows whoever leads the party the
 * screen shows (the doctor's card's while it is open, which heals on its
 * beat) where the trainer is: out on the water the first animal that swims,
 * swimming behind the boat, or with none standing, the lead on land riding in
 * the boat once the trainer is in it. Nothing it does goes to the authority.
 *
 * With the boat (`renderer.setBoat`), a step onto the water or back onto land
 * takes `BOAT_SWING_SECONDS` instead of a step's usual time, while the boat
 * swings under the trainer or back onto their back (the usual time with
 * reduced motion, when it snaps).
 *
 * With the glider, Space held (the touch controls' Fly) sends `take-off` once
 * the keyboard says the hold is long enough and the step under way is done;
 * the trainer crouches as it winds up. In the air the trainer rises, then
 * glides a tile per `glide`, sent each time the last tile is flown
 * (`GLIDE_SECONDS`), for as long as Space is held. Let go, it glides on to
 * where the engine says it comes down (`landingDistance`, where the landing
 * ring stands), sends `land` there, and comes down; the reach lands it by
 * itself. Nothing else is taken in the air: no step, no Talk, no pick, no
 * menu. A landing that clears a tree or a rock chops it as the trainer comes
 * down onto it. Up in the air the lead in the air, the first bird standing,
 * flies behind the trainer (with none, the lead shrinks away), and once they
 * are down the lead comes back beside them.
 *
 * A bird that notices the glider (`bird-follows`, #91) comes into view from
 * behind, a "!" over it and a squawk, and chases the trainer
 * (`render/chaser.ts`) until they are down; then it swoops in to hover in
 * front of them. Its battle in the air started as they landed, and waits
 * for that (`landing`) before its circle closes.
 */
export class ExploreController {
	private pos: GridPos = { x: 0, y: 0 };
	private from: GridPos = { x: 0, y: 0 };
	private progress = 1; // 0..1 along from → pos
	/** How long the step under way takes: longer onto the water or off it, while the boat swings. */
	private stepSeconds = STEP_SECONDS;
	/**
	 * The tiles of a slide on the ice still to slide over on screen, in order
	 * (`player-moved`'s `tiles`): the authority already stands at the end of
	 * it. Nothing else is taken until they are down to the last.
	 */
	private ahead: GridPos[] = [];
	private facing: Direction = 'down';
	private seed = 0;
	private playerId = '';
	/** The tiles the player has cleared: `welcome`'s, then every `tile-cleared`. */
	private edits = WorldEdits.none;
	/** The flight on screen, while the trainer is up in the air (or coming down). */
	private flight: FlightOnScreen | null = null;
	/** How far through the hop of a take-off refused, 0 to 1; null when none. */
	private hop: number | null = null;
	/** The landing ring as last put up, so it is worked out again only when the flight moves on. */
	private ringKey = '';
	/**
	 * A battle in the air has started (a bird followed the glider down) and not
	 * ended: the one following stays the lead in the air, a bird, as its circle
	 * closes.
	 */
	private airBattle = false;

	constructor(
		private authority: Authority,
		private renderer: GameRenderer,
		private keyboard: Keyboard,
		private follower: Follower | null = null
	) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				// `welcome` carries the authority's facing (down in a new game, the
				// saved one in a restored game), so after any `welcome` both sides
				// agree about which way the player looks.
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.edits = WorldEdits.decode(event.edits);
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.facing;
				this.grounded();
				this.renderer.setWorld(this.seed, this.edits);
				this.renderer.setBoat(hasItem(event, 'boat'));
				this.renderer.setGlider(hasItem(event, 'glider'));
				this.keyboard.setGlider(hasItem(event, 'glider'));
				this.renderer.setPlayer(event.pos, event.pos, 1, this.facing);
				this.follower?.place(this.seed, event.pos, this.facing, this.edits);
				break;
			case 'travelled':
				// Another world: drawn from its seed as the player left it, the player put
				// down where they stand there, without a tween, and the lead beside them.
				if (event.playerId !== this.playerId) break;
				team.close();
				this.seed = event.seed;
				this.edits = WorldEdits.decode(event.edits);
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.facing;
				this.grounded();
				this.renderer.setWorld(this.seed, this.edits);
				this.renderer.setPlayer(event.pos, event.pos, 1, this.facing);
				this.follower?.place(this.seed, event.pos, this.facing, this.edits);
				break;
			case 'line-cast':
				// The rod swung, the line out, the bobber in the hole: under it goes, or back it comes.
				if (event.playerId !== this.playerId) break;
				team.close();
				if (event.outcome === 'no-swimmer') break;
				this.renderer.fish(event.hole, event.outcome);
				sfx.play('cast');
				if (event.outcome === 'bite') sfx.play('splash', { delay: FISH_BITE_DELAY });
				break;
			case 'tile-cleared':
				if (event.playerId !== this.playerId) break;
				// Landing on it from the glider: chopped as the trainer comes down onto it.
				if (this.flight?.landed) this.flight.cleared = event;
				else this.clearTile(event);
				break;
			case 'belongings-changed':
				// Bought at the doctor: it grows onto the trainer's back.
				this.renderer.setBoat(hasItem(event, 'boat'), true);
				this.renderer.setGlider(hasItem(event, 'glider'), true);
				this.keyboard.setGlider(hasItem(event, 'glider'));
				break;
			case 'took-off': {
				if (event.playerId !== this.playerId) break;
				team.close();
				const { from, dir, reach } = event;
				this.flight = {
					flight: { from, dir, reach, flown: 0 },
					phase: 'rise',
					t: 0,
					letGo: false,
					landed: null,
					cleared: null
				};
				this.pos = this.from = from;
				this.progress = 1;
				this.facing = dir;
				this.hop = null;
				// Up into the air: a bird in the team flies behind the trainer (the lead in the
				// air); with none, the lead shrinks away (`update`).
				sfx.play('whoosh');
				break;
			}
			case 'bird-follows':
				// A bird noticed the glider: it comes from behind, a "!" over it, and squawks.
				if (event.playerId !== this.playerId) break;
				this.renderer.chaser.notice(
					event.speciesId,
					this.renderer.trainerPoint(),
					this.flight?.flight.dir ?? this.facing
				);
				sfx.play('squawk');
				break;
			case 'battle-started':
				if (event.state.realm === 'air') this.airBattle = true;
				break;
			case 'battle-ended':
				// Its battle over, the bird that followed the glider down is gone.
				this.airBattle = false;
				this.renderer.chaser.hide();
				break;
			case 'take-off-refused':
				// Nowhere to land that way: a little hop where they stand (the message line says why).
				if (event.playerId === this.playerId) this.hop = 0;
				break;
			case 'glided': {
				const f = this.flight;
				if (event.playerId !== this.playerId || !f) break;
				f.flight = { ...f.flight, flown: event.flown };
				this.from = this.pos;
				this.pos = event.pos;
				this.progress = 0;
				break;
			}
			case 'landed': {
				const f = this.flight;
				if (event.playerId !== this.playerId || !f) break;
				// Down, for good: glide on to the landing tile if the trainer is not over it yet.
				f.landed = event.pos;
				f.letGo = true;
				this.facing = event.dir;
				break;
			}
			case 'player-moved': {
				if (event.playerId !== this.playerId) break;
				// Walking on puts an open card away.
				team.close();
				this.facing = event.dir;
				// A slide on the ice: every tile of it in a straight line, the last `pos`, slid
				// over one after another.
				const [dx, dy] = DELTA[event.dir];
				const tiles = event.tiles ?? 1;
				this.ahead = [];
				for (let k = 1; k < tiles; k++) {
					this.ahead.push({ x: event.pos.x - dx * (tiles - k), y: event.pos.y - dy * (tiles - k) });
				}
				this.ahead.push(event.pos);
				this.nextTile();
				break;
			}
			case 'player-blocked':
				if (event.playerId !== this.playerId) break;
				// Turned where they stand: in the boat, a rider turns with it.
				this.facing = event.dir;
				this.follower?.face(event.dir);
				break;
			case 'player-placed':
				// Gone to another player: put down beside them, not walked (it can be hundreds
				// of tiles), facing them, with a poof; the lead turns up beside the trainer.
				if (event.playerId !== this.playerId) break;
				team.close();
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.dir;
				this.grounded();
				this.renderer.setPlayer(event.pos, event.pos, 1, this.facing);
				this.renderer.poofAt(event.pos);
				this.follower?.place(this.seed, event.pos, this.facing, this.edits);
				break;
			case 'game-left':
				// Quit to the title, which gathers the team round the trainer itself.
				this.follower?.hide();
				this.grounded();
				break;
		}
	}

	/** Whether the trainer is up in the air (or coming down): the menu and the party column wait. */
	get flying(): boolean {
		return this.flight !== null;
	}

	/**
	 * Whether the world is still bringing the kid down from a flight: the
	 * glider on its way down, or a bird that followed it swooping in. A battle
	 * in the air waits for it before its circle closes.
	 */
	get landing(): boolean {
		return (
			this.flight !== null ||
			this.renderer.chaser.arriving ||
			this.sliding ||
			this.renderer.castPlaying
		);
	}

	/**
	 * On to the next tile of the move under way (`ahead`): a step, or a tile of
	 * a slide. Into the boat or out of it, the boat takes its time to swing; on
	 * the ice the trainer glides at the slide's even pace.
	 */
	private nextTile(): void {
		const to = this.ahead.shift();
		if (!to) return;
		this.from = this.pos;
		this.pos = to;
		this.progress = 0;
		this.stepSeconds = slidesBetween(this.seed, this.from, this.pos)
			? SLIDE_SECONDS
			: this.onWater(this.from) !== this.onWater(this.pos) && !motion.reduced
				? BOAT_SWING_SECONDS
				: STEP_SECONDS;
		this.follower?.follow(this.from, this.pos);
	}

	/** Whether a slide on the ice is still under way on screen: a battle at its end waits for it. */
	get sliding(): boolean {
		return (
			this.ahead.length > 0 || (this.progress < 1 && slidesBetween(this.seed, this.from, this.pos))
		);
	}

	/** A tile cleared, on screen: the world takes the change, and the chop or the crack plays. */
	private clearTile(event: TileCleared): void {
		this.edits = this.edits.with(event.pos).without(event.regrown);
		this.renderer.cleared(event.pos, event.tool, this.facing, this.edits, event.regrown);
		this.follower?.setEdits(this.edits);
		// As the tool lands: a woody chop, a rock's crack, or the ice's glassy shatter.
		const sound = event.was === 'tree' ? 'chop' : event.was === 'rock' ? 'crack' : 'shatter';
		sfx.play(sound, { delay: SWING_STRIKE });
	}

	/**
	 * Put down at once, without a flight (a new game, a trip, a poof, the
	 * tent): no glider open, no ring. None of them comes in the air, since the
	 * authority takes nothing else there; this only makes sure.
	 */
	private grounded(): void {
		this.flight = null;
		this.ahead = [];
		this.hop = null;
		this.ringKey = '';
		this.renderer.setLandingSpot(null);
		this.renderer.chaser.hide();
	}

	update(dt: number): void {
		this.keyboard.tick(dt);
		if (this.hop !== null) {
			this.hop += dt / HOP_SECONDS;
			if (this.hop >= 1) this.hop = null;
		}
		if (this.flight) this.fly(this.flight, dt);
		else this.walk(dt);
		// On a mount's back: where it put the trainer's seat last frame, with this frame's hop.
		const seat = this.follower?.seat(this.progress);
		this.renderer.setPlayer(this.from, this.pos, this.progress, this.facing, this.airPose(), seat);
		this.renderer.ensureChunksAround(this.pos);
		const trainer = this.renderer.trainerPoint();
		// A bird that noticed the glider: after it, or swooping in once the kid is down.
		this.renderer.chaser.update(dt, trainer, this.facing);
		if (this.follower) {
			// The party on screen: the doctor's card heals on its beat, after the authority has.
			const party = doctor.active ? doctor.party : game.party;
			// Up in the air, and as a battle in the air opens, the lead in the air follows: the
			// first bird standing, flying behind the trainer. With none, nobody follows a kid into
			// the air; the lead comes back once the trainer is down.
			if (this.flight || this.airBattle)
				this.follower.lead(party[leadIndex(party, 'air')]?.speciesId ?? null);
			else this.leadFollower(this.follower, party);
			this.follower.fly(this.flight ? trainer : null, this.facing);
			this.follower.update(this.progress, dt);
		}
	}

	/** On the ground: a pick, then a step, a take-off or a word, once the step under way is done. */
	private walk(dt: number): void {
		// A number key chooses who goes first, at once, even mid-step — and before
		// any step this frame sends: that step can start a battle, and the animal
		// chosen on the same frame must be the one that fights.
		for (let pick = this.keyboard.takeTeamPick(); pick; pick = this.keyboard.takeTeamPick()) {
			this.teamPick(pick);
		}
		if (this.progress < 1) {
			const progress = this.progress + dt / this.stepSeconds;
			this.progress = Math.min(1, progress);
			// Over a tile of a slide: the next one starts on this frame, with the time left
			// over, so a slide never stalls a frame a tile.
			if (progress >= 1 && this.ahead.length > 0) {
				const over = (progress - 1) * this.stepSeconds;
				this.nextTile();
				this.progress = Math.min(1, over / this.stepSeconds);
			}
			return;
		}
		// A slide's next tile, if one waits (the last frame ended exactly on a tile).
		if (this.ahead.length > 0) {
			this.nextTile();
			return;
		}
		// Space held long enough, the glider owned: up, the way the trainer faces.
		if (this.keyboard.takeTakeOff()) this.authority.dispatch({ type: 'take-off' });
		if (this.flight) return;
		const dir = this.keyboard.takeTap() ?? this.keyboard.heldDirection();
		if (dir) this.authority.dispatch({ type: 'move', dir });
		if (this.keyboard.takeInteract()) {
			// Which key asked: a tap of Space with nothing in front says how to fly.
			hud.talked(this.keyboard.talkKey);
			this.authority.dispatch({ type: 'interact' });
		}
	}

	/**
	 * In the air: rise, glide a tile at a time for as long as Space is held,
	 * and once it is let go (however: Space up, the finger off Fly, a blur, a
	 * shortcut) on to the landing tile and down. Nothing else is taken: a
	 * press made now is dropped.
	 */
	private fly(f: FlightOnScreen, dt: number): void {
		if (!f.letGo && !this.keyboard.flyHeld()) f.letGo = true;
		this.keyboard.takeInteract();
		this.keyboard.takeTakeOff();
		while (this.keyboard.takeTeamPick());
		if (f.phase === 'rise') {
			f.t += dt;
			if (f.t < RISE_SECONDS) {
				this.showLanding(f);
				return;
			}
			f.phase = 'glide';
			f.t = 0;
		}
		if (f.phase === 'glide') {
			this.progress = Math.min(1, this.progress + dt / GLIDE_SECONDS);
			// Over the tile: the next one starts on this frame, so a glide never stalls a frame a tile.
			if (this.progress >= 1) this.overTile(f);
		} else {
			f.t += dt;
			if (f.t >= DESCEND_SECONDS) this.touchDown(f);
		}
		if (this.flight === f) this.showLanding(f);
	}

	/** Over a tile, in the air: glide on, go down to the landing tile, or come down here. */
	private overTile(f: FlightOnScreen): void {
		if (!f.landed) {
			if (f.letGo) {
				// Let go: on to where it comes down, then `land` there.
				const target = landingDistance(this.seed, this.edits, f.flight, { items: game.items });
				this.authority.dispatch({ type: f.flight.flown < target ? 'glide' : 'land' });
			} else {
				this.authority.dispatch({ type: 'glide' });
			}
			// A glide is under way now, or the answer was the landing, right here.
			if (this.progress < 1 || !f.landed) return;
		}
		const at = f.landed;
		if (this.pos.x === at.x && this.pos.y === at.y) {
			this.descend(f);
			return;
		}
		// The authority put the kid down further on (a `land` sent early): glide there.
		this.from = this.pos;
		this.pos = step(this.pos, f.flight.dir);
		this.progress = 0;
	}

	/** Come down onto the landing tile: a tree or a rock there is chopped as the trainer does. */
	private descend(f: FlightOnScreen): void {
		f.phase = 'descend';
		f.t = 0;
		this.renderer.setLandingSpot(null);
		const cleared = f.cleared;
		f.cleared = null;
		if (cleared) this.clearTile(cleared);
	}

	/**
	 * Down on the ground: the glider folded, the lead back beside the trainer,
	 * taps pressed in the air dropped; a bird that followed them down swoops in
	 * to hover in front of them.
	 */
	private touchDown(f: FlightOnScreen): void {
		if (f.cleared) this.clearTile(f.cleared);
		this.flight = null;
		this.ringKey = '';
		this.keyboard.dropTaps();
		sfx.play('land');
		this.follower?.place(this.seed, this.pos, this.facing, this.edits);
		if (this.renderer.chaser.species !== null)
			this.renderer.chaser.comeDown(this.hoverSpot(), this.facing);
	}

	/**
	 * Where a bird that followed the glider down hovers: in front of the
	 * trainer, over the ground there, higher over a tree, a rock or a tent so
	 * it is never inside one.
	 */
	private hoverSpot(): { x: number; y: number; z: number } {
		const [dx, dz] = DELTA[this.facing];
		const x = this.pos.x + dx * HOVER_AHEAD;
		const z = this.pos.y + dz * HOVER_AHEAD;
		const under = { x: Math.round(x), y: Math.round(z) };
		const tile = tileAtWorld(this.seed, under.x, under.y);
		const { kind } = editedTileAt(this.seed, this.edits, under.x, under.y);
		const tall = isClearable(kind) || kind === 'tent' ? 0.9 : 0;
		return { x, y: groundTop(tile) + HOVER_UP + tall, z };
	}

	/**
	 * The landing ring where the kid would come down if they let go now (the
	 * engine's `landingDistance`; the landing tile once it is known), with the
	 * tool that clears a tree or a rock there. Worked out again only when the
	 * flight moves on.
	 */
	private showLanding(f: FlightOnScreen): void {
		if (f.phase === 'descend') return;
		const key = `${f.flight.flown}:${f.letGo}:${f.landed?.x},${f.landed?.y}`;
		if (key === this.ringKey) return;
		this.ringKey = key;
		const at =
			f.landed ??
			flightTile(
				f.flight.from,
				f.flight.dir,
				landingDistance(this.seed, this.edits, f.flight, { items: game.items })
			);
		const { kind } = editedTileAt(this.seed, this.edits, at.x, at.y);
		const tool = kind === 'tree' || kind === 'rock' ? clearingTool(this.seed, kind) : null;
		this.renderer.setLandingSpot(at, tool);
	}

	/** The trainer's pose with the glider this frame: the wind-up, the rise, the glide, the descent. */
	private airPose(): AirPose {
		const f = this.flight;
		const hop = this.hop ?? 0;
		if (!f) {
			// Winding up: knees bending, and the canopy already coming out of its roll.
			const crouch = this.keyboard.windUp();
			return { lift: 0, open: crouch * WIND_UP_OPEN, crouch, hop };
		}
		switch (f.phase) {
			case 'rise': {
				const p = Math.min(1, f.t / RISE_SECONDS);
				return { lift: p, open: WIND_UP_OPEN + (1 - WIND_UP_OPEN) * p, crouch: 1 - p, hop: 0 };
			}
			case 'glide':
				return { lift: 1, open: 1, crouch: 0, hop: 0 };
			case 'descend': {
				const p = Math.min(1, f.t / DESCEND_SECONDS);
				return { lift: 1 - p, open: 1 - p, crouch: 0, hop: 0 };
			}
		}
	}

	/**
	 * Who follows where the trainer is: on land the lead, carrying the trainer
	 * on its back with the harness when it is big enough (`canRide`); out on
	 * the water the first animal standing that swims, or with none, the lead
	 * on land, riding in the boat once the trainer has stepped into it.
	 */
	private leadFollower(follower: Follower, party: readonly AnimalInstance[]): void {
		const onLand = party[leadIndex(party, 'land')]?.speciesId ?? null;
		if (!this.onWater(this.pos)) {
			follower.lead(onLand, onLand !== null && canRide(game, onLand) ? 'mount' : 'follows');
			return;
		}
		const swimmer = party[leadIndex(party, 'water')];
		if (swimmer) {
			follower.lead(swimmer.speciesId);
			return;
		}
		const boarding = this.progress < 1 && !this.onWater(this.from);
		follower.lead(onLand, boarding ? 'follows' : 'boat');
	}

	/** Water, shallow or deep, at a tile: where the trainer is in the boat. */
	private onWater(pos: GridPos): boolean {
		return isWater(tileAtWorld(this.seed, pos.x, pos.y).kind);
	}

	/** What the party column asked for, as the authority's party intent or an open card. */
	private teamPick(pick: TeamPick): void {
		switch (pick.kind) {
			case 'place': {
				// The card in that place, as the column shows it (the party is in bundles).
				const bundle = bundles(game.party)[pick.index];
				if (bundle) this.party({ type: 'lead-species', speciesId: bundle.speciesId });
				break;
			}
			case 'bundle':
				this.party({ type: 'lead-species', speciesId: pick.speciesId });
				break;
			case 'animal':
				// Chosen from an open card: the card has done its job.
				team.close();
				this.party({ type: 'select-lead', animalId: pick.animalId });
				break;
			case 'open':
				team.toggle(pick.speciesId);
				break;
			case 'move':
				this.party({ type: 'move-species', speciesId: pick.speciesId, to: pick.to });
				break;
		}
	}

	private party(intent: PartyIntent): void {
		this.authority.dispatch({ type: 'party', intent });
	}
}
