<script lang="ts">
	import {
		MAX_NAME_LENGTH,
		MIN_NAME_LENGTH,
		PASSWORD_MAX_LENGTH,
		PASSWORD_MIN_LENGTH
	} from '@mathgame/engine';
	import { t } from '../copy';
	import { REVEAL_KEY, unfocusable } from '../input/press';
	import { DOUBLE_TAP_MS } from '../input/taps';
	import { touch } from '../input/touch.svelte';
	import { nameRefusal } from '../names';
	import {
		account,
		awayFromHome,
		cardBoxes,
		loginByNameAlone,
		type AccountField,
		type AccountProblem,
		type WelcomeGone
	} from '../state/account.svelte';

	/**
	 * The account card ([[UI_SPEC]] § Accounts): make an account with the
	 * game on screen (`register`; from Continue on a guest's game, the gate,
	 * `from: 'gate'`, with its own words), log in to one (`login`; on the
	 * account's own browser by the name alone, one box), pick the password of
	 * the account a welcome link opens (`welcome`), a new password for the
	 * account the page plays (`password`), or a new name for the player
	 * (`name`). Its boxes (`cardBoxes`): the name and a secret password, and
	 * away from the account's own browser the password now for a new name or a
	 * new password; a button beside each password that shows it as typed;
	 * and under them the password's or the name's rule, or kindly why the
	 * card did not go on.
	 * The welcome card's name is the account's, shown and never typed; while
	 * the server is asked about the link, or when the link is spent or the
	 * server does not answer, the card has no boxes, only what to do instead.
	 * It reads `account`; keys are `AccountController`'s, so nothing here
	 * dispatches. The boxes bind the drafts; the one that takes the typing
	 * (`account.field`) keeps the focus while the card is up, and a finger or
	 * a click on the other one moves it there. On a touch screen the card is
	 * at the top, clear of the tablet's keyboard.
	 */

	/** Well past the longest name, so a name a character too long is typed out and told, never cut. */
	const MAX_TYPED_NAME = 2 * MAX_NAME_LENGTH;
	/** The same for a password. */
	const MAX_TYPED_PASSWORD = 2 * PASSWORD_MAX_LENGTH;

	const registering = $derived(account.card === 'register');
	/** A new password: the account's name shown, never typed. */
	const renewing = $derived(account.card === 'password');
	/** A new name for the player. */
	const naming = $derived(account.card === 'name');
	/** A change to the account away from its own browser: the password now is asked too. */
	const away = $derived((renewing || naming) && awayFromHome());
	/** The welcome card's content, or null on another card. */
	const welcome = $derived(account.card === 'welcome' ? account.welcome : null);
	/** The boxes are up: every card but a welcome card with no account to open. */
	const boxes = $derived(welcome === null || welcome.phase === 'ready');
	/** A new password is picked (a new account, a welcome, a new one), not an old one typed. */
	const choosing = $derived(registering || renewing || welcome !== null);
	/** The name is the account's own, shown and never typed. */
	const fixedName = $derived(
		welcome?.phase === 'ready' ? welcome.name : renewing ? (account.name ?? '') : null
	);
	/** Logging in on this browser's own account: the name alone, no password box. */
	const nameAlone = $derived(loginByNameAlone());
	/** The boxes that take typing, in order; the welcome card's and a new password's name is shown above them. */
	const fields = $derived(cardBoxes());

	interface Words {
		heading: string;
		text?: string;
		back: string;
		go?: string;
		keys?: string;
	}

	/** A spent welcome link's heading and line. */
	function goneWords(why: WelcomeGone): Pick<Words, 'heading' | 'text'> {
		switch (why) {
			case 'used':
				return { heading: t('account.welcome.used'), text: t('account.welcome.usedText') };
			case 'expired':
				return { heading: t('account.welcome.expired'), text: t('account.welcome.expiredText') };
			case 'unknown':
				return { heading: t('account.welcome.unknown'), text: t('account.welcome.unknownText') };
		}
	}

	/** The card's heading, its line, its two buttons and its key reminder. */
	const words = $derived.by((): Words => {
		if (welcome === null) {
			if (renewing) {
				return {
					heading: t('account.newPassword.title'),
					text: away ? t('account.newPassword.awayText') : t('account.newPassword.text'),
					back: t('account.back'),
					go: t('account.newPassword.go'),
					keys: away ? t('account.newPassword.awayKeys') : t('account.newPassword.keys')
				};
			}
			if (naming) {
				return {
					heading: t('account.newName.title'),
					text:
						account.name === null
							? t('account.newName.guestText')
							: away
								? t('account.newName.awayText')
								: t('account.newName.text'),
					back: t('account.back'),
					go: t('account.newName.go'),
					keys: away ? t('account.newName.awayKeys') : t('account.newName.keys')
				};
			}
			if (registering && account.from === 'gate') {
				return {
					heading: t('account.gate.title'),
					text: t('account.gate.text'),
					back: t('account.back'),
					go: t('account.gate.go'),
					keys: t('account.gate.keys')
				};
			}
			return registering
				? {
						heading: t('account.register.title'),
						text: t('account.register.text'),
						back: t('account.back'),
						go: t('account.register.go'),
						keys: t('account.register.keys')
					}
				: {
						heading: t('account.login.title'),
						text: nameAlone ? t('account.login.homeText') : t('account.login.text'),
						back: t('account.back'),
						go: t('account.login.go'),
						keys: nameAlone ? t('account.login.homeKeys') : t('account.login.keys')
					};
		}
		switch (welcome.phase) {
			case 'checking':
				return { heading: t('account.welcome.checking'), back: t('account.welcome.later') };
			case 'ready':
				return {
					heading: t('account.welcome.title', { name: welcome.name }),
					text: t('account.welcome.text'),
					back: t('account.welcome.later'),
					go: t('account.welcome.go'),
					keys: t('account.welcome.keys')
				};
			case 'gone':
				return {
					...goneWords(welcome.why),
					// The way on without logging in: the game this browser plays, a guest's or an account's.
					back:
						account.name === null
							? t('account.welcome.guest')
							: t('account.welcome.playAs', { name: account.name }),
					// Logging in is offered only while the server can keep an account, as every offer is.
					go: account.ready ? t('account.welcome.logIn') : undefined,
					keys: account.ready ? t('account.welcome.goneKeys') : t('account.welcome.playKeys')
				};
			case 'unreachable':
				return {
					heading: t('account.welcome.checking'),
					// No answer, or too many tries from here lately: the wait the server asked for.
					text:
						welcome.minutes === undefined
							? t('account.problem.offline')
							: t('account.problem.tooMany', { count: welcome.minutes }),
					back: t('account.welcome.later'),
					go: t('account.welcome.retry'),
					keys: t('account.welcome.retryKeys')
				};
		}
	});

	function problemWords(problem: AccountProblem): string {
		switch (problem.kind) {
			case 'name':
				return nameRefusal(problem.reason);
			case 'taken':
				return t('account.problem.taken');
			case 'password':
				return problem.reason === 'short'
					? t('account.problem.passwordShort', { min: PASSWORD_MIN_LENGTH })
					: t('account.problem.passwordLong', { max: PASSWORD_MAX_LENGTH });
			case 'wrong':
				return t('account.problem.wrong');
			case 'wrong-current':
				return t('account.problem.wrongCurrent');
			case 'logged-out':
				return t('account.problem.loggedOut');
			case 'too-many':
				return t('account.problem.tooMany', { count: problem.minutes });
			case 'offline':
				return t('account.problem.offline');
			case 'not-home':
				return t('account.problem.notHome');
			case 'storage':
				return welcome ? t('account.welcome.storage') : t('account.problem.storage');
		}
	}

	/** The box a finger or a mouse last went down on. */
	let aimed: HTMLInputElement | null = null;
	/** When the card came up (it is made as it opens). */
	const shownAt = performance.now();

	/**
	 * The box for `field`: focused while it takes the typing (and again if it
	 * loses the focus, so a tablet's keyboard stays up), and made the one that
	 * takes it when it is focused, by a finger, a click, or a screen reader.
	 * Except just after the card came up (`DOUBLE_TAP_MS`) for a box no
	 * pointer went down on: after a tap a browser sends a mousedown of its
	 * own where the finger was, which focuses whatever box opened under it (a
	 * phone's New password row lies under the card's second box). That focus
	 * moves nothing, and the lit box takes it back (`refocus`).
	 */
	const box = (field: AccountField) => (input: HTMLInputElement) => {
		if (account.field === field) {
			input.focus();
			// A new name's box holds the name the player has, picked whole: typing replaces it.
			if (field === 'name' && account.card === 'name') input.select();
		}
		const aim = () => {
			aimed = input;
		};
		const take = () => {
			const echo = aimed !== input && performance.now() - shownAt < DOUBLE_TAP_MS;
			if (!echo && account.field !== field) account.field = field;
		};
		const refocus = () =>
			requestAnimationFrame(() => {
				if (account.card !== null && account.field === field && input.isConnected) input.focus();
			});
		input.addEventListener('pointerdown', aim);
		input.addEventListener('focus', take);
		input.addEventListener('blur', refocus);
		return () => {
			input.removeEventListener('pointerdown', aim);
			input.removeEventListener('focus', take);
			input.removeEventListener('blur', refocus);
		};
	};

	/** A tablet's keyboard may have slid the page up to show a box; put it back when the card goes. */
	const card = () => () => window.scrollTo(0, 0);
