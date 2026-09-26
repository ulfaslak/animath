<script lang="ts">
	/**
	 * An on/off switch for a setting's row (Sound, in the pause menu and on the
	 * title): the knob right and the track green when on. Only a picture of the
	 * state; the row beside it says the state in words, since colour is never
	 * the only signal. It never takes a click.
	 */
	let { on }: { on: boolean } = $props();
</script>

<span class="switch" class:on aria-hidden="true"><span class="knob"></span></span>

<style>
	.switch {
		position: relative;
		flex: none;
		width: 52px;
		height: 28px;
		border-radius: 14px;
		background: rgba(0, 0, 0, 0.18);
		transition: background-color 0.2s;
	}
	.switch.on {
		background: var(--good);
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
		transition: transform 0.2s;
	}
	.switch.on .knob {
		transform: translateX(24px);
	}
	@media (prefers-reduced-motion: reduce) {
		.switch,
		.knob {
			transition: none;
		}
	}
</style>
