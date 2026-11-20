/**
 * Zustand store — single source of truth for the client.
 *
 * The server owns everything (accounts, party, friends, games). The only
 * thing kept client-side is the session token in localStorage['nq.session'];
 * the socket hook sends it as `auth` on every (re)connect and the server
 * re-binds the account (and its live game, if any).
 *
 * Outbound lobby messages go through `send(type, payload)`, which maps 1:1
 * onto the protocol table in the platform spec. Game actions keep their
 * named methods (the table HUD calls them).
 */

import { create } from 'zustand'

const TOKEN_KEY = 'nq.session'

export function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable — the session just won't survive a refresh
  }
}

const CHAT_KEEP = 100
const INVITE_MS = 30_000 // how long a party invite lasts (server: parties.INVITE_TTL_S)
const keep = (list, msg) => [...list, msg].slice(-CHAT_KEEP)

let actionPendingTimer = null
let errorTimer = null
let notificationTimer = null

// Everything tied to an account; reset on sign out / rejected token.
const ACCOUNT_STATE = {
  profile: null,
  catalog: { items: [], milestones: [], emotes: [] },
  friends: [],
  incoming: [],
  outgoing: [],
  party: null,
  invites: [],      // party_invite messages awaiting an answer (each lapses at expires_at)
  sentInvites: {},  // party invites you sent: friend id -> when they lapse (ms)
  requests: [],     // party_request messages awaiting an answer (leader)
  gchat: [],
  pchat: [],
  emotes: {},       // lobby emote last played by each party member: id -> { id: emote, at: performance.now() }
  newItems: [],     // item ids unlocked by recent games, until Inventory is opened
  leaderboard: null, // last 'leaderboard' reply: { board, scope, rows, me }
  userResults: null, // last 'user_results' reply (Add friend page): { q, users }
  rolesState: null,  // your view of a Raja Mantri Chor Sipahi table (+ deadline: Date.now() ms), or null
  panel: null,      // open lobby panel: inventory|shop|milestones|ranks|settings|friends|addfriend|invite|games
  playerId: null,
  roomId: null,
  gameState: null,
  bubbles: {},
}

/** Where each other player at the table is looking: id -> { yaw, pitch }.
 *  Plain object, not store state: it changes ~10×/s per player and only the
 *  seated characters read it, every frame, so it must never re-render React. */
export const looks = {}