</script>

<div class="shade" class:typing={touch.on}>
	<div class="card account-card" role="dialog" aria-labelledby="account-heading" {@attach card}>
		<div class="heading" id="account-heading">{words.heading}</div>
		{#if words.text}
			<p>{words.text}</p>
		{/if}
		{#if boxes}
			{#if fixedName !== null}
				<label class="field">
					<span class="label">{t('account.name')}</span>
					<!-- The account's own name: shown, never typed, and there for a password manager. -->
					<input
						class="box fixed"
						type="text"
						value={fixedName}
						autocomplete="username"
						readonly
						tabindex="-1"
					/>
				</label>
			{/if}
			{#each fields as field (field)}
				{#if field === 'name'}
					<label class="field">
						<span class="label">{naming ? t('account.newName.label') : t('account.name')}</span>
						<input
							class="box"
							class:active={account.field === 'name'}
							type="text"
							bind:value={account.nameDraft}
							maxlength={MAX_TYPED_NAME}
							autocomplete={naming ? 'off' : 'username'}
							autocapitalize="words"
							autocorrect="off"
							spellcheck="false"
							enterkeyhint={fields.length > 1 ? 'next' : 'done'}
							readonly={account.busy}
							{@attach box('name')}
						/>
					</label>
				{:else}
					{@const current = field === 'current'}
					<label class="field">
						<span class="label"
							>{current
								? t('account.current')
								: renewing
									? t('account.newPassword.label')
									: t('account.password')}</span
						>
						<span class="secret">
							{#if current}
								<input
									class="box"
									class:active={account.field === 'current'}
									type={account.reveal ? 'text' : 'password'}
									bind:value={account.currentDraft}
									maxlength={MAX_TYPED_PASSWORD}
									autocomplete="current-password"
									autocapitalize="off"
									autocorrect="off"
									spellcheck="false"
									enterkeyhint={naming ? 'done' : 'next'}
									readonly={account.busy}
									{@attach box('current')}
								/>
							{:else}
								<input
									class="box"
									class:active={account.field === 'password'}
									type={account.reveal ? 'text' : 'password'}
									bind:value={account.passwordDraft}
									maxlength={MAX_TYPED_PASSWORD}
									autocomplete={choosing ? 'new-password' : 'current-password'}
									autocapitalize="off"
									autocorrect="off"
									spellcheck="false"
									enterkeyhint={choosing ? 'done' : 'go'}
									readonly={account.busy}
									{@attach box('password')}
								/>
							{/if}
							<button
								type="button"
								class="reveal"
								aria-pressed={account.reveal}
								data-press={REVEAL_KEY}
								{@attach unfocusable}
							>
								{account.reveal ? t('account.hide') : t('account.show')}
							</button>
						</span>
					</label>
				{/if}
			{/each}
			{#if account.problem}
				<div class="note refused" role="alert">{problemWords(account.problem)}</div>
			{:else if account.busy}
				<div class="note">{t('account.busy')}</div>
			{:else if choosing}
				<div class="note">{t('account.passwordRule', { min: PASSWORD_MIN_LENGTH })}</div>
			{:else if naming}
				<div class="note">
					{t('playerName.rule', { min: MIN_NAME_LENGTH, max: MAX_NAME_LENGTH })}
				</div>
			{:else if nameAlone}
				<div class="note">{t('account.login.home')}</div>
			{:else}
				<div class="note">{t('account.login.forgot')}</div>
			{/if}
		{:else if welcome?.phase === 'checking'}
			<div class="note">{t('account.busy')}</div>
		{/if}
		<div class="card-buttons">
			<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
				{words.back}
			</button>
			{#if words.go}
				<button
					type="button"
					class="pill go"
					class:waiting={account.busy}
					data-press="Enter"
					{@attach unfocusable}
				>
					{words.go}
				</button>
			{/if}
		</div>
		{#if !touch.on && words.keys}
			<div class="keys">{words.keys}</div>
		{/if}
	</div>
</div>

<style>
	/* The card is centred by its auto margins, not by the grid's centring: a card taller than
	   the screen (a phone held sideways, away from home) then starts at the top, and the shade
	   scrolls to its buttons, where a centred one would hang off both edges, out of reach. */
	.shade {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		background: rgba(45, 42, 50, 0.45);
		padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right))
			calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
		pointer-events: auto;
	}
	.account-card {
		margin: auto;
	}
	/* On a touch screen the card is at the top, so a tablet's keyboard leaves the boxes in view. */
	.shade.typing .account-card {
		margin: 0 auto auto;
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
	}
	.account-card {
		width: min(560px, 100%);
		padding: 18px 22px 14px;
		text-align: center;
		color: var(--panel-ink);
	}
	.heading {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.2;
		margin: 0 0 6px;
	}
	p {
		margin: 0 0 10px;
		font-weight: 600;
		font-size: 18px;
	}
	.field {
		display: block;
		text-align: left;
		margin-top: 8px;
	}
	.label {
		display: block;
		font-weight: 800;
		font-size: 16px;
		margin: 0 0 4px 4px;
	}
	.secret {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}
	.box {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		font: inherit;
		font-weight: 800;
		font-size: 24px;
		color: var(--panel-ink);
		padding: 6px 12px;
		min-height: var(--tap);
		border: 3px solid rgba(0, 0, 0, 0.15);
		border-radius: 12px;
		background: white;
		outline: none;
	}
	.box.active {
		border-color: var(--accent);
	}
	/* While the server is asked: read-only, not disabled, so the box keeps the focus (a
	   disabled box drops it, and the kid's next try would type into nothing). */
	.box:read-only {
		opacity: 0.6;
	}
	/* The welcome card's name: the account's own, shown clearly, never typed in. */
	.box.fixed:read-only {
		opacity: 1;
		background: rgba(0, 0, 0, 0.05);
	}
	.reveal {
		flex: none;
		min-width: 88px;
		min-height: var(--tap);
		padding: 0 14px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 16px;
	}
	.reveal[aria-pressed='true'] {
		background: rgba(255, 159, 67, 0.3);
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	/* The rule under the boxes, and in its place why the card did not go on: the same box, so
	   the card keeps its height; the reason in ink on a soft tint of the "not quite" red. */
	.note {
		margin: 10px 0 0;
		padding: 6px 10px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 16px;
	}
	.refused {
		font-weight: 800;
		background: rgba(242, 95, 92, 0.16);
	}
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
	.pill.waiting {
		opacity: 0.6;
	}
	.pill:active {
		transform: scale(0.97);
	}
	.keys {
		margin-top: 12px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
	/* A short screen (`SHORT_SCREEN`, a phone held sideways): the same card, closer together, so a
	   card of two boxes fits a phone 375 px tall; one of three scrolls. */
	@media (max-height: 560px) {
		.shade {
			padding-top: calc(8px + var(--safe-top));
			padding-bottom: calc(8px + var(--safe-bottom));
		}
		.account-card {
			padding: 10px 18px 10px;
		}
		.heading {
			font-size: 22px;
			margin-bottom: 2px;
		}
		p {
			font-size: 16px;
			margin-bottom: 4px;
		}
		.field {
			margin-top: 4px;
		}
		.label {
			margin-bottom: 2px;
		}
		.note {
			margin-top: 6px;
			padding: 4px 10px;
		}
		.card-buttons,
		.keys {
			margin-top: 8px;
		}
	}
</style>
