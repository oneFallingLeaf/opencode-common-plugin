// Keep this module .tsx so OpenTUI's plugin loader shares the host Solid runtime.
import { batch, createMemo, createSignal, type Accessor } from "solid-js"

export type SessionStatus = "running" | "retrying"
type Session = { id: string; parentID?: string | null; title?: string | null; time: { updated: number } }
type IndexedSession = { id: string; title: string; updated: number; search: string }
export type SessionRow = IndexedSession & { current: boolean; status?: SessionStatus }

export function createSessionList(
  sessions: Accessor<readonly Session[]>,
  currentID: Accessor<string | undefined>,
  status: (id: string) => SessionStatus | undefined,
) {
  const [query, setQuery] = createSignal("")
  const [selected, select] = createSignal<string>()
  // Sorting and title normalization run only when the fetched list changes.
  const indexed = createMemo(() => {
    const seen = new Set<string>()
    return [...sessions()].sort((a, b) => b.time.updated - a.time.updated).flatMap((session) => {
      if (session.parentID || seen.has(session.id)) return []
      seen.add(session.id)
      const title = session.title?.replace(/[\r\n\t]/g, " ").trim() || "Untitled"
      return { id: session.id, title, search: title.toLocaleLowerCase(), updated: session.time.updated }
    })
  })
  const ordered = createMemo(() => {
    const currentIDValue = currentID()
    let current: SessionRow | undefined
    const active: SessionRow[] = []
    const recent: SessionRow[] = []
    for (const entry of indexed()) {
      const row = { ...entry, current: entry.id === currentIDValue, status: status(entry.id) }
      if (row.current) current = row
      else if (row.status) active.push(row)
      else recent.push(row)
    }
    return current ? [current, ...active, ...recent] : active.concat(recent)
  })
  const results = createMemo(() => {
    const needle = query().toLocaleLowerCase()
    const rows = needle ? ordered().filter((row) => row.search.includes(needle)) : ordered()
    const index = new Map<string, number>()
    rows.forEach((row, i) => index.set(row.id, i))
    return { rows, index }
  })
  const selectedIndex = createMemo(() => results().index.get(selected() ?? "") ?? -1)
  const reconcile = () => {
    if (selectedIndex() < 0) select(results().rows[0]?.id)
  }
  const edit = (value: string) => batch(() => { setQuery(value); reconcile() })
  const reset = (preferredID = currentID()) => batch(() => {
    setQuery("")
    select(preferredID ?? results().rows[0]?.id)
  })
  const step = (direction: -1 | 1, wrap = true) => {
    const { rows } = results()
    if (!rows.length) return
    const index = selectedIndex()
    const next = index + direction
    const target = index < 0 ? 0 : wrap ? (next + rows.length) % rows.length : Math.max(0, Math.min(rows.length - 1, next))
    select(rows[target]?.id)
  }
  const has = (id: string) => results().index.has(id)

  return { results, hasSessions: () => indexed().length > 0, query, selected, selectedIndex, reconcile, edit, reset, select, step, has }
}
export type SessionList = ReturnType<typeof createSessionList>
