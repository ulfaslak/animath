<script lang="ts">
	import { getAnimal, needsHealing, type AnimalInstance } from '@mathgame/engine';
	import { doctor, hurtIndexes } from '../state/doctor.svelte';
	import HpBar from './HpBar.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';

	/**
	 * The doctor's card, over the world at the bottom of the screen (UI_SPEC §
	 * Doctor): the doctor's line across the top, the party on the left (hurt
	 * animals can be picked, healthy ones are shown but skipped), the puzzle on
	 * the right in the same `PuzzlePanel` as battle, and Bye. Everything comes
	 * from `doctor` (the presentation view); keys are handled by
	 * `DoctorController`, so nothing here dispatches.
	 */
	const hurt = $derived(hurtIndexes(doctor.party));
	const highlighted = $derived(doctor.party[doctor.cursor] ?? null);

	function nameOf(animal: AnimalInstance): string {
		return animal.nickname ?? getAnimal(animal.speciesId).name;
	}
</script>

<div class="doctor">
	<div class="card talk">
		<span class="who">Doctor</span>
		<span class="doctor-line">{doctor.line}</span>
	</div>

	<div class="card patients">
		{#each doctor.party as animal, i (animal.id)}
			{@const spec = getAnimal(animal.speciesId)}
			<div class="row" class:selected={doctor.cursor === i} class:healthy={!needsHealing(animal)}>
				<span class="caret">▸</span>
				<span class="label">{nameOf(animal)}</span>
				{#if animal.hp === 0}<span class="tag">tired</span>{/if}
				<span class="bar"><HpBar hp={animal.hp} max={spec.maxHp} /></span>
				{#if doctor.healed?.index === i}
					{#key doctor.healed.n}
						<span class="heal">+{doctor.healed.amount}</span>
					{/key}
				{/if}
			</div>
		{/each}
		<div class="row bye" class:selected={doctor.cursor === doctor.party.length}>
			<span class="caret">▸</span>
			<span class="label">Bye</span>
			<kbd>Esc</kbd>
		</div>
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
				<div class="keys">↑ ↓ help another animal · Esc bye</div>
			{/if}
		{:else if hurt.length === 0}
			<div class="soft">Time to explore!</div>
			<div class="keys">Enter or Esc to say bye</div>
		{:else}
			<div class="soft">Pick an animal</div>
			<div class="detail">
				{highlighted
					? `Solve a puzzle and ${nameOf(highlighted)} feels all better!`
					: 'Say bye and go exploring.'}
			</div>
			<div class="keys">↑ ↓ choose · Enter pick · Esc bye</div>
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
		min-height: 30px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	.row.healthy {
		opacity: 0.55;
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
</style>
