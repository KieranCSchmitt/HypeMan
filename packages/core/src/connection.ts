/** Public development identity. Chrome derives the unpacked extension ID from this key.
 * This is not a credential; keeping it stable lets the local gateway recognize HypeMan.
 */
export const HYPEMAN_EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzGgEDLhJrnLB3uIXiOOlCm9/KUoJWvRFipqL0Hd8CjsBzUkFrkcfGMpjB4sxdI3hIEPyWcgc6B6LgKWS4r1W8jv3x2GgdaPv5/xU1pZhFkIQqJroqnmi4dwDIXobgh247Aeqp3HygPAd2mydCl3fRuCRWsGayUrJowTBJXv5uzfJdRTh86s41OaY9l+Lj0Jw7Y1qnwVZXLJqLs2zSRzAG1+E6064/05z9WKVbm7qMviXHRnymJxkggRlqr9sWme77KnILoQ+7mArZC3yP2UEZUXQOuUphRLMTlAEjES35X+cRNAQJLk6fT21gEFOwWSH2XGKBCox8pwoJmJXGz6hiQIDAQAB";
export const HYPEMAN_EXTENSION_ID = "lgafhjdfipidpblcihokcjfcgkilbekd";
export const HYPEMAN_EXTENSION_ORIGIN = `chrome-extension://${HYPEMAN_EXTENSION_ID}`;

export interface LocalConnection {
  token: string;
}
