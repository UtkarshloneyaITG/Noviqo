/**
 * SignIn — sign in / create account, shown over the lobby rooftop.
 * The starter look being picked stands on the pedestal (via store.signup).
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Icon, STARTERS, USERNAME_RE, normalizeUsername } from './ui'

export default function SignIn() {
  const isConnected = useAppStore((s) => s.isConnected)
  const authPending = useAppStore((s) => s.authPending)
  const authError = useAppStore((s) => s.authError)
  const { signIn, signUp, setSignup } = useAppStore.getState()

  const [tab, setTab] = useState('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [look, setLook] = useState(0)
  const [tried, setTried] = useState(false)

  const create = tab === 'create'
  const uname = normalizeUsername(username)
  const unameOk = USERNAME_RE.test(uname)
  const shownName = name.trim() || (unameOk ? uname.slice(1) : '')

  // Mirror the create form onto the pedestal.
  useEffect(() => {
    setSignup(create ? { character: STARTERS[look], name: shownName } : null)
  }, [create, look, shownName, setSignup])
  useEffect(() => () => setSignup(null), [setSignup])

  const errors = {
    username: unameOk ? null : 'Use 3 to 20 letters, numbers or underscores',
    password: create ? (password.length >= 8 ? null : 'Use at least 8 characters') : password ? null : 'Enter your password',
  }

  const submit = (e) => {
    e.preventDefault()
    setTried(true)
    if (errors.username || errors.password) return
    if (create) {
      signUp({ username: uname, password, display_name: shownName, character: STARTERS[look] })
    } else {
      signIn(uname, password)
    }
  }

  const switchTab = (t) => {
    setTab(t)
    setTried(false)
  }

  const label = !isConnected
    ? 'Connecting'
    : authPending
      ? create
        ? 'Creating'
        : 'Signing in'
      : create
        ? 'Create account'
        : 'Sign in'

  return (
    <section className="lb-signin" aria-labelledby="lb-signin-title">
      <h1 id="lb-signin-title" className="lb-hero">
        {create ? 'Create your account' : 'Welcome back'}
      </h1>
      <p className="lb-sub">
        {create ? 'Pick a username and a look. You can change your in-game name later.' : 'Sign in to see your party and friends.'}
      </p>

      <div className="lb-panel lb-form">
        <div className="lb-seg" role="tablist" aria-label="Account">
          <button role="tab" aria-selected={!create} className={create ? '' : 'act'} onClick={() => switchTab('signin')}>
            Sign in
          </button>
          <button role="tab" aria-selected={create} className={create ? 'act' : ''} onClick={() => switchTab('create')}>
            Create account
          </button>
        </div>

        <form onSubmit={submit} noValidate>
          <label className="lb-field">
            <span>Username</span>
            <span className="lb-at">
              <i aria-hidden="true">@</i>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/^@/, '').toLowerCase())}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={21}
                aria-invalid={tried && !!errors.username}
                aria-describedby="lb-err-user"
              />
            </span>
            <em id="lb-err-user">{tried && errors.username}</em>
          </label>

          <label className="lb-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={create ? 'new-password' : 'current-password'}
              aria-invalid={tried && !!errors.password}
              aria-describedby="lb-err-pass"
            />
            <em id="lb-err-pass">{tried && errors.password}</em>
          </label>

          {create && (
            <>
              <label className="lb-field">
                <span>
                  In-game name <small>optional</small>
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={20}
                  placeholder={unameOk ? uname.slice(1) : 'Same as your username'}
                />
              </label>

              <div className="lb-field">
                <span id="lb-look">Your look</span>
                <div className="lb-look" role="group" aria-labelledby="lb-look">
                  <button type="button" aria-label="Previous look" onClick={() => setLook((look + 3) % 4)}>
                    <Icon name="left" />
                  </button>
                  <b aria-live="polite">
                    Look {look + 1} of {STARTERS.length}
                  </b>
                  <button type="button" aria-label="Next look" onClick={() => setLook((look + 1) % 4)}>
                    <Icon name="right" />
                  </button>
                </div>
                <small className="lb-hint">More looks unlock as you play.</small>
              </div>
            </>
          )}

          {authError && (
            <p className="lb-err" role="alert">
              {authError}
            </p>
          )}

          <button type="submit" className="lb-start lb-submit" disabled={!isConnected || authPending}>
            {label}
          </button>
        </form>
      </div>
    </section>
  )
}
