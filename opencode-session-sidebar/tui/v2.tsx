/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import type { SessionInfo } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"

type Options = {
  enabled?: boolean
  openKey?: string
  closeKey?: string
  requireEmptyPrompt?: boolean
  scope?: "project" | "all"
  limit?: number
  showStatus?: boolean
}
type Settings = Required<Omit<Options, "openKey">> & { openKey?: string }
type Item = { session: SessionInfo; category: string; status?: "running" | "retrying" }
const name = "session-sidebar.sessions"
const commands = {
  toggle: `${name}.toggle`, close: `${name}.close`, next: `${name}.next`,
  previous: `${name}.previous`, select: `${name}.select`, backspace: `${name}.backspace`, clear: `${name}.clear`,
}

function key(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback
}
function options(value: Options): Settings {
  return {
    enabled: value.enabled !== false,
    openKey: typeof value.openKey === "string" && value.openKey.trim() ? value.openKey : undefined,
    closeKey: key(value.closeKey, "right"),
    requireEmptyPrompt: value.requireEmptyPrompt !== false,
    scope: value.scope === "all" ? "all" : "project",
    limit: typeof value.limit === "number" && Number.isFinite(value.limit) && value.limit > 0 ? Math.max(1, Math.floor(value.limit)) : 50,
    showStatus: value.showStatus !== false,
  }
}
function dayLabel(updated: number) {
  const date = new Date(updated)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toDateString()
}
function relativeTime(updated: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - updated) / 60_000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

function Sessions(props: { sessionID: string; settings: Settings; close: () => void }) {
  const ctx = usePlugin()
  const dimensions = useTerminalDimensions()
  const [sessions, setSessions] = createSignal<SessionInfo[]>([])
  const [selected, setSelected] = createSignal<string | undefined>(props.sessionID)
  const [query, setQuery] = createSignal("")
  const [statuses, setStatuses] = createSignal<Record<string, "running" | "retrying" | undefined>>({})
  let request = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const items = createMemo(() => {
    const list = [...sessions()].sort((a, b) => b.time.updated - a.time.updated)
    const seen = new Set<string>()
    const result: Item[] = []
    const status = (session: SessionInfo): Item["status"] => {
      if (!props.settings.showStatus) return
      return statuses()[session.id] ?? (ctx.data.session.status(session.id) === "running" ? "running" : undefined)
    }
    const add = (session: SessionInfo, category: string) => {
      if (session.parentID || seen.has(session.id)) return
      seen.add(session.id)
      result.push({ session, category, status: status(session) })
    }
    const current = list.find((session) => session.id === props.sessionID)
    if (current) add(current, "Current")
    for (const session of list) if (status(session)) add(session, "Running")
    for (const session of list) add(session, dayLabel(session.time.updated))
    const needle = query().toLocaleLowerCase()
    return needle ? result.filter((item) => item.session.title?.toLocaleLowerCase().includes(needle)) : result
  })
  const reconcile = () => {
    if (!items().some((item) => item.session.id === selected())) setSelected(items()[0]?.session.id)
  }
  const edit = (text: string) => { setQuery(text); reconcile() }
  const project = createMemo(() => props.settings.scope === "project"
    ? ctx.data.session.get(props.sessionID)?.projectID
    : undefined)
  const refresh = async () => {
    const generation = ++request
    const projectID = project()
    // Wait for the host cache instead of issuing an unscoped list request.
    if (props.settings.scope === "project" && !projectID) return
    try {
      const response = await ctx.client.session.list({
        limit: props.settings.limit, parentID: null,
        ...(projectID ? { project: projectID } : {}),
      })
      if (disposed || generation !== request) return
      setSessions(response.data)
      reconcile()
    } catch {
      if (!disposed && generation === request) ctx.ui.toast.show({ variant: "error", message: "Unable to load sessions" })
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void refresh() }, 100)
  }
  createEffect(on(project, () => {
    setSessions([])
    void refresh()
  }))
  const close = () => props.close()
  const switchTo = (id: string) => {
    if (!items().some((item) => item.session.id === id)) return
    close()
    if (id !== props.sessionID) ctx.ui.router.navigate({ type: "session", sessionID: id })
  }
  const step = (direction: number) => {
    const list = items()
    if (!list.length) return
    const index = list.findIndex((item) => item.session.id === selected())
    setSelected(list[index < 0 ? 0 : (index + direction + list.length) % list.length]!.session.id)
  }
  ctx.keymap.layer(() => ({
    priority: 30,
    commands: [
      { id: commands.close, bind: props.settings.closeKey, run: close },
      { bind: "escape", run: close },
      { id: commands.next, bind: "down", run: () => step(1) },
      { id: commands.previous, bind: "up", run: () => step(-1) },
      { id: commands.select, bind: "enter", run: () => { const id = selected(); if (id) switchTo(id) } },
      { id: commands.backspace, bind: "backspace", run: () => edit([...query()].slice(0, -1).join("")) },
      { id: commands.clear, bind: "ctrl+u", run: () => edit("") },
    ],
  }))
  const onKey = (event: import("@opentui/core").KeyEvent) => {
    if (event.eventType === "release" || event.ctrl || event.meta || event.option || event.super || event.hyper ||
      event.defaultPrevented || event.propagationStopped ||
      (event.name !== "space" && [...event.name].length !== 1) || [...event.sequence].length !== 1 || /\p{C}/u.test(event.sequence)) return
    event.preventDefault()
    edit(query() + event.sequence)
  }
  onMount(() => ctx.renderer.keyInput.on("keypress", onKey))
  const off = [
    ctx.data.on("session.created", schedule),
    ctx.data.on("session.renamed", schedule),
    ctx.data.on("session.metadata.updated", schedule),
    ctx.data.on("session.deleted", schedule),
    ctx.data.on("session.status", (event) => {
      const value = event.data.status.type
      setStatuses((previous) => ({ ...previous, [event.data.sessionID]: value === "retry" ? "retrying" : value === "busy" ? "running" : undefined }))
    }),
  ]
  onCleanup(() => {
    disposed = true
    request++
    if (timer) clearTimeout(timer)
    off.forEach((stop) => stop())
    ctx.renderer.keyInput.off("keypress", onKey)
  })
  const width = () => Math.min(36, Math.max(4, dimensions().width - 2))
  const compact = () => width() < 12
  const searchBox = () => width() >= 30 && dimensions().height >= 12
  const rows = () => Math.max(1, Math.floor((dimensions().height - 7 - (searchBox() ? 2 : 0)) / 3))
  const window = () => {
    const list = items()
    const index = Math.max(0, list.findIndex((item) => item.session.id === selected()))
    const start = Math.min(Math.max(0, index - Math.floor(rows() / 2)), Math.max(0, list.length - rows()))
    return { items: list.slice(start, start + rows()), start, more: list.length - start - rows() }
  }
  const theme = ctx.theme
  return <box position="absolute" top={0} bottom={0} left={0} width={width()} zIndex={1500}
    flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor={theme.background.raised.base}
    border={["right"]} borderColor={theme.border.base}>
    <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
      <text fg={theme.text.base} wrapMode="none">{compact() ? "S" : "Sessions"}</text>
      <text fg={theme.text.muted} onMouseUp={close}>×</text>
    </box>
    <Show when={searchBox()} fallback={<text fg={theme.text.action.primary.base} flexShrink={0} wrapMode="none">{compact() ? "/" : "Search: "}{query() || (compact() ? "" : "type to filter")}</text>}>
      <box height={3} flexShrink={0} border borderStyle="heavy" borderColor={theme.border.base} backgroundColor={theme.background.raised.high} paddingLeft={1} paddingRight={1}>
        <text fg={theme.text.base} wrapMode="none"><b>Search: {query() || "type to filter"}</b></text>
      </box>
    </Show>
    <Show when={width() >= 20}><text fg={theme.text.muted} flexShrink={0} wrapMode="none">↑↓ · Enter · Esc</text></Show>
    <text fg={theme.text.muted} flexShrink={0}>{window().start > 0 ? `↑ ${window().start} more` : " "}</text>
    <For each={window().items}>{(item) => <box flexDirection="column" flexShrink={0}
      backgroundColor={item.session.id === selected() ? theme.background.raised.high : theme.background.raised.base}
      onMouseDown={() => setSelected(item.session.id)} onMouseUp={() => switchTo(item.session.id)}>
      <text fg={theme.text.muted} wrapMode="none">{item.category}</text>
      <text fg={item.session.id === selected() ? theme.text.action.primary.base : theme.text.base} wrapMode="none">{item.session.id === selected() ? "▸ " : "  "}{item.session.title ?? "Untitled"}</text>
      <text fg={item.status ? theme.text.feedback.success.base : theme.text.muted} wrapMode="none">{item.session.id === props.sessionID ? "current · " : ""}{item.status ?? ""}{item.status ? " · " : ""}{relativeTime(item.session.time.updated)}</text>
    </box>}</For>
    <text fg={theme.text.muted} flexShrink={0}>{window().more > 0 ? `↓ ${window().more} more` : " "}</text>
    <text fg={theme.text.muted} wrapMode="none">{items().length === 0 ? query() && sessions().length ? "No matches" : "No sessions" : " "}</text>
  </box>
}

