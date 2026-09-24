import {
	hashString,
	isWalkable,
	spawnPoint,
	step,
	tileAtWorld,
	type Authority,
	type GameEvent,
	type GridPos,
	type Intent
} from '@mathgame/engine';

/**
 * Single-player authority: applies the rules in-process and emits events.
 *
 * This is the seam multiplayer will replace. A `RemoteAuthority` with the same
 * interface will forward intents over a WebSocket and relay the server's
 * events; nothing above this class needs to know which one it is talking to.
 * So: keep game rules in the engine, keep this class thin, and never let the
 * renderer or UI reach past it.
 */
export class LocalAuthority implements Authority {
	private listeners = new Set<(e: GameEvent) => void>();
	private readonly playerId = 'local';
	private readonly seed = hashString('prototype');
	private pos: GridPos = { x: 0, y: 0 };

	start(): void {
		this.pos = spawnPoint(this.seed);
		this.emit({
			type: 'welcome',
			playerId: this.playerId,
			seed: this.seed,
			pos: this.pos,
			party: [{ id: 'starter', speciesId: 'squirrel', hp: 20 }]
		});
	}

	dispatch(intent: Intent): void {
		switch (intent.type) {
			case 'move': {
				const next = step(this.pos, intent.dir);
				if (isWalkable(tileAtWorld(this.seed, next.x, next.y).kind)) {
					this.pos = next;
					this.emit({ type: 'player-moved', playerId: this.playerId, pos: next, dir: intent.dir });
				} else {
					this.emit({ type: 'player-blocked', playerId: this.playerId, dir: intent.dir });
				}
				break;
			}
			case 'interact':
				this.emit({ type: 'message', text: 'Nothing here yet.' });
				break;
			case 'battle':
				// Battle reducer lands with the battle-mode issue.
				break;
		}
	}

	subscribe(listener: (e: GameEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: GameEvent): void {
		for (const l of this.listeners) l(event);
	}
}
