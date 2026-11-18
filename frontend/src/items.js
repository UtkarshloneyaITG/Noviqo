/**
 * Client-side visuals for inventory items. The server owns the catalog
 * (names, prices, how each item is earned) and sends it in the `catalog`
 * message; this file only maps item ids to how they look.
 */

/** Card back designs: body colour, ellipse colour, wordmark colour. */
export const CARD_BACKS = {
  'back:classic':  { base: '#15151b', ellipse: '#d9352c', word: '#f5d020' },
  'back:gold':     { base: '#2a1d05', ellipse: '#e8b417', word: '#fff3c4' },
  'back:crimson':  { base: '#2a070d', ellipse: '#b3122e', word: '#ffd6dc' },
  'back:ocean':    { base: '#04182a', ellipse: '#1f7fd1', word: '#c9f1ff' },
  'back:neon':     { base: '#0b0620', ellipse: '#c13cff', word: '#4fd8ff' },
  'back:midnight': { base: '#05060f', ellipse: '#27306b', word: '#ffc53d' },
}
export const DEFAULT_CARD_BACK = 'back:classic'

/** Table felt colours. */
export const FELTS = {
  'felt:green':    '#0f5d3a',
  'felt:midnight': '#13204a',
  'felt:crimson':  '#6b1624',
  'felt:ocean':    '#0d4f6b',
  'felt:violet':   '#3d1f6b',
}
export const DEFAULT_FELT = 'felt:green'

/** Chat emote packs. */
export const EMOTES = {
  'emotes:basic': ['👍', '😂', '😮', '😡', '🎉', '❤️', '🤔', '😎', '🔥', '👋', '😭', '🤝'],
  'emotes:party': ['🃏', '💀', '🙏', '🎯', '😈', '🤡', '👑', '🫡'],
}

/** Emotes available to someone who owns the given item ids. */
export function emotesFor(inventory = []) {
  return Object.entries(EMOTES)
    .filter(([id]) => id === 'emotes:basic' || inventory.includes(id))
    .flatMap(([, list]) => list)
}
