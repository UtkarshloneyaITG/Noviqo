/**
 * PythonDocs — camouflage screen styled as Python 3 documentation.
 * Scroll to the bottom to reveal the hidden email input in the footer.
 * Entering the SECRET email below unlocks the real application.
 *
 * It behaves like a real docs page so it holds up to a click or two: quick
 * search filters the index and jumps to an entry, the theme menu switches
 * light / dark, code blocks copy, and on phones the sidebar is a slide-in menu.
 */

import { useEffect, useRef, useState } from 'react'
import '../styles/docs.css'

const SECRET = 'python@secret.com'
const THEME_KEY = 'currentTheme' // same key the real docs theme uses
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const INDEX = [
  'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes', 'callable',
  'chr', 'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter',
  'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int',
  'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object',
  'oct', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr',
  'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', '__import__',
]
const LIBRARY = [
  'Introduction', 'Built-in Functions', 'Built-in Constants', 'Built-in Types', 'Built-in Exceptions', 'Text Processing Services',
  'Binary Data Services', 'Data Types', 'Numeric and Mathematical Modules', 'Functional Programming Modules',
  'File and Directory Access', 'Data Persistence', 'Cryptographic Services', 'Generic Operating System Services',
  'Concurrent Execution', 'Networking and Interprocess Communication', 'Internet Protocols and Support',
  'Development Tools', 'Debugging and Profiling',
]

const C = ({ children }) => <code className="pydocs-c">{children}</code>
const Changed = ({ v, children }) => (
  <p className="pydocs-changed">
    <em>Changed in version {v}:</em> {children}
  </p>
)

/** A code block with a copy button; doctest blocks copy only the code, without prompts or output. */
function Code({ children }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const prompt = /^(>>>|\.\.\.)( |$)/
    const text = children.includes('>>> ')
      ? children.split('\n').filter((l) => prompt.test(l)).map((l) => l.replace(prompt, '')).join('\n')
      : children
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, () => {})
  }
  return (
    <div className="pydocs-pre">
      <button type="button" className="pydocs-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
      <pre>{children}</pre>
    </div>
  )
}

