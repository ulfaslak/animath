<script lang="ts">
	/**
	 * "My puzzles"' picture, flat and chunky as the animal book's `BookIcon`:
	 * four little tiles in the prompts' warm colours, a sum's sign on each
	 * (+ − × ÷). Always beside the page's name, so it is decoration
	 * (`aria-hidden`).
	 */
	let { size = 28 }: { size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<rect class="tile add" x="2" y="2" width="13" height="13" rx="3" />
	<rect class="tile sub" x="17" y="2" width="13" height="13" rx="3" />
	<rect class="tile mul" x="2" y="17" width="13" height="13" rx="3" />
	<rect class="tile div" x="17" y="17" width="13" height="13" rx="3" />
	<path class="sign" d="M8.5 5.5v6M5.5 8.5h6M20.5 8.5h6M6 21l5 5M11 21l-5 5M20.5 23.5h6" />
	<circle class="dot" cx="23.5" cy="20.6" r="1.2" />
	<circle class="dot" cx="23.5" cy="26.4" r="1.2" />
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.add {
		fill: var(--accent);
	}
	.sub {
		fill: var(--blue);
	}
	.mul {
		fill: var(--good);
	}
	.div {
		fill: var(--coral);
	}
	.sign {
		fill: none;
		stroke: #fff4e6;
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	.dot {
		fill: #fff4e6;
	}
</style>
