import {
	PROTOCOL_VERSION,
	parseServerMessage,
	readWire,
	type ByeReason,
	type ClientMessage,
	type ServerMessage,
	type WhereMessage
} from '@mathgame/engine';

/**
 * The socket to the presence server ([[ARCHITECTURE]] § Presence), from the
 * page's side. It never stands in the way of play: nothing waits on it, it
 * never throws, and without a server the game plays exactly as it did.
 *
 * - **Hello.** On opening it says hello: the protocol version, the
 *   browser's guest id and the character's name. The server answers `hi`,
 *   and from then on the socket is `on`.
 * - **Where.** The page says where it is whenever that changes (`where`);
 *   only the latest counts, and it goes at most every `MIN_GAP_MS`, so a
 *   walk is one message a step and a burst of changes one message. After a
 *   `hi` the latest goes again at once: a new socket starts knowing nothing.
 * - **Again.** A socket that closes, or never opens, is tried again after
 *   1, 2, 4, 8, 16, then every 30 seconds (each give or take a quarter, so
 *   a server that restarts is not met by every browser at once), from the
 *   first again once one says `hi`. `wake` (the window is looked at again,
 *   the network is back) tries at once.
 * - **Ends.** A socket the server closes for good says why (`bye`): another
 *   window of this player took its place (`elsewhere`, until `wake`: the
 *   kid came back to this window), the name was refused (`refused`), or a
 *   full world (tried again after a minute). A `refresh` for a newer version
 *   is `outdated`: the page reloads at a calm moment (`controller.ts`).
 */
export type PresenceStatus =
	'off' | 'connecting' | 'on' | 'waiting' | 'elsewhere' | 'refused' | 'outdated';

