<script lang="ts" module>
	/** The moves that have a picture: a wild battle's three, and a friendly match's Leave. */
	export type MoveIconName = 'leash' | 'switch' | 'run' | 'leave';
</script>

<script lang="ts">
	/**
	 * A battle move's picture, flat and chunky in the world's own colours, as
	 * the shop's `ItemIcon`: the leash's loop of rope in the leash's fire
	 * orange, two arrows swapping places in the trainer's blue for Switch, a
	 * running arrow in the good green for Run, and a door for Leave (a
	 * friendly match's way out). Always beside the move's word, so it is
	 * decoration (`aria-hidden`).
	 */
	let { name, size = 30 }: { name: MoveIconName; size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	{#if name === 'leash'}
		<ellipse class="rope" cx="19" cy="12" rx="9" ry="7.5" />
		<path class="rope" d="M12.5 17.5C9.5 21 8 25 4 29" />
		<circle class="knot" cx="12.8" cy="17.3" r="2.8" />
	{:else if name === 'switch'}
		<path class="arrow swap" d="M5 11h18M18.5 5.5 24.5 11l-6 5.5" />
		<path class="arrow swap" d="M27 21H9M13.5 15.5 7.5 21l6 5.5" />
	{:else if name === 'run'}
		<path class="dash" d="M3 11h6M1.5 16h7M3 21h6" />
		<path class="arrow go" d="M12 16h16M21 8.5l7.5 7.5-7.5 7.5" />
	{:else}
		<rect class="door" x="8" y="3" width="16" height="26" rx="2.5" />
		<rect class="panel" x="11" y="6.5" width="10" height="9" rx="1.5" />
		<circle class="knob" cx="19.8" cy="19" r="1.8" />
	{/if}
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.rope {
		fill: none;
		stroke: #ffb347;
		stroke-width: 3.6;
		stroke-linecap: round;
	}
	.knot {
		fill: #d47c2a;
	}
	.arrow {
		fill: none;
		stroke-width: 3.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.swap {
		stroke: var(--blue);
	}
	.go {
		stroke: var(--good);
		stroke-width: 4;
	}
	.dash {
		fill: none;
		stroke: var(--good);
		stroke-width: 2.8;
		stroke-linecap: round;
		opacity: 0.6;
	}
	.door {
		fill: #8b5a3c;
	}
	.panel {
		fill: #6e4630;
	}
	.knob {
		fill: #fff4e6;
	}
</style>