// The documented entries: name, one signature per overload, and the text.
const ENTRIES = [
  {
    name: 'abs', sigs: ['x'],
    body: <p>Return the absolute value of a number. The argument may be an integer, a floating-point number, or an object implementing <C>__abs__()</C>. If the argument is a complex number, its magnitude is returned.</p>,
  },
  {
    name: 'all', sigs: ['iterable'],
    body: <>
      <p>Return <C>True</C> if all elements of the <em>iterable</em> are true (or if the iterable is empty). Equivalent to:</p>
      <Code>{'def all(iterable):\n    for element in iterable:\n        if not element:\n            return False\n    return True'}</Code>
    </>,
  },
  {
    name: 'any', sigs: ['iterable'],
    body: <>
      <p>Return <C>True</C> if any element of the <em>iterable</em> is true. If the iterable is empty, return <C>False</C>. Equivalent to:</p>
      <Code>{'def any(iterable):\n    for element in iterable:\n        if element:\n            return True\n    return False'}</Code>
    </>,
  },
  {
    name: 'enumerate', sigs: ['iterable, start=0'],
    body: <>
      <p>Return an enumerate object. <em>iterable</em> must be a sequence, an iterator, or some other object which supports iteration. The <C>__next__()</C> method of the iterator returned by <C>enumerate()</C> returns a tuple containing a count (from <em>start</em> which defaults to 0) and the values obtained from iterating over <em>iterable</em>.</p>
      <Code>{">>> seasons = ['Spring', 'Summer', 'Fall', 'Winter']\n>>> list(enumerate(seasons))\n[(0, 'Spring'), (1, 'Summer'), (2, 'Fall'), (3, 'Winter')]\n>>> list(enumerate(seasons, start=1))\n[(1, 'Spring'), (2, 'Summer'), (3, 'Fall'), (4, 'Winter')]"}</Code>
    </>,
  },
  {
    name: 'filter', sigs: ['function, iterable'],
    body: <p>Construct an iterator from those elements of <em>iterable</em> for which <em>function</em> is true. <em>iterable</em> may be either a sequence, a container which supports iteration, or an iterator. If <em>function</em> is <C>None</C>, the identity function is assumed, that is, all elements of <em>iterable</em> that are false are removed.</p>,
  },
  {
    name: 'isinstance', sigs: ['object, classinfo'],
    body: <>
      <p>Return <C>True</C> if the <em>object</em> argument is an instance of the <em>classinfo</em> argument, or of a (direct, indirect, or virtual) subclass thereof. If <em>object</em> is not an object of the given type, the function always returns <C>False</C>. If <em>classinfo</em> is a tuple of type objects (or recursively, other such tuples) or a <a href="#">Union Type</a> of multiple types, return <C>True</C> if <em>object</em> is an instance of any of the types. If <em>classinfo</em> is not a type or tuple of types and such tuples, a <C>TypeError</C> exception is raised. <C>TypeError</C> may not be raised for an invalid type if an earlier check succeeds.</p>
      <Changed v="3.10"><em>classinfo</em> can be a <a href="#">Union Type</a>.</Changed>
    </>,
  },
  {
    name: 'len', sigs: ['s'],
    body: <>
      <p>Return the length (the number of items) of an object. The argument may be a sequence (such as a string, bytes, tuple, list, or range) or a collection (such as a dictionary, set, or frozen set).</p>
      <Code>{">>> len(\"hello\")\n5\n>>> len([1, 2, 3])\n3\n>>> len({'a': 1, 'b': 2})\n2"}</Code>
      <div className="pydocs-impl"><em>CPython implementation detail:</em> <C>len</C> raises <C>OverflowError</C> on lengths larger than <C>sys.maxsize</C>, such as <C>range(2 ** 100)</C>.</div>
    </>,
  },
  {
    name: 'map', sigs: ['function, iterable, *iterables'],
    body: <p>Return an iterator that applies <em>function</em> to every item of <em>iterable</em>, yielding the results. If additional <em>iterables</em> arguments are passed, <em>function</em> must take that many arguments and is applied to the items from all iterables in parallel. With multiple iterables, the iterator stops when the shortest iterable is exhausted.</p>,
  },
  {
    name: 'print', sigs: ["*objects, sep=' ', end='\\n', file=None, flush=False"],
    body: <>
      <p>Print <em>objects</em> to the text stream <em>file</em>, separated by <em>sep</em> and followed by <em>end</em>. <em>sep</em>, <em>end</em>, <em>file</em>, and <em>flush</em>, if present, must be given as keyword arguments.</p>
      <p>All non-keyword arguments are converted to strings like <C>str()</C> does and written to the stream, separated by <em>sep</em> and followed by <em>end</em>. Both <em>sep</em> and <em>end</em> must be strings; they can also be <C>None</C>, which means to use the default values. If no <em>objects</em> are given, <C>print()</C> will just write <em>end</em>.</p>
      <Changed v="3.3">Added the <em>flush</em> keyword argument.</Changed>
    </>,
  },
  {
    name: 'range', sigs: ['stop', 'start, stop, step=1'],
    body: <p>Rather than being a function, <C>range</C> is actually an immutable sequence type, as documented in <a href="#">Ranges</a> and <a href="#">Sequence Types — list, tuple, range</a>.</p>,
  },
  {
    name: 'sorted', sigs: ['iterable, /, *, key=None, reverse=False'],
    body: <>
      <p>Return a new sorted list from the items in <em>iterable</em>.</p>
      <p>Has two optional arguments which must be specified as keyword arguments. <em>key</em> specifies a function of one argument that is used to extract a comparison key from each element in <em>iterable</em> (for example, <C>key=str.lower</C>). The default value is <C>None</C> (compare the elements directly). <em>reverse</em> is a boolean value. If set to <C>True</C>, then the list elements are sorted as if each comparison were reversed.</p>
      <p>The built-in <C>sorted()</C> function is guaranteed to be stable. A sort is stable if it guarantees not to change the relative order of elements that compare equal — this is helpful for sorting in multiple passes.</p>
      <Code>{">>> sorted([5, 2, 3, 1, 4])\n[1, 2, 3, 4, 5]\n>>> sorted(\"This is a test string\".split(), key=str.casefold)\n['a', 'is', 'string', 'test', 'This']"}</Code>
    </>,
  },
  {
    name: 'type', sigs: ['object', 'name, bases, dict, **kwds'],
    body: <>
      <p>With one argument, return the type of an <em>object</em>. The return value is a type object and generally the same object as returned by <C>object.__class__</C>.</p>
      <p>The <C>isinstance()</C> built-in function is recommended for testing the type of an object, because it takes subclasses into account.</p>
      <Code>{">>> type(1)\n<class 'int'>\n>>> type('hello')\n<class 'str'>\n>>> type([])\n<class 'list'>"}</Code>
      <Changed v="3.6">Subclasses of <C>type</C> which don’t override <C>type.__new__</C> may no longer use the one-argument form to get the type of an object.</Changed>
    </>,
  },
  {
    name: 'vars', sigs: ['', 'object'],
    body: <p>Return the <C>__dict__</C> attribute for a module, class, instance, or any other object with a <C>__dict__</C> attribute. Objects such as modules and instances have an updateable <C>__dict__</C> attribute; however, other objects may have write restrictions on their <C>__dict__</C> attributes (for example, classes use a <C>types.MappingProxyType</C> to prevent direct dictionary updates).</p>,
  },
  {
    name: 'zip', sigs: ['*iterables, strict=False'],
    body: <>
      <p>Iterate over several iterables in parallel, producing tuples with an item from each one.</p>
      <Code>{">>> for item in zip([1, 2, 3], ['sugar', 'spice', 'everything nice']):\n...     print(item)\n...\n(1, 'sugar')\n(2, 'spice')\n(3, 'everything nice')"}</Code>
      <p>More formally: <C>zip()</C> returns an iterator of tuples, where the <em>i</em>-th tuple contains the <em>i</em>-th element from each of the argument iterables.</p>
      <p>Another way to think of <C>zip()</C> is that it turns rows into columns, and columns into rows. This is similar to transposing a matrix.</p>
      <Changed v="3.10">Added the <C>strict</C> argument.</Changed>
    </>,
  },
]
const DOCUMENTED = new Set(ENTRIES.map((e) => e.name))