/** The part of a WebSocket the connection uses, so a test can stand in for one. */
export interface SocketLike {
	readonly readyState: number;
	send(text: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export interface ConnectionDeps {
	open(url: string): SocketLike;
	url(): string;
	setTimer(run: () => void, ms: number): unknown;
	clearTimer(timer: unknown): void;
	/** Milliseconds, for spacing messages. */
	now(): number;
	/** 0..1, for spreading the retries. */
	random(): number;
}

/** Seconds between tries, in order, the last one again and again. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
/** A full world is tried again after this long. */
export const FULL_RETRY_MS = 60_000;
/** The least time between two messages about where the page is. */
export const MIN_GAP_MS = 100;
const OPEN = 1;

/** The socket's address: `/api/ws` on the page's own host, `wss:` on an `https:` page. */
export function presenceUrl(href: string): string {
	const url = new URL('/api/ws', href);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

export function browserDeps(): ConnectionDeps {
	return {
		open: (url) => new WebSocket(url) as unknown as SocketLike,
		url: () => presenceUrl(location.href),
		setTimer: (run, ms) => setTimeout(run, ms),
		clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
		now: () => performance.now(),
		random: () => Math.random()
	};
}

export class PresenceConnection {
	status: PresenceStatus = 'off';
	/** This socket's public id, once the server said hi. */
	pid: string | null = null;
	private socket: SocketLike | null = null;
	private hello: { guest: string; name: string } | null = null;
	private attempt = 0;
	private retry: unknown = null;
	private flushTimer: unknown = null;
	private latest: WhereMessage | null = null;
	private lastSentText = '';
	private sentAt = Number.NEGATIVE_INFINITY;
	/** Why the server is closing this socket, when it said: read as it closes. */
	private ending: ByeReason | 'outdated' | 'older' | null = null;

	constructor(
		private readonly onMessage: (message: ServerMessage) => void,
		private readonly onStatus: (status: PresenceStatus) => void,
		private readonly deps: ConnectionDeps = browserDeps()
	) {}

	/**
	 * Be present, as this guest with this name: opens the socket, or with
	 * another name opens a new one. Again with the same, nothing changes.
	 */
	start(guest: string, name: string): void {
		const same = this.hello?.guest === guest && this.hello.name === name;
		if (same && this.status !== 'off' && this.status !== 'refused') return;
		this.hello = { guest, name };
		this.attempt = 0;
		this.reopen();
	}

	/** Not present any more: the socket closes, and nothing is tried again. */
	stop(): void {
		this.hello = null;
		this.latest = null;
		this.lastSentText = '';
		this.clearTimers();
		this.dropSocket();
		this.set('off');
	}

	/** Where the page is now: sent when it changed, at most every `MIN_GAP_MS`. */
	where(message: WhereMessage): void {
		this.latest = message;
		this.flush();
	}

	/** Ask where a player is exactly (to go to them). False when the socket is not on. */
	find(pid: string): boolean {
		if (this.status !== 'on') return false;
		this.sendNow({ t: 'find', pid });
		return true;
	}

	/** The window is in use again, or the network is back: a socket that waits tries at once. */
	wake(): void {
		if (!this.hello) return;
		if (this.status === 'waiting' || this.status === 'elsewhere') {
			this.attempt = 0;
			this.reopen();
		}
	}

	// --- the socket ---------------------------------------------------------------

	private reopen(): void {
		this.clearTimers();
		this.dropSocket();
		const hello = this.hello;
		if (!hello) return;
		this.set('connecting');
		let socket: SocketLike;
		try {
			socket = this.deps.open(this.deps.url());
		} catch {
			this.tryAgain();
			return;
		}
		this.socket = socket;
		socket.onopen = () => {
			if (this.socket !== socket) return;
			this.sendRaw(socket, {
				t: 'hello',
				v: PROTOCOL_VERSION,
				guest: hello.guest,
				name: hello.name
			});
		};
		socket.onmessage = (event) => {
			if (this.socket !== socket || typeof event.data !== 'string') return;
			const message = parseServerMessage(readWire(event.data));
			if (message) this.receive(message);
		};
		socket.onerror = () => {
			// A close follows; that is where it is tried again.
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.closed();
		};
	}

	private receive(message: ServerMessage): void {
		switch (message.t) {
			case 'hi':
				this.attempt = 0;
				this.pid = message.pid;
				this.set('on');
				// The server knows nothing of this socket yet: where it is goes at once.
				this.lastSentText = '';
				this.sentAt = Number.NEGATIVE_INFINITY;
				this.flush();
				break;
			case 'refresh':
				// A newer server: this page is out of date. An older one (a deploy half
				// done) is waited out.
				this.ending = message.v > PROTOCOL_VERSION ? 'outdated' : 'older';
				break;
			case 'bye':
				this.ending = message.reason;
				break;
		}
		this.onMessage(message);
	}

	private closed(): void {
		this.pid = null;
		const ending = this.ending;
		this.ending = null;
		this.clearTimers();
		if (!this.hello) {
			this.set('off');
			return;
		}
		switch (ending) {
			case 'replaced':
				this.set('elsewhere');
				return;
			case 'name':
				this.set('refused');
				return;
			case 'outdated':
				this.set('outdated');
				return;
			case 'full':
			case 'older':
				this.tryAgain(FULL_RETRY_MS);
				return;
			default:
				this.tryAgain();
		}
	}

	private tryAgain(after?: number): void {
		this.set('waiting');
		const base = after ?? BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
		this.attempt++;
		const delay = base * (0.75 + 0.5 * this.deps.random());
		this.retry = this.deps.setTimer(() => {
			this.retry = null;
			this.reopen();
		}, delay);
	}

	private flush(): void {
		const latest = this.latest;
		if (this.status !== 'on' || !latest) return;
		const text = JSON.stringify(latest);
		if (text === this.lastSentText) return;
		const wait = this.sentAt + MIN_GAP_MS - this.deps.now();
		if (wait > 0) {
			this.flushTimer ??= this.deps.setTimer(() => {
				this.flushTimer = null;
				this.flush();
			}, wait);
			return;
		}
		if (this.socket && this.sendText(this.socket, text)) {
			this.lastSentText = text;
			this.sentAt = this.deps.now();
		}
	}

	private sendNow(message: ClientMessage): void {
		if (this.socket) this.sendRaw(this.socket, message);
	}

	private sendRaw(socket: SocketLike, message: ClientMessage): void {
		this.sendText(socket, JSON.stringify(message));
	}

	private sendText(socket: SocketLike, text: string): boolean {
		if (socket.readyState !== OPEN) return false;
		try {
			socket.send(text);
			return true;
		} catch {
			return false;
		}
	}

	private dropSocket(): void {
		const socket = this.socket;
		this.socket = null;
		this.pid = null;
		this.ending = null;
		if (!socket) return;
		socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
		try {
			socket.close(1000);
		} catch {
			// Already closing or closed.
		}
	}

	private clearTimers(): void {
		if (this.retry !== null) this.deps.clearTimer(this.retry);
		if (this.flushTimer !== null) this.deps.clearTimer(this.flushTimer);
		this.retry = null;
		this.flushTimer = null;
	}

	private set(status: PresenceStatus): void {
		if (this.status === status) return;
		this.status = status;
		this.onStatus(status);
	}
}
