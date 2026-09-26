<script lang="ts">
	import { getAnimal, needsHealing } from '@mathgame/engine';
	import { t } from '../copy';
	import { doctorWords } from '../doctor/lines';
	import { rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { animalWords, nameOf } from '../names';
	import { doctor, hurtIndexes } from '../state/doctor.svelte';
	import HpBar from './HpBar.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';

	/**
	 * The doctor's card, over the world at the bottom of the screen (UI_SPEC §
	 * Doctor): the doctor's line across the top, the party on the left (hurt
	 * animals can be picked, healthy ones are shown but skipped), the puzzle on
	 * the right in the same `PuzzlePanel` as battle, and Bye. Everything comes
	 * from `doctor` (the presentation view) and every word from the copy files
	 * (`doctor.*`); keys are handled by `DoctorController`, so nothing here
	 * dispatches. A click or a tap is a key press (`data-press`,
	 * `input/taps.ts`): an animal's row is its `row:<i>` key, which picks it at
	 * once, and Bye is Escape, which leaves at any time. With the touch controls on, the
	 * doctor's line sits over the puzzle, so the list has the card's height
	 * for rows a finger tall.
	 */
	const hurt = $derived(hurtIndexes(doctor.party));
	const highlighted = $derived(doctor.party[doctor.cursor] ?? null);

	/**
	 * The heal's sparkles: little stars that pop up along the healed animal's
	 * HP bar as it fills. `x` is where along the bar (%), `dx`/`dy` how far each
	 * flies (px), `d` its delay (s). With reduced motion they twinkle in place.
	 */
	const SPARKS = [
		{ x: 4, dx: -10, dy: -26, d: 0, c: 'gold' },
		{ x: 16, dx: 8, dy: 22, d: 0.12, c: 'green' },
		{ x: 28, dx: -6, dy: -32, d: 0.05, c: 'white' },
		{ x: 40, dx: 10, dy: 20, d: 0.18, c: 'gold' },
		{ x: 52, dx: -8, dy: -28, d: 0.08, c: 'green' },
		{ x: 64, dx: 6, dy: 24, d: 0.22, c: 'white' },
		{ x: 76, dx: -10, dy: -24, d: 0.02, c: 'gold' },
		{ x: 88, dx: 8, dy: 26, d: 0.15, c: 'green' },
		{ x: 98, dx: 12, dy: -30, d: 0.25, c: 'white' }
	];
</script>

<div class="doctor">
	<div class="card talk">
		<span class="who">{t('doctor.title')}</span>
		<span class="doctor-line">{doctor.line ? doctorWords(doctor.line) : ''}</span>
	</div>

	<div class="card patients">
		{#each doctor.party as animal, i (animal.id)}
			{@const spec = getAnimal(animal.speciesId)}
			{@const cheer = doctor.healed?.index === i}
			<button
				type="button"
				class="row"
				class:selected={doctor.cursor === i}
				class:cheer
				class:healthy={!needsHealing(animal) && !cheer}
				data-press={rowKey(i)}
				{@attach unfocusable}
			>
				<span class="caret">▸</span>
				<span class="label">{nameOf(animal)}</span>
				{#if animal.hp === 0}<span class="tag">{t('party.tired')}</span>{/if}
				<span class="bar"><HpBar hp={animal.hp} max={spec.maxHp} /></span>
				{#if doctor.healed?.index === i}
					{#key doctor.healed.n}
						<span class="sparkles" aria-hidden="true">
							{#each SPARKS as s, k (k)}
								<i
									class="spark {s.c}"
									style="left: {s.x}%; --dx: {s.dx}px; --dy: {s.dy}px; animation-delay: {s.d}s"
								></i>
							{/each}
						</span>
						<span class="heal">+{doctor.healed.amount}</span>
					{/key}
				{/if}
			</button>
		{/each}
		<button
			type="button"
			class="row bye"
			class:selected={doctor.cursor === doctor.party.length}
			data-press="Escape"
			{@attach unfocusable}
		>
			<span class="caret">▸</span>
			<span class="label">{t('doctor.bye')}</span>
			{#if !touch.on}<kbd>{t('doctor.byeKey')}</kbd>{/if}
		</button>
	</div>

	<div class="card puzzle" class:correct={doctor.judged?.correct === true}>
		{#if doctor.puzzle}
			<PuzzlePanel
				puzzle={doctor.puzzle}
				input={doctor.input}
				judged={doctor.judged}
				typing={doctor.screen === 'puzzle'}
			/>
			{#if hurt.length > 1}
				<div class="keys">
					{touch.on ? t('doctor.puzzleTouch') : t('doctor.puzzleKeys')}
				</div>
			{/if}
		{:else if hurt.length === 0}
			<div class="soft">{t('doctor.allFit')}</div>
			<div class="keys">{touch.on ? t('doctor.allFitTouch') : t('doctor.allFitKeys')}</div>
		{:else}
			<div class="soft">{t('doctor.pick')}</div>
			<div class="detail">
				{highlighted
					? t('doctor.pickDetail', { animal: animalWords(highlighted) })
					: t('doctor.byeDetail')}
			</div>
			<div class="keys">{touch.on ? t('doctor.listTouch') : t('doctor.listKeys')}</div>
		{/if}
	</div>
</div>

<style>
	.doctor {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--doctor-panel);
		display: grid;
		grid-template-columns: minmax(300px, 2fr) 3fr;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 12px;
		padding: 0 16px 16px;
		box-sizing: border-box;
	}
	/* Below the supported sizes, give the names the room before the puzzle. */
	@media (max-width: 900px) {
		.doctor {
			grid-template-columns: 1fr 1fr;
		}
	}
	/* Touch: the doctor's line over the puzzle, the list the card's full height. */
	:global(.touch) .talk {
		grid-column: 2;
		grid-row: 1;
	}
	:global(.touch) .patients {
		grid-column: 1;
		grid-row: 1 / span 2;
		gap: 0;
		padding: 6px 12px;
	}
	:global(.touch) .puzzle {
		grid-column: 2;
		grid-row: 2;
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
		min-height: 0;
	}

	.talk {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		min-width: 0;
	}
	.who {
		flex: none;
		padding: 2px 12px;
		border-radius: 14px;
		background: var(--accent);
		color: white;
		font-weight: 800;
		font-size: 16px;
	}
	.doctor-line {
		min-width: 0;
		font-weight: 800;
		font-size: 20px;
	}

	.patients {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		padding: 8px 12px;
		overflow: hidden;
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 40px;
		width: 100%;
		box-sizing: border-box;
		min-height: 30px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	:global(.touch) .row {
		flex: 0 0 var(--tap);
		min-height: var(--tap);
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.row:not(.selected):not(.healthy):hover {
			background: rgba(255, 159, 67, 0.1);
		}
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	.row.healthy {
		opacity: 0.55;
	}
	/* Just healed: lit up green and hopping once, before it settles among the fit ones. */
	.row.cheer {
		background: color-mix(in srgb, var(--good) 30%, transparent);
		animation: cheer 0.5s ease-out;
	}
	.caret {
		flex: none;
		width: 16px;
		visibility: hidden;
		color: var(--accent);
	}
	.row.selected .caret {
		visibility: visible;
	}
	.label {
		flex: 0 1 auto;
		min-width: 3em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex: none;
		font-size: 16px;
		padding: 0 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.1);
	}
	.bar {
		flex: 1 0 120px;
		margin-left: auto;
		max-width: 220px;
	}
	.bye .label {
		flex: 1;
	}
	.heal {
		position: absolute;
		right: 14px;
		top: -8px;
		font-weight: 800;
		font-size: 24px;
		color: var(--good);
		text-shadow:
			0 2px 0 white,
			0 0 6px white;
		pointer-events: none;
		animation: pop 1.2s ease-out forwards;
	}
	/* Over the HP bar (right of the row), where it fills. */
	.sparkles {
		position: absolute;
		right: 14px;
		top: 50%;
		width: min(220px, 50%);
		height: 0;
		pointer-events: none;
	}
	/* A chunky four-pointed star, big enough to read as one beside an 8 px bar. */
	.spark {
		position: absolute;
		top: -10px;
		width: 20px;
		height: 20px;
		margin-left: -10px;
		clip-path: polygon(50% 0, 64% 36%, 100% 50%, 64% 64%, 50% 100%, 36% 64%, 0 50%, 36% 36%);
		opacity: 0;
		animation: sparkle 0.9s ease-out forwards;
	}
	.spark.gold {
		background: var(--warn);
	}
	.spark.green {
		background: var(--good);
	}
	.spark.white {
		background: white;
	}
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 0 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.08);
	}

	.puzzle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 12px 20px;
		text-align: center;
		overflow: hidden;
		transition: background-color 0.3s;
	}
	.puzzle.correct {
		background: color-mix(in srgb, var(--good) 22%, var(--panel-bg));
	}
	.soft {
		font-weight: 800;
		font-size: 32px;
		opacity: 0.45;
	}
	.detail {
		font-weight: 600;
		font-size: 18px;
		max-width: 30em;
	}
	.keys {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}

	@keyframes cheer {
		0%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-4px);
		}
	}
	@keyframes pop {
		0% {
			opacity: 0;
			transform: translateY(8px) scale(0.8);
		}
		15% {
			opacity: 1;
			transform: translateY(0) scale(1.15);
		}
		70% {
			opacity: 1;
			transform: translateY(-10px) scale(1);
		}
		100% {
			opacity: 0;
			transform: translateY(-22px) scale(1);
		}
	}
	@keyframes sparkle {
		0% {
			opacity: 0;
			transform: translate(0, 0) scale(0.2) rotate(0deg);
		}
		30% {
			opacity: 1;
			transform: translate(calc(var(--dx) * 0.5), calc(var(--dy) * 0.5)) scale(1.1) rotate(45deg);
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy)) scale(0.4) rotate(90deg);
		}
	}
	/* Less motion: the row doesn't hop, the "+N" fades without rising, the sparkles twinkle in place. */
	@keyframes pop-still {
		0%,
		100% {
			opacity: 0;
		}
		15%,
		70% {
			opacity: 1;
		}
	}
	@keyframes twinkle {
		0%,
		100% {
			opacity: 0;
		}
		40% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row.cheer {
			animation: none;
		}
		.heal {
			animation-name: pop-still;
		}
		.spark {
			animation-name: twinkle;
		}
	}
</style>
