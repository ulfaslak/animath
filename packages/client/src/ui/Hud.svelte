<script lang="ts">
	import { getAnimal } from '@mathgame/engine';
	import { fade } from 'svelte/transition';
	import { game } from '../state/game.svelte';
	import { hud } from '../state/hud.svelte';
	import HpBar from './HpBar.svelte';
</script>

<div class="party">
	{#each game.party as animal (animal.id)}
		{@const spec = getAnimal(animal.speciesId)}
		<div class="member" class:tired={animal.hp === 0}>
			<span class="name">
				{animal.nickname ?? spec.name}
				{#if animal.hp === 0}<span class="tag">tired</span>{/if}
			</span>
			<HpBar hp={animal.hp} max={spec.maxHp} />
		</div>
	{/each}
</div>

<!-- The message line: the latest message while it is fresh, then the doctor
     prompt or the controls hint (see `state/hud.svelte.ts`). -->
{#if hud.message || hud.hint}
	<div class="hint" transition:fade={{ duration: 400 }}>
		{#if hud.message}
			<div class="message" transition:fade={{ duration: 400 }}>{hud.message}</div>
		{/if}
		{#if hud.hint}
			<div class="prompt">{hud.hint}</div>
		{/if}
	</div>
{/if}

<style>
	.party {
		position: absolute;
		top: 16px;
		left: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.member {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 14px;
		width: 200px;
		font-weight: 800;
	}
	.member.tired {
		opacity: 0.7;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.tag {
		font-size: 16px;
		font-weight: 800;
		padding: 1px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.1);
	}
	.hint {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: calc(100vw - 32px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 16px;
		font-weight: 600;
		text-align: center;
	}
	.prompt {
		font-weight: 800;
	}
	.message + .prompt {
		margin-top: 2px;
	}
</style>
