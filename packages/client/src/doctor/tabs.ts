/**
 * The doctor's card's tabs, left to right ([[UI_SPEC]] § Doctor): **heal**
 * the hurt animals, help animals **home** to the wild for tokens, the
 * **shop**, and **fly** to another land (#191), shown only where there is
 * another land to list.
 */
export type DoctorTab = 'heal' | 'home' | 'shop' | 'fly';

export const DOCTOR_TABS: readonly DoctorTab[] = ['heal', 'home', 'shop', 'fly'];
