/**
 * Everything the doctor says, in one place: on the card, as the player
 * leaves, and after a lost battle. The client words these from the doctor's
 * events itself (the engine's `DoctorState.log` and `Rescue.message` are not
 * shown), the way the battle screen words its narration, so the words can
 * move to per-language files without touching the engine or the authority.
 */
export const doctorLines = {
	hello: 'Hello! Who needs help today?',
	helloAllFit: 'Hello! Your animals are all fit and happy.',
	letsHelp: (name: string) => `Let's help ${name}! Can you solve this?`,
	notQuite: "Not quite! Let's try another one.",
	healed: (name: string, someoneStillHurt: boolean) =>
		`Well done! ${name} feels all better! ${someoneStillHurt ? 'Who is next?' : 'Everyone is fit and happy!'}`,
	bye: 'Bye! Come back any time.',
	/** After a lost battle: taken to a tent, or (no tent near) a doctor came to the player. */
	rescued: (atTent: boolean) =>
		atTent
			? 'The doctor looked after your animals. Everyone feels better!'
			: 'A doctor came by and looked after your animals. Everyone feels better!'
};