export const useAppStore = create((set, get) => ({
  // ── Connection ────────────────────────────────────────────────────────────
  isConnected: false,
  sendMessage: null,          // injected by the useWebSocket hook
  // 'connecting' | 'online' | 'reconnecting'
  connectionPhase: 'connecting',
  actionPending: false,       // true while a gameplay action awaits the server

  // ── Account ──────────────────────────────────────────────────────────────
  // 'connecting' (no answer yet) | 'checking' (token sent) | 'signed_out' | 'signed_in'
  auth: 'connecting',
  authPending: false,         // sign in / create account awaiting the server
  authError: null,
  signup: null,               // { character, name } while the create-account form is open (shown on the pedestal)
  ...ACCOUNT_STATE,

  // ── Game UI ──────────────────────────────────────────────────────────────
  showColorPicker: false,
  pendingWildCardId: null,    // card ID waiting for colour selection
  error: null,
  notification: null,         // brief toast message
  _bubbleSeq: 0,

  // =========================================================================
  // Setters called by the WS hook / UI
  // =========================================================================

  setConnected: (v) =>
    set((s) => ({
      isConnected: v,
      connectionPhase: v ? 'online' : s.profile ? 'reconnecting' : 'connecting',
    })),

  setSendMessage: (fn) => set({ sendMessage: fn }),

  // Socket just opened: present the stored token, or go to sign-in.
  authenticate: () => {
    const token = readToken()
    if (!token) {
      set({ auth: 'signed_out' })
      return
    }
    // Keep the lobby up during a reconnect instead of flashing "signing in".
    set((s) => ({ auth: s.profile ? 'signed_in' : 'checking' }))
    get().sendMessage?.({ type: 'auth', token })
  },

  send: (type, payload = {}) => get().sendMessage?.({ type, ...payload }),
  sendLook: (yaw, pitch) => get().sendMessage?.({ type: 'look', yaw, pitch }),

  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  // Shop "Preview": close the panel and play that entrance on your own figure.
  entryPreview: null, // { id, at }
  previewEntry: (id) => set({ panel: null, entryPreview: { id, at: performance.now() } }),
  setSignup: (signup) => set({ signup }),

  _clearActionPending: () => {
    clearTimeout(actionPendingTimer)
    set({ actionPending: false })
  },

  _setActionPending: () => {
    set({ actionPending: true })
    clearTimeout(actionPendingTimer)
    // Safety valve: never wedge the UI if the server response goes missing.
    actionPendingTimer = setTimeout(() => set({ actionPending: false }), 3000)
  },

  // Each new toast restarts its own timer, so an older timeout can't wipe
  // a newer message early.
  setError: (msg) => {
    set({ error: msg })
    clearTimeout(errorTimer)
    if (msg) errorTimer = setTimeout(() => set({ error: null }), 4000)
  },

  setNotification: (msg) => {
    set({ notification: msg })
    clearTimeout(notificationTimer)
    if (msg) notificationTimer = setTimeout(() => set({ notification: null }), 3000)
  },

  // =========================================================================
  // Inbound message handler (called by useWebSocket on every WS message)
  // =========================================================================

  handleMessage: (message) => {
    const { type } = message

    switch (type) {
      // ── Account ──────────────────────────────────────────────────────────
      case 'auth_ok': {
        writeToken(message.token)
        set({
          auth: 'signed_in',
          authPending: false,
          authError: null,
          signup: null,
          profile: message.profile,
          playerId: message.profile?.id ?? null,
        })
        break
      }

      case 'auth_error': {
        writeToken(null)
        set({ ...ACCOUNT_STATE, auth: 'signed_out', authPending: false, authError: message.message || null })
        break
      }

      case 'signed_out': {
        writeToken(null)
        set({ ...ACCOUNT_STATE, auth: 'signed_out', authPending: false, authError: null })
        break
      }

      case 'catalog': {
        set({ catalog: { items: message.items || [], milestones: message.milestones || [], emotes: message.emotes || [] } })
        break
      }

      case 'profile': {
        set({ profile: message.profile, playerId: message.profile?.id ?? get().playerId })
        break
      }

      case 'leaderboard': {
        set({ leaderboard: { board: message.board, scope: message.scope, rows: message.rows || [], me: message.me } })
        break
      }

      case 'roles_state': {
        const st = message.state
        set({ rolesState: { ...st, deadline: st.ms_left == null ? null : Date.now() + st.ms_left } })
        break
      }

      case 'roles_left': {
        set({ rolesState: null, bubbles: {} })
        break
      }

      case 'user_results': {
        set({ userResults: { q: message.q, users: message.users || [] } })
        break
      }

      case 'friends': {
        set({
          friends: message.friends || [],
          incoming: message.incoming || [],
          outgoing: message.outgoing || [],
        })
        break
      }

      // ── Party ────────────────────────────────────────────────────────────
      case 'party': {
        const party = message.party
        const memberIds = new Set((party?.members || []).map((m) => m.id))
        set((s) => ({
          party,
          // A new party means a new party chat; answered requests drop off.
          pchat: s.party?.id === party?.id ? s.pchat : [],
          requests: s.requests.filter((r) => !memberIds.has(r.from.id)),
          invites: s.invites.filter((i) => i.party_id !== party?.id),
        }))
        break
      }

      case 'party_invite': {
        // The server lets it lapse after expires_in seconds; drop the toast at the same moment.
        const invite = { ...message, expires_at: Date.now() + (message.expires_in ?? INVITE_MS / 1000) * 1000 }
        set((s) => ({ invites: [...s.invites.filter((i) => i.party_id !== message.party_id), invite] }))
        setTimeout(() => set((s) => ({ invites: s.invites.filter((i) => i !== invite) })), invite.expires_at - Date.now())
        break
      }

      case 'party_request': {
        set((s) => ({
          requests: [...s.requests.filter((r) => r.from.id !== message.from.id), message],
        }))
        break
      }

      // ── Chat ─────────────────────────────────────────────────────────────
      case 'gchat_history': {
        set({ gchat: (message.messages || []).slice(-CHAT_KEEP) })
        break
      }

      case 'gchat':
      case 'pchat': {
        if (message.message) set((s) => ({ [type]: keep(s[type], message.message) }))
        break
      }

      case 'emote': {
        set((s) => ({ emotes: { ...s.emotes, [message.id]: { id: message.emote, at: performance.now() } } }))
        break
      }

      case 'notice': {
        get().setNotification(message.message)
        break
      }

      case 'game_rewards': {
        const unlocked = message.rewards?.unlocked || []
        if (unlocked.length) set((s) => ({ newItems: [...new Set([...s.newItems, ...unlocked])] }))
        break
      }

      // ── Game ─────────────────────────────────────────────────────────────
      case 'joined': {
        set({ playerId: message.player_id, roomId: message.room_id, gameState: null, error: null })
        break
      }

      // ── Rematch — everyone returns to the lobby ──────────────────────────
      case 'rematch_started': {
        set({ gameState: null })
        break
      }

      // ── This client was kicked from the game ─────────────────────────────
      case 'kicked': {
        set({ roomId: null, gameState: null, bubbles: {} })
        get().setError(message.message || 'You were removed from the game.')
        break
      }

      case 'player_left': {
        get().setNotification(`${message.player_name} left the game.`)
        break
      }

      case 'player_reconnected': {
        get().setNotification(`${message.player_name} reconnected.`)
        break
      }

      // ── Live game state (personalised) ───────────────────────────────────
      case 'game_state': {
        const newState = message.state
        const { playerId } = get()

        // Show a toast when this player's turn was just skipped
        if (
          newState.skipped_player_id &&
          newState.skipped_player_id === playerId
        ) {
          get().setNotification('⊘ Your turn was skipped!')
        }

        get()._clearActionPending()
        set({ gameState: newState })
        // Turn moved on (e.g. timed out) while choosing a wild colour.
        if (newState.current_player_id !== playerId && get().showColorPicker) {
          get().cancelColorPicker()
        }
        break
      }

      // ── Chat / emoji bubble ──────────────────────────────────────────────
      case 'look': {
        looks[message.id] = { yaw: message.yaw, pitch: message.pitch }
        break
      }

      case 'chat': {
        const { player_id, text } = message
        if (!player_id || !text) break
        const key = get()._bubbleSeq + 1
        set((s) => ({
          _bubbleSeq: key,
          bubbles: { ...s.bubbles, [player_id]: { text, key } },
        }))
        // Auto-dismiss after 5s, unless a newer bubble replaced it.
        setTimeout(() => {
          set((s) => {
            if (s.bubbles[player_id]?.key !== key) return {}
            const next = { ...s.bubbles }
            delete next[player_id]
            return { bubbles: next }
          })
        }, 5000)
        break
      }

      // ── Error from server ────────────────────────────────────────────────
      case 'error': {
        get()._clearActionPending()
        // A failed sign in / sign up shows on the form, not as a toast.
        if (get().authPending) {
          set({ authPending: false, authError: message.message })
          break
        }
        get().setError(message.message)
        break
      }

      default:
        break
    }
  },

  // =========================================================================
  // Account / lobby actions
  // =========================================================================

  signIn: (username, password) => {
    set({ authPending: true, authError: null })
    get().send('signin', { username, password })
  },

  signUp: (fields) => {
    set({ authPending: true, authError: null })
    get().send('signup', fields)
  },

  signOut: () => {
    get().send('signout')
    writeToken(null)
    set({ ...ACCOUNT_STATE, auth: 'signed_out' })
  },

  acceptInvite: (partyId) => {
    get().send('party_accept', { party_id: partyId })
    get().dismissInvite(partyId)
  },

  /** Invite a friend to your party; the button counts down until the invite lapses. */
  // Raja Mantri Chor Sipahi: take a chit, swing the blaster, fire, go back to the lobby.
  rolesPick: (slot) => get().send('roles_pick', { slot }),
  rolesAim: (target) => get().send('roles_aim', { target }),
  rolesGuess: (target) => get().send('roles_guess', { target }),
  rolesLeave: () => {
    get().send('roles_leave')
    set({ rolesState: null, bubbles: {} })
  },

  inviteFriend: (id) => {
    get().send('party_invite', { id })
    const until = Date.now() + INVITE_MS
    set((s) => ({ sentInvites: { ...s.sentInvites, [id]: until } }))
    setTimeout(() => set((s) => {
      if (s.sentInvites[id] !== until) return {}
      const { [id]: _, ...rest } = s.sentInvites
      return { sentInvites: rest }
    }), INVITE_MS)
  },

  // No decline message exists for invites — "Not now" just hides it.
  dismissInvite: (partyId) =>
    set((s) => ({ invites: s.invites.filter((i) => i.party_id !== partyId) })),

  answerRequest: (id, admit) => {
    get().send(admit ? 'party_admit' : 'party_deny', { id })
    set((s) => ({ requests: s.requests.filter((r) => r.from.id !== id) }))
  },

  clearNewItems: () => set({ newItems: [] }),

  // =========================================================================
  // Game actions (call these to send WS messages)
  // =========================================================================

  rematch: () => {
    get().sendMessage?.({ type: 'rematch' })
  },

  // `card` is the full card object from gameState.my_hand
  selectCard: (card) => {
    const { gameState, playerId } = get()
    if (!gameState) return
    if (gameState.current_player_id !== playerId) return
    if (gameState.status !== 'playing') return

    // Wild cards require a colour selection first
    if (card.card_type === 'wild' || card.card_type === 'wild_draw_four') {
      set({ showColorPicker: true, pendingWildCardId: card.id })
    } else {
      get()._setActionPending()
      get().sendMessage?.({ type: 'play_card', card_id: card.id })
    }
  },

  chooseColor: (color) => {
    const { pendingWildCardId } = get()
    if (pendingWildCardId) {
      get()._setActionPending()
      get().sendMessage?.({
        type: 'play_card',
        card_id: pendingWildCardId,
        chosen_color: color,
      })
    }
    set({ showColorPicker: false, pendingWildCardId: null })
  },

  cancelColorPicker: () => {
    set({ showColorPicker: false, pendingWildCardId: null })
  },

  drawCard: () => {
    get()._setActionPending()
    get().sendMessage?.({ type: 'draw_card' })
  },

  passTurn: () => {
    get()._setActionPending()
    get().sendMessage?.({ type: 'pass_turn' })
  },

  callUno: () => {
    get().sendMessage?.({ type: 'call_uno' })
  },

  catchUno: (targetId) => {
    get().sendMessage?.({ type: 'catch_uno', target_id: targetId })
  },

  challengeWildFour: () => {
    get()._setActionPending()
    get().sendMessage?.({ type: 'challenge_wild4' })
  },

  leaveRoom: () => {
    get().sendMessage?.({ type: 'leave_room' })
    set({ roomId: null, gameState: null, bubbles: {} })
  },

  // Send a chat line or emoji; it echoes back to everyone (incl. sender) as a
  // bubble above the relevant player.
  sendChat: (text) => {
    const t = (text ?? '').toString().slice(0, 120).trim()
    if (!t) return
    get().sendMessage?.({ type: 'chat', text: t })
  },
}))