/** name(params): parameters in italics, default values muted. */
function Sig({ name, params, anchor, onJump }) {
  return (
    <dt className="pydocs-sig" id={anchor ? name : undefined}>
      <b>{name}</b>(
      {params.split(/(=(?:'[^']*'|[^,]*))/).map((part, i) => part && (
        <span key={i} className={part[0] === '=' ? 'd' : 'p'}>{part}</span>
      ))}
      )
      {anchor && <a className="pydocs-permalink" href={`#${name}`} onClick={(e) => onJump(e, name)} aria-label={`Link to ${name}()`}>¶</a>}
    </dt>
  )
}

function Search({ query, setQuery, onSubmit }) {
  return (
    <form className="pydocs-search" role="search" onSubmit={onSubmit}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Quick search" aria-label="Quick search" />
      <button type="submit">Go</button>
    </form>
  )
}

function ThemeSelect({ theme, setTheme }) {
  return (
    <label className="pydocs-select-label">
      Theme
      <select className="pydocs-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="auto">Auto</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}

export default function PythonDocs({ onUnlock }) {
  const [email, setEmail] = useState('')
  const [footerVisible, setFooterVisible] = useState(false)
  const [shake, setShake] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'auto' } catch { return 'auto' }
  })
  const sentinelRef = useRef(null)
  const inputRef = useRef(null)

  const setTheme = (t) => {
    setThemeState(t)
    try { localStorage.setItem(THEME_KEY, t) } catch { /* private mode: just this visit */ }
  }
  const dark = theme === 'dark' || (theme === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)

  // Show footer once the sentinel div at the bottom enters the viewport
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setFooterVisible(true) }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Focus input when footer appears (not on touch screens: that would pop the keyboard up unasked)
  useEffect(() => {
    if (footerVisible && matchMedia('(pointer: fine)').matches) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 150)
  }, [footerVisible])

  // Esc closes the phone menu
  useEffect(() => {
    if (!menu) return
    const esc = (e) => e.key === 'Escape' && setMenu(false)
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [menu])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (email.trim().toLowerCase() === SECRET) {
      onUnlock()
    } else {
      setShake(true)
      setTimeout(() => setShake(false), 600)
      setEmail('')
    }
  }

  // In-page links scroll without touching the URL; placeholder links do nothing.
  const jump = (e, id) => {
    e?.preventDefault()
    setMenu(false)
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }
  const deadLinks = (e) => e.target.closest?.('a[href="#"]') && e.preventDefault()

  const q = query.trim().toLowerCase().replace(/\(\)$/, '')
  const hits = q ? INDEX.filter((n) => n.includes(q)) : INDEX
  const search = (e) => {
    e.preventDefault()
    if (!q) return
    const best = hits.find((n) => n === q && DOCUMENTED.has(n)) ?? hits.find((n) => DOCUMENTED.has(n))
    jump(null, best ?? 'pydocs-index')
  }

  return (
    <div className={`pydocs ${menu ? 'pydocs--menu' : ''}`} data-theme={dark ? 'dark' : 'light'} onClick={deadLinks}>
      {/* ── Header bar ── */}
      <header className="pydocs-header">
        <button type="button" className="pydocs-menu" aria-label="Menu" aria-expanded={menu} aria-controls="pydocs-sidebar" onClick={() => setMenu(!menu)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <a className="pydocs-brand" href="#">Python</a>
        <select className="pydocs-select" defaultValue="3.12" aria-label="Python version">
          <option value="3.13">3.13</option>
          <option value="3.12">3.12.4</option>
          <option value="3.11">3.11</option>
          <option value="3.10">3.10</option>
          <option value="3.9">3.9</option>
        </select>
        <nav className="pydocs-crumbs" aria-label="Breadcrumbs">
          <a className="wide" href="#">3.12.4 Documentation</a>
          <span className="wide" aria-hidden="true">»</span>
          <a className="wide" href="#">The Python Standard Library</a>
          <span className="wide" aria-hidden="true">»</span>
          <span>Built-in Functions</span>
        </nav>
        <div className="pydocs-tools">
          <ThemeSelect theme={theme} setTheme={setTheme} />
          <Search query={query} setQuery={setQuery} onSubmit={search} />
        </div>
      </header>

      <div className="pydocs-layout">
        {/* ── Sidebar (a slide-in menu on phones) ── */}
        <aside id="pydocs-sidebar" className="pydocs-sidebar" aria-label="Contents">
          <div className="pydocs-drawer-tools">
            <Search query={query} setQuery={setQuery} onSubmit={search} />
            <ThemeSelect theme={theme} setTheme={setTheme} />
          </div>
          <h3>Table of Contents</h3>
          <ul>
            <li>
              <a href="#pydocs-top" onClick={(e) => jump(e, 'pydocs-top')}>Built-in Functions</a>
              <ul>
                {ENTRIES.map(({ name }) => (
                  <li key={name}>
                    <a href={`#${name}`} onClick={(e) => jump(e, name)}><code>{name}()</code></a>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
          <h3>Previous topic</h3>
          <p><a href="#">Introduction</a></p>
          <h3>Next topic</h3>
          <p><a href="#">Built-in Constants</a></p>
          <h3>This Page</h3>
          <ul>
            <li><a href="#">Report a Bug</a></li>
            <li><a href="#">Show Source</a></li>
          </ul>
          <h3>The Python Standard Library</h3>
          <ul>
            {LIBRARY.map((t) => <li key={t}><a href="#">{t}</a></li>)}
          </ul>
        </aside>
        {menu && <button type="button" className="pydocs-scrim" aria-label="Close menu" onClick={() => setMenu(false)} />}

        {/* ── Main content ── */}
        <main className="pydocs-main" id="pydocs-top">
          <h1>
            Built-in Functions
            <a className="pydocs-permalink" href="#pydocs-top" onClick={(e) => jump(e, 'pydocs-top')} aria-label="Link to this heading">¶</a>
          </h1>
          <p>The Python interpreter has a number of functions and types built into it that are always available. They are listed here in alphabetical order.</p>

          <div id="pydocs-index">
            {q && (
              <p className="pydocs-results" role="status">
                {hits.length ? `Search results for “${query.trim()}”` : 'Your search did not match any documents.'}
              </p>
            )}
            <ul className="pydocs-index">
              {hits.map((n) => (
                <li key={n}>
                  <a href={DOCUMENTED.has(n) ? `#${n}` : '#'} onClick={DOCUMENTED.has(n) ? (e) => jump(e, n) : undefined}>{n}()</a>
                </li>
              ))}
            </ul>
          </div>

          {ENTRIES.map(({ name, sigs, body }) => (
            <dl className="pydocs-entry" key={name}>
              {sigs.map((params, i) => <Sig key={i} name={name} params={params} anchor={i === 0} onJump={jump} />)}
              <dd>{body}</dd>
            </dl>
          ))}

          {/* sentinel for IntersectionObserver */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {/* ── prev / next navigation ── */}
          <nav className="pydocs-pager" aria-label="Previous and next">
            <a href="#"><small>Previous</small>« Introduction</a>
            <a href="#"><small>Next</small>Built-in Constants »</a>
          </nav>
        </main>
      </div>

      {/* ── Hidden footer — appears after scrolling to bottom ── */}
      <footer className={`pydocs-footer ${footerVisible ? 'pydocs-footer--visible' : ''}`}>
        <div className="pydocs-footer-clip">
          <div className="pydocs-footer-row">
            <span>
              © Copyright 2001–2024, Python Software Foundation. | <a href="#">Docs</a> | <a href="#">Bugs</a> | <a href="#">Privacy Policy</a>
            </span>
            <form className={`pydocs-secret-form ${shake ? 'pydocs-secret-form--shake' : ''}`} onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                className="pydocs-secret-input"
                type="email"
                placeholder="Newsletter email…"
                aria-label="Newsletter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
              <button className="pydocs-secret-btn" type="submit">Subscribe</button>
            </form>
          </div>
        </div>
      </footer>
    </div>
  )
}
