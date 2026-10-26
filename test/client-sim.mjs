#!/usr/bin/env node
/**
 * Browser-free client bundle smoke test for the 0.2 workbench.
 *
 * Loads lib/client.js through a fake ModuleLoader, stubs React + locale/layout/
 * slots services, runs apply(), and asserts the registration model:
 *   - sidebar.panellist (only left-rail entry, id=devteam, order after schedule)
 *   - main (key=devteam full workbench)
 *   - conversation.input.dock (meeting banner)
 *   - NO right-sidebar tab registrations anymore
 *   - i18n dictionaries registered for zh + en
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'lib', 'client.js')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const code = readFileSync(CLIENT, 'utf8')
let captured
globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
// eslint-disable-next-line no-eval
eval(code)

check('bundle calls __ModuleLoader__.load once', captured !== undefined)
check('bundle id', captured?.id === 'dsh-agent-team-planner', String(captured?.id))

const React = {
  createElement: (...args) => ({ args }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}
const required = []
let loaded
try {
  const factory = captured.factory
  loaded = factory((id) => {
    required.push(id)
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  check('factory only requires react', required.length === 1 && required[0] === 'react', required.join(','))
  check('exports.apply is a function', typeof loaded.apply === 'function')
  check(
    'exports.inject declares slots/locale/layout',
    Array.isArray(loaded.inject) && ['slots', 'locale', 'layout'].every((name) => loaded.inject.includes(name)),
    JSON.stringify(loaded.inject),
  )
} catch (error) {
  check('factory loads', false, String(error))
}

const registrations = []
const dictionaries = []
let panelLabel = null
const ctx = {
  effect: (fn) => {
    try { fn() } catch { /* disposer throwing is acceptable in the stub */ }
    return () => {}
  },
  get: () => undefined,
  locale: {
    register: (ns, locale, dict) => {
      dictionaries.push({ ns, locale, keys: Object.keys(dict ?? {}).length })
      return () => {}
    },
    bind: () => (key) => (key === 'panel.label' ? 'dsh-agent-team-planner' : key),
    getLocale: () => ({ active: 'zh' }),
    subscribe: () => () => {},
    setLocale: () => {},
  },
  layout: { selectPanel: () => {} },
  slots: {
    inject: (name, fn) => {
      fn()
      return () => {}
    },
    register: (definition, component) => {
      registrations.push({
        name: definition.name,
        id: definition.id,
        key: definition.key,
        order: definition.order,
        locale: definition.locale,
        inject: definition.inject,
        component,
      })
      if (definition.name === 'sidebar.panellist') panelLabel = definition.label?.()
      return () => {}
    },
  },
}

try {
  loaded.apply(ctx)
  check('apply() runs without throwing', true)
} catch (error) {
  check('apply() runs without throwing', false, String(error))
}

check('i18n registers zh + en dictionaries', dictionaries.some((d) => d.locale === 'zh') && dictionaries.some((d) => d.locale === 'en'), JSON.stringify(dictionaries))
check('i18n dictionaries have keys', dictionaries.every((d) => d.keys > 50), JSON.stringify(dictionaries.map((d) => d.keys)))

const panellist = registrations.find((r) => r.name === 'sidebar.panellist')
const main = registrations.find((r) => r.name === 'main')
const dock = registrations.find((r) => r.name === 'conversation.input.dock')

check('registers exactly one panellist entry', registrations.filter((r) => r.name === 'sidebar.panellist').length === 1)
check('panellist id is devteam', panellist?.id === 'devteam' && panellist?.locale === 'devteam', `${panellist?.id}/${panellist?.locale}`)
check('panellist order after automation tasks (>=20)', typeof panellist?.order === 'number' && panellist.order >= 20, String(panellist?.order))
check('panellist label is dsh-agent-team-planner', panelLabel === 'dsh-agent-team-planner', String(panelLabel))
check('panellist icon renders an svg', panellist?.component?.({ size: 24 })?.args?.[0] === 'svg')
check('registers main panel keyed devteam', main?.key === 'devteam' && typeof main?.inject === 'function', String(main?.key))
check('main is a function component', typeof main?.component === 'function')
check('registers meeting dock banner', dock?.id === 'devteam-meeting' && dock?.order === 5 && typeof dock?.inject === 'function', `${dock?.id}/${dock?.order}/${typeof dock?.inject}`)
check('no right-sidebar tab registrations', registrations.every((r) => !String(r.name).startsWith('sidebar.right')), JSON.stringify(registrations.map((r) => r.name)))
check('no old TABS identifiers', !/sidebarRightTabs|TABS\b/.test(code))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