export default Plugin.define({
  id: "session-sidebar",
  setup(ctx) {
    const settings = options(ctx.options)
    if (!settings.enabled) return
    const [openSession, setOpenSession] = createSignal<string>()
    let editor: typeof ctx.renderer.currentFocusedEditor = null
    const route = () => ctx.ui.router.current()
    const close = (restore = true) => {
      setOpenSession(undefined)
      const previous = editor
      editor = null
      if (restore && previous && !previous.isDestroyed && !ctx.renderer.isDestroyed) previous.focus()
    }
    const toggle = () => {
      if (openSession()) return close()
      const current = route()
      if (current.type !== "session") return
      editor = ctx.renderer.currentFocusedEditor
      editor?.blur()
      setOpenSession(current.sessionID)
    }
    const stops = [
      ctx.ui.slot({ append: "prompt.footer.status", render: () => <Show when={route().type === "session"}><text fg={ctx.theme.text.action.primary.base} onMouseUp={toggle}>[Sessions]</text></Show> }),
      ctx.ui.slot({ append: "app", render: () => {
        const visibleSession = () => {
          const current = route()
          return current.type === "session" && current.sessionID === openSession() ? current.sessionID : undefined
        }
        createEffect(() => { if (openSession() && !visibleSession()) close(false) })
        ctx.keymap.layer(() => ({ mode: "global", commands: [{ id: commands.toggle, title: "Toggle sessions panel", group: "Session", palette: true,
          slash: { name: "sessions-panel" }, run: toggle }] }))
        if (settings.openKey) ctx.keymap.layer(() => ({ mode: "global", priority: 10, enabled: () =>
          route().type === "session" && !openSession() &&
          (!settings.requireEmptyPrompt || ctx.renderer.currentFocusedEditor?.plainText === ""),
          commands: [{ bind: settings.openKey, run: toggle }],
        }))
        return <Show when={visibleSession()} keyed>
          {(sessionID) => <Sessions sessionID={sessionID} settings={settings} close={close} />}
        </Show>
      } }),
    ]
    return () => { close(false); stops.forEach((stop) => stop()) }
  },
})
