<script lang="ts">
	import {
		MAX_NAME_LENGTH,
		MAX_NICKNAME_LENGTH,
		STARTERS,
		normalizeNickname
	} from '@mathgame/engine';
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { sfx } from '../audio/sfx.svelte';
	import { LANGUAGES, language, languageName, t } from '../copy';
	import { languageKey, rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { kindList, speciesTopics } from '../kinds';
	import { animalWords, nameOf, nameRefusal, nameRule, speciesName } from '../names';
	import { runsAsWebApp } from '../account/web-app';
	import { account } from '../state/account.svelte';
	import { CONFIRM_CHOICES, title, type ConfirmChoice } from '../state/title.svelte';
	import Switch from './Switch.svelte';

	/**
	 * The title ([[UI_SPEC]] § Title): the name of the game, the menu over the
	 * world where the game stands, the confirm before a new game puts a saved
	 * one away, the player's name box, then the starters (drawn by the 3D
	 * stage behind this overlay, named here at the spots it reports) and the
	 * starter's name box. It reads `title`; keys are `TitleController`'s, so
	 * nothing here dispatches. The name boxes bind `title.nameDraft` and
	 * `title.draft` and keep the focus while they are open. Every word comes
	 * from the copy files.
	 *
	 * A click or a tap is a key press (`data-press`, `input/taps.ts`, which
	 * draws what the tap did before the tap is over, so the name box can bring
	 * up a tablet's keyboard): a menu or confirm
	 * row is its `row:<i>` key (the menu is inert under the confirm, so the two
	 * never answer one key), a language its `language:<code>`, a starter's
	 * tag (and the space over its figure) its `row:<i>`, which lights it; the
	 * card's buttons are Enter and Escape. With the touch controls on, the key
	 * reminders go, and the name box moves to the top, clear of a tablet's
	 * own keyboard.
	 *
	 * The starter screen measures the band it leaves the animals (`title.room`,
	 * which the stage slides the row into): below the heading, or below the
	 * card when it is at the top, and above the card at the bottom, less the
	 * name tags' reach under the feet. The card grows for the name box, and
	 * the tags stay clear of it (#78).
	 */
	const letters = $derived(Array.from(t('title.name')));
	const saved = $derived(title.saved);
	const lead = $derived(title.lead);
	const rows = $derived(title.rows);
	const litRow = $derived(title.screen === 'menu' ? rows[title.cursor] : undefined);
	/**
	 * Opened from the Home Screen with nothing saved here: the game played in
	 * the browser is in the browser's storage, which a web app does not share.
	 * Its hint says how to bring it over (#90), by an account: only while the
	 * server can keep one. Until the server's first word its place is kept, as
	 * the login row's is, and it fades in there.
	 */
	const hintFor = $derived(runsAsWebApp() && saved === null && account.name === null);
	const standaloneHint = $derived(hintFor && account.ready);
	const hintPending = $derived(hintFor && !account.ready && !account.readyHeard);
	/** The login row's words: after a logout, logging in again to the account just left. */
	const loginLabel = $derived.by(() => {
		const left = title.loggedOut;
		if (!left) return t('title.haveAccount');
		return left.name === null
			? t('title.loggedOut.logInAgain')
			: t('title.loggedOut.logIn', { name: left.name });
	});
	const species = $derived(STARTERS[title.starter] ?? STARTERS[0]!);
	/**
	 * How much the player's name box takes: well past the longest name, so a
	 * name a character too long is typed out and told kindly, never cut off unseen.
	 */
	const MAX_TYPED_NAME = 2 * MAX_NAME_LENGTH;
	/** The lit starter's forms, for sentences: "your Rabbit", "kaninen". */
	const starter = $derived(animalWords({ speciesId: species }));

	/** What the typed name will turn into, when that is not just what the box shows. */
	const preview = $derived.by(() => {
		// An empty box has its own line: no name, just the species'.
		if (title.screen !== 'naming' || title.draft.trim() === '') return '';
		const clean = normalizeNickname(title.draft) ?? speciesName(species);
		return clean === title.draft.trim().replace(/\s+/g, ' ') ? '' : clean;
	});

	function choiceLabel(choice: ConfirmChoice): string {
		switch (choice) {
			case 'back':
				return t('title.confirm.back');
			case 'yes':
				return t('title.confirm.yes');
		}
	}

	/** Room kept between the starters (their tops, their name tags) and what they must stay clear of. */
	const ROOM_GAP = 12;
	let starterScreen = $state<HTMLElement>();
	let pickTitle = $state<HTMLElement>();
	let starterCard = $state<HTMLElement>();
	let screenHeight = $state(0);
	let cardHeight = $state(0);
	/** Naming on a touch screen: the card is at the top, clear of the tablet's keyboard rising from the bottom. */
	const cardOnTop = $derived(touch.on && title.screen === 'naming');
	/** The name tags are up: the stage has said where the animals stand. */
	const tagged = $derived(title.spots.length > 0);

	// Measured again whenever the screen, the card or the tags change size or place.
	$effect(() => {
		void screenHeight;
		void cardHeight;
		void cardOnTop;
		void tagged;
		void title.screen;
		const screen = starterScreen?.getBoundingClientRect();
		const card = starterCard?.getBoundingClientRect();
		if (!screen || !card) {
			title.room = null;
			return;
		}
		// How far a name tag reaches under the feet it stands at.
		const spot = untrack(() => title.spots[0]);
		const tag = starterScreen?.querySelector('.tag')?.getBoundingClientRect();
		const reach = spot && tag ? tag.bottom - (screen.top + spot.y * screen.height) : 0;
		const above =
			pickTitle?.getBoundingClientRect().bottom ?? (cardOnTop ? card.bottom : screen.top);
		const below = cardOnTop ? screen.bottom : card.top;
		title.room = {
			top: above - screen.top + ROOM_GAP,
			bottom: below - screen.top - ROOM_GAP - reach
		};
	});

	/**
	 * A name box on `screen`: focused (typing lands in it), and focused again
	 * while that screen is up.
	 */
	const focusedOn = (screen: 'naming' | 'player') => (input: HTMLInputElement) => {
		input.focus();
		const refocus = () =>
			requestAnimationFrame(() => {
				if (title.screen === screen && input.isConnected) input.focus();
			});
		input.addEventListener('blur', refocus);
		return () => {
			input.removeEventListener('blur', refocus);
			// A tablet's keyboard may have slid the page up to show the box; put it back.
			window.scrollTo(0, 0);
		};
	};
	const nameBox = focusedOn('naming');
	const playerNameBox = focusedOn('player');
</script>

{#if title.screen === 'menu' || title.screen === 'confirm' || title.screen === 'player'}
	<div class="title-screen">
		<h1 class="logo" aria-label={t('title.name')}>
			{#each letters as letter, i (i)}
				<span class="letter" style="--i: {i}" aria-hidden="true">{letter}</span>
			{/each}
		</h1>

		<!-- Under the confirm the menu is out of reach, a screen reader's click too: its
		     rows' keys are the confirm's (New game's `row:1` is Yes). -->
		<div class="card menu-card" inert={title.screen !== 'menu'}>
			{#if title.loggedOut}
				<!-- Just logged out: the account's game is safe, and logging in again is the row under it. -->
				<div class="safe">
					<div class="safe-title">{t('title.loggedOut.title')}</div>
					<div>{t('title.loggedOut.text')}</div>
				</div>
			{/if}
			{#each title.slots as row (row)}
				{#if row === 'login' && title.loginPending}
					<!-- The login row's place, kept until the server says whether it can keep an
					     account: the row itself, unseen, so that nothing moves when it comes. -->
					<div class="row slot" aria-hidden="true">
						<span class="caret">▸</span>
						<span class="label">{loginLabel}</span>
					</div>
				{:else}
					{@const i = rows.indexOf(row)}
					<!-- The login row fades into its place when the server's yes comes after the title. -->
					<button
						type="button"
						class="row"
						class:lit={title.screen === 'menu' && title.cursor === i}
						class:continue={row === 'continue'}
						data-press={rowKey(i)}
						in:fade={{ duration: row === 'login' ? 300 : 0 }}
						{@attach unfocusable}
					>
						<span class="caret">▸</span>
						{#if row === 'continue'}
							<span class="label">{t('title.continue')}</span>
							{#if saved && lead}
								<span class="team">
									<span class="who">{nameOf(lead)}</span>
									<span class="count">{t('title.animals', { count: saved.party.length })}</span>
								</span>
							{/if}
						{:else if row === 'new'}
							<span class="label">{t('title.newGame')}</span>
						{:else if row === 'login'}
							<span class="label">{loginLabel}</span>
						{:else if row === 'sound'}
							<span class="label">{t('title.sound')}</span>
							<span class="setting">
								<Switch on={sfx.on} />
								<span class="setting-state"
									>{sfx.on ? t('pause.soundOn') : t('pause.soundOff')}</span
								>
							</span>
						{:else}
							<span class="label">{t('title.language')}</span>
							<!-- Each language in its own words, so a kid finds theirs in any language;
							     a tap on one is that language, anywhere else on the row the row. -->
							<span class="choices">
								{#each LANGUAGES as code (code)}
									<span
										class="choice"
										class:on={language.current === code}
										lang={code}
										data-press={languageKey(code)}
									>
										{languageName(code)}
									</span>
								{/each}
							</span>
						{/if}
					</button>
				{/if}
			{/each}
			{#if account.name !== null && account.session !== 'ended'}
				<div class="note playing-as">{t('account.playingAs', { name: account.name })}</div>
			{/if}
			{#if hintPending}
				<!-- Its place, kept like the login row's until the server's first word. -->
				<div class="note hint slot" aria-hidden="true">{t('title.standaloneHint')}</div>
			{:else if standaloneHint}
				<!-- A web app on the Home Screen keeps its own storage, apart from Safari's (#90). -->
				<div class="note hint" in:fade={{ duration: 300 }}>{t('title.standaloneHint')}</div>
			{/if}
			{#if title.notice}
				<div class="note">{t(title.notice)}</div>
			{/if}
			<!-- The keys; with the touch controls on, every row is its own button. -->
			{#if !touch.on}
				<div class="keys">
					{litRow === 'language' || litRow === 'sound' ? t('title.keysSetting') : t('title.keys')}
				</div>
			{/if}
		</div>

		{#if title.screen === 'confirm' && lead}
			<div class="shade">
				<div class="card confirm">
					<div class="heading">{t('title.confirm.title')}</div>
					<p>
						{#if title.keeps}
							{t('title.confirm.away', { animal: animalWords(lead) })}
						{:else}
							{t('title.confirm.notKept', { animal: animalWords(lead) })}
						{/if}
					</p>
					<p>{t('title.confirm.fresh')}</p>
					{#each CONFIRM_CHOICES as choice, i (choice)}
						<button
							type="button"
							class="row confirm-row"
							class:lit={title.confirm === i}
							data-press={rowKey(i)}
							{@attach unfocusable}
						>
							<span class="caret">▸</span>
							<span class="label">{choiceLabel(choice)}</span>
						</button>
					{/each}
					{#if !touch.on}
						<div class="keys">{t('title.confirm.keys')}</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if title.screen === 'player'}
			<!-- On a touch screen the card goes to the top, clear of the tablet's keyboard. -->
			<div class="shade" class:typing={touch.on}>
				<div class="card player-card">
					{#if title.nameFor === 'continue'}
						<p>{t('title.player.waiting')}</p>
					{/if}
					<div class="heading">{t('title.player.title')}</div>
					<input
						class="name-box"
						type="text"
						bind:value={title.nameDraft}
						maxlength={MAX_TYPED_NAME}
						autocomplete="off"
						autocapitalize="words"
						autocorrect="off"
						spellcheck="false"
						enterkeyhint={title.nameFor === 'continue' ? 'go' : 'next'}
						aria-label={t('title.player.title')}
						aria-describedby="player-name-note"
						{@attach playerNameBox}
					/>
					{#if title.nameRefused}
						<div class="note refused" id="player-name-note" role="alert">
							{nameRefusal(title.nameRefused)}
						</div>
					{:else}
						<div class="note" id="player-name-note">{nameRule()}</div>
					{/if}
					<div class="card-buttons">
						<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
							{t('title.back')}
						</button>
						<button type="button" class="pill go" data-press="Enter" {@attach unfocusable}>
							{title.nameFor === 'continue' ? t('title.player.go') : t('title.player.next')}
						</button>
					</div>
					{#if !touch.on}
						<div class="keys">{t('title.player.keys')}</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="starter-screen" bind:this={starterScreen} bind:clientHeight={screenHeight}>
		{#if title.screen === 'starter'}
			<h2 class="pick-title" bind:this={pickTitle}>{t('title.starter.title')}</h2>
		{/if}
		{#each STARTERS as id, i (id)}
			{@const spot = title.spots[i]}
			{#if spot}
				<!-- The animal itself takes a tap too: a box over its figure, above its tag. -->
				<button
					type="button"
					class="figure-hit"
					aria-hidden="true"
					tabindex="-1"
					style="left: {spot.x * 100}%; top: {spot.y * 100}%"
					data-press={rowKey(i)}
					{@attach unfocusable}
				></button>
				<button
					type="button"
					class="tag"
					class:lit={title.starter === i}
					style="left: {spot.x * 100}%; top: {spot.y * 100}%"
					data-press={rowKey(i)}
					{@attach unfocusable}
				>
					{speciesName(id)}
				</button>
			{/if}
		{/each}

		<div
			class="card starter-card"
			class:typing={cardOnTop}
			bind:this={starterCard}
			bind:clientHeight={cardHeight}
		>
			{#if title.screen === 'starter'}
				<div class="heading">{speciesName(species)}</div>
				<div class="loves">
					{t('title.starter.loves', {
						animal: starter,
						kinds: kindList(speciesTopics(species), 'conjunction')
					})}
				</div>
				<!-- Enter and Escape, for a finger or a mouse: picking starts the game, so a tap on a tag only lights it. -->
				<div class="card-buttons">
					<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
						{t('title.back')}
					</button>
					<button type="button" class="pill go" data-press="Enter" {@attach unfocusable}>
						{t('title.starter.pick', { animal: starter })}
					</button>
				</div>
				{#if !touch.on}
					<div class="keys">{t('title.starter.keys')}</div>
				{/if}
			{:else}
				<div class="heading">{t('title.naming.title', { animal: starter })}</div>
				<input
					class="name-box"
					type="text"
					bind:value={title.draft}
					maxlength={MAX_NICKNAME_LENGTH}
					placeholder={speciesName(species)}
					autocomplete="off"
					autocapitalize="words"
					autocorrect="off"
					spellcheck="false"
					enterkeyhint="go"
					aria-label={t('title.naming.title', { animal: starter })}
					{@attach nameBox}
				/>
				<div class="note">{t('pause.nameRule', { max: MAX_NICKNAME_LENGTH })}</div>
				{#if preview}
					<div class="note preview">{t('pause.willBe', { name: preview })}</div>
				{:else}
					<div class="note">{t('title.naming.empty', { animal: starter })}</div>
				{/if}
				<div class="card-buttons">
					<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
						{t('title.back')}
					</button>
					<button type="button" class="pill go" data-press="Enter" {@attach unfocusable}>
						{t('title.naming.start')}
					</button>
				</div>
				{#if !touch.on}
					<div class="keys">{t('title.naming.keys')}</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.title-screen,
	.starter-screen {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.title-screen {
		display: grid;
		grid-template-rows: auto 1fr;
		padding: 16px 32px 24px;
		box-sizing: border-box;
	}

	/* The name of the game: chunky letters in the palette's warm colours, a cream rim, a gentle bob. */
	.logo {
		margin: 0;
		text-align: center;
		font-weight: 800;
		font-size: clamp(64px, 11vh, 112px);
		line-height: 1.15;
		letter-spacing: 0.02em;
		user-select: none;
	}
	.letter {
		display: inline-block;
		color: var(--logo-color);
		-webkit-text-stroke: 10px var(--panel-cream);
		paint-order: stroke fill;
		text-shadow: 0 7px 0 rgba(45, 42, 50, 0.18);
		animation: bob 2.6s ease-in-out infinite;
		animation-delay: calc(var(--i) * -0.33s);
	}
	.letter:nth-child(5n + 1) {
		--logo-color: var(--coral);
	}
	.letter:nth-child(5n + 2) {
		--logo-color: var(--accent);
	}
	.letter:nth-child(5n + 3) {
		--logo-color: var(--good);
	}
	.letter:nth-child(5n + 4) {
		--logo-color: var(--blue);
	}
	.letter:nth-child(5n) {
		--logo-color: var(--warn);
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-7px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.letter {
			animation: none;
		}
	}

	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
	}
	.menu-card {
		align-self: center;
		justify-self: start;
		width: min(420px, 42vw);
		padding: 14px 14px 12px;
	}
	/* A row's right side that doesn't fit beside its label goes under it (Continue's long name). */
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 10px;
		width: 100%;
		box-sizing: border-box;
		min-height: 52px;
		padding: 0 12px 0 6px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 22px;
	}
	/* Room round Continue's two lines when the name goes under it; every other row keeps its height. */
	.row.continue {
		padding-block: 4px;
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.row:not(.lit):hover {
			background: rgba(255, 159, 67, 0.1);
		}
	}
	.row.lit {
		background: rgba(255, 159, 67, 0.22);
	}
	.caret {
		width: 16px;
		flex: none;
		visibility: hidden;
		color: var(--accent);
	}
	.row.lit .caret {
		visibility: visible;
	}
	.label {
		flex: none;
	}
	/* As long as the name and the count need, so a long name wraps the pair under Continue whole. */
	.team {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		justify-content: flex-end;
		align-items: baseline;
		gap: 8px;
		font-size: 16px;
	}
	.who {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		flex: none;
		font-weight: 600;
		opacity: 0.7;
	}
	.choices {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.choice {
		display: grid;
		place-items: center;
		height: 32px;
		padding: 0 12px;
		border-radius: 16px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 16px;
	}
	.choice.on {
		background: var(--accent);
		color: white;
	}
	/* Touch: each language a finger's height, so a tap near one lands on it, not on the row. */
	:global(.touch) .choice {
		height: var(--tap);
		min-width: 64px;
		box-sizing: border-box;
		border-radius: 24px;
	}
	/* The Sound row: the switch and its state in words, at the right. */
	.setting {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 10px;
		font-size: 16px;
	}
	.setting-state {
		min-width: 2.5em;
	}
	.note {
		font-weight: 600;
		font-size: 16px;
		margin: 10px 8px 0;
	}
	.playing-as {
		font-weight: 800;
	}
	/* The web app's hint (#90): a soft blue box, so it reads as help, not a warning. */
	.hint {
		padding: 6px 10px;
		border-radius: 10px;
		background: rgba(61, 123, 232, 0.12);
	}
	/* An offer of an account whose place is kept until the server's first word: there, unseen. */
	.slot {
		visibility: hidden;
	}
	/* After a logout, over the rows: the account's game is safe. A soft green box, good news. */
	.safe {
		margin: 0 0 8px;
		padding: 8px 12px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--good) 18%, transparent);
		font-weight: 600;
		font-size: 16px;
		line-height: 1.3;
	}
	.safe-title {
		font-weight: 800;
		font-size: 20px;
	}
	.preview {
		font-weight: 800;
	}
	.keys {
		margin-top: 12px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
		text-align: center;
	}

	.shade {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.3);
		padding: 16px;
	}
	.confirm,
	.player-card {
		width: min(520px, 100%);
		padding: 18px 22px 14px;
	}
	.heading {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.2;
		margin: 0 0 8px 2px;
	}
	.confirm p,
	.player-card p {
		margin: 0 0 8px 2px;
		font-weight: 600;
		font-size: 18px;
	}
	.confirm-row {
		margin-top: 6px;
	}
	/* The player's name box: at the top on a touch screen, so a tablet's keyboard leaves it in view. */
	.shade.typing {
		place-items: start center;
	}
	/* Wide enough for sixteen of the widest letters in the box ("WWWWWWWWWWWWWWWW"). */
	.player-card {
		width: min(600px, 100%);
		text-align: center;
	}
	.player-card .name-box {
		font-size: 26px;
	}
	.player-card .heading {
		margin: 0 0 6px;
	}
	/* The rule under the player's name box, and in its place why a name did not go: the same
	   box, so the card keeps its height; the reason in ink on a soft tint of the "not quite" red. */
	.player-card .note {
		padding: 6px 10px;
		border-radius: 10px;
	}
	.refused {
		font-weight: 800;
		background: rgba(242, 95, 92, 0.16);
	}

	.pick-title {
		position: absolute;
		top: 20px;
		left: 0;
		right: 0;
		margin: 0;
		text-align: center;
		font-weight: 800;
		font-size: clamp(32px, 5.5vh, 48px);
		color: var(--panel-ink);
		-webkit-text-stroke: 8px var(--panel-cream);
		paint-order: stroke fill;
	}
	/* A starter's name under its feet, at the spot the 3D stage reports. */
	.tag {
		position: absolute;
		transform: translate(-50%, 14px);
		padding: 4px 16px;
		border-radius: 18px;
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		font-size: 20px;
		white-space: nowrap;
	}
	.tag.lit {
		background: var(--accent);
		color: white;
	}
	:global(.touch) .tag {
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
	}
	/* Over a starter's figure, from its feet up: invisible, a tap on the animal lights it. */
	.figure-hit {
		position: absolute;
		width: min(18vw, 200px);
		height: 30vh;
		transform: translate(-50%, -100%);
	}
	/* The card's Back and Pick (or Let's go): Escape and Enter. */
	.card-buttons {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-top: 12px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 18px;
	}
	.pill.go {
		background: var(--accent);
		color: white;
	}
	.pill:active {
		transform: scale(0.97);
	}
	.starter-card {
		position: absolute;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		width: min(640px, calc(100vw - 32px));
		padding: 14px 22px 12px;
		text-align: center;
	}
	/* Naming on a touch screen: at the top, so the tablet's keyboard, which rises from the bottom, leaves the name box in view. */
	.starter-card.typing {
		top: 16px;
		bottom: auto;
	}
	.starter-card .heading {
		margin: 0 0 4px;
	}
	.loves {
		font-weight: 600;
		font-size: 18px;
	}
	.name-box {
		width: 100%;
		box-sizing: border-box;
		margin-top: 4px;
		font: inherit;
		font-weight: 800;
		font-size: 28px;
		text-align: center;
		color: var(--panel-ink);
		padding: 8px 14px;
		border: 3px solid var(--accent);
		border-radius: 12px;
		background: white;
		outline: none;
	}
	.name-box::placeholder {
		color: var(--panel-ink);
		opacity: 0.35;
	}
</style>
