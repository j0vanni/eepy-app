import { createContext } from 'react';

/**
 * Lets a tab screen dim the tab bar (Today's night view sets it while focused), so nothing bright
 * is left on screen after lights-out.
 */
export const NightChromeContext = createContext<(night: boolean) => void>(() => undefined);
