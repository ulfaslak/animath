/**
 * The little notes at the top of the screen when someone comes into the
 * player's world or leaves it ([[UI_SPEC]] § Explore mode, "Playing
 * together"): "Ada is here!", "Bo went home". Read from the roster, the
 * list of everyone in the world that the server sends when it changes, by
 * name.
 *
 * They are news, never noise:
 * - Who is there when the player arrives in a world, or when the socket
 *   comes back after dropping, is who is there, not who came: the first
 *   roster after either says nothing.
 * - Someone gone from the roster went home only once they have been gone
 *   `LEAVE_GRACE_SECONDS`; one who is back sooner (a reload, a hiccup, the
 *   server restarting) never left. Someone seen in the world within the last
 *   `KNOWN_SECONDS` turning up again is no news either.
 * - One note at a time, each for `NOTE_SECONDS`, with a moment between two.
 *   Everyone who came while a note was up comes in the next one together
 *   ("Ada and Bo are here!", "Ada and 8 more are here!"), so a crowd, or
 *   everyone coming back after a restart, is one note, not ten.
 * - Notes wait while they can't be shown (a battle, the doctor, the menu:
 *   they only ever show over the explore screen), and one that waited
 *   `STALE_SECONDS` is dropped: it is old news.
 *
 * Also: this window's place was taken by another window of this player
 * (`elsewhere`): "You're playing in another window."
 */
export const NOTE_SECONDS = 4;
export const NOTE_GAP_SECONDS = 1;
export const LEAVE_GRACE_SECONDS = 10;
export const KNOWN_SECONDS = 60;
export const STALE_SECONDS = 20;

export type NoteKind = 'arrived' | 'left' | 'elsewhere';

/** A note: what happened, and to whom (the first name, and everyone with it). */
export interface Note {
	id: number;
	kind: NoteKind;
	names: string[];
}

interface Waiting {
	kind: NoteKind;
	name: string;
	since: number;
}

/** Names are one player whatever their case: `Ada` and `ada` are the same. */
function keyOf(name: string): string {
	return name.normalize('NFC').toLowerCase();
}

export class ArrivalNotes {
	/** Who is in the world, by key, with their name as shown. */
	private present = new Map<string, string>();
	/** When each name was last on a roster, in seconds. */
	private lastSeen = new Map<string, number>();
	/** Who dropped off the roster and since when, not yet gone home. */
	private missing = new Map<string, { name: string; since: number }>();
	private baseline = true;
	private waiting: Waiting[] = [];
	private shown: Note | null = null;
	private shownAt = Number.NEGATIVE_INFINITY;
	private hiddenAt = Number.NEGATIVE_INFINITY;
	private ids = 0;

	/** Another world: nobody there is news until its first roster, and nobody from the last one is missed. */
	newWorld(): void {
		this.present.clear();
		this.lastSeen.clear();
		this.missing.clear();
		this.waiting = this.waiting.filter((w) => w.kind === 'elsewhere');
		this.baseline = true;
	}

	/**
	 * The socket came back: the next roster is who is there. Anyone who was
	 * there and isn't may still be on their way back.
	 */
	reconnected(now: number): void {
		for (const [key, name] of this.present) {
			if (!this.missing.has(key)) this.missing.set(key, { name, since: now });
		}
		this.present.clear();
		this.baseline = true;
	}

	/** A roster came: everyone else in the world now, by name. */
	roster(names: readonly string[], now: number): void {
		const here = new Map(names.map((name) => [keyOf(name), name]));
		for (const [key, name] of here) {
			if (this.present.has(key)) continue;
			const back = this.missing.delete(key);
			const known = now - (this.lastSeen.get(key) ?? Number.NEGATIVE_INFINITY) <= KNOWN_SECONDS;
			if (!this.baseline && !back && !known)
				this.waiting.push({ kind: 'arrived', name, since: now });
		}
		for (const [key, name] of this.present) {
			if (!here.has(key) && !this.missing.has(key)) this.missing.set(key, { name, since: now });
		}
		for (const key of here.keys()) this.lastSeen.set(key, now);
		this.present = here;
		this.baseline = false;
	}

	/** This window's place was taken by another window of this player. */
	elsewhere(now: number): void {
		this.waiting.push({ kind: 'elsewhere', name: '', since: now });
	}

	/**
	 * The note to show at `now` (seconds), or null: `canShow` is whether the
	 * explore screen is up to show it on.
	 */
	tick(now: number, canShow: boolean): Note | null {
		for (const [key, gone] of this.missing) {
			if (now - gone.since < LEAVE_GRACE_SECONDS) continue;
			this.missing.delete(key);
			// Gone home: back later, that is news again.
			this.lastSeen.delete(key);
			this.waiting.push({ kind: 'left', name: gone.name, since: now });
		}
		this.waiting = this.waiting.filter((w) => now - w.since <= STALE_SECONDS);
		if (this.shown) {
			if (now - this.shownAt < NOTE_SECONDS) return this.shown;
			this.shown = null;
			this.hiddenAt = now;
		}
		if (!canShow || now - this.hiddenAt < NOTE_GAP_SECONDS || this.waiting.length === 0) {
			return null;
		}
		const kind = this.waiting[0]!.kind;
		const names = [...new Set(this.waiting.filter((w) => w.kind === kind).map((w) => w.name))];
		this.waiting = this.waiting.filter((w) => w.kind !== kind);
		this.shown = { id: ++this.ids, kind, names };
		this.shownAt = now;
		return this.shown;
	}
}
