/**
 * The doctor's card's tabs, left to right ([[UI_SPEC]] § Doctor): **heal**
 * the hurt animals, help animals **home** to the wild for tokens, the
 * **shop**, **ask** about an animal not caught yet, and **fly** to another
 * land (#191), shown only where there is another land to list.
 */
export type DoctorTab = 'heal' | 'home' | 'shop' | 'ask' | 'fly';

export const DOCTOR_TABS: readonly DoctorTab[] = ['heal', 'home', 'shop', 'ask', 'fly'];
