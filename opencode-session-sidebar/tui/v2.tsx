/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { SessionInfo, SessionListInput } from "@opencode/client"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { createSessionList, type SessionStatus } from "./session-list"
import { SessionRail } from "./session-rail"

type Options = {
  enabled?: boolean
  openKey?: string
  closeKey?: string
  requireEmptyPrompt?: boolean
  scope?: Scope
  limit?: number
  showStatus?: boolean
}
type Settings = Required<Omit<Options, "openKey">> & { openKey?: string }
const name = "session-sidebar.sessions"
const homeTarget = Symbol("home")
type Target = string | typeof homeTarget
type Scope = "folder" | "project" | "all"
type ListScope = Pick<SessionListInput, "project" | "directory">
const commands = {
  toggle: `${name}.toggle`, close: `${name}.close`, scope: `${name}.scope`, next: `${name}.next`,
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
    scope: value.scope === "all" || value.scope === "folder" ? value.scope : "project",
    limit: typeof value.limit === "number" && Number.isFinite(value.limit) && value.limit > 0 ? Math.max(1, Math.floor(value.limit)) : 50,
    showStatus: value.showStatus !== false,
  }
}
function Sessions(props: {
  sessionID?: string
  scope: Scope
  toggleScope: () => void
  settings: Settings
  close: () => void
}) {
  const ctx = usePlugin()
  const [sessions, setSessions] = createSignal<SessionInfo[]>([])
  const [loading, setLoading] = createSignal(true)
  const [statuses, setStatuses] = createSignal<ReadonlyMap<string, SessionStatus | null>>(new Map())
  let request = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let homeScope: { directory: string; filters: Promise<ListScope> } | undefined
  const list = createSessionList(sessions, () => props.sessionID, (id) => {
    if (!props.settings.showStatus) return
    const observed = statuses().get(id)
    if (observed !== undefined) return observed ?? undefined
    return ctx.data.session.status(id) === "running" ? "running" : undefined
  })
  list.reset()
  const currentSession = () => props.sessionID ? ctx.data.session.get(props.sessionID) : undefined
  const project = createMemo(() => props.scope === "project" ? currentSession()?.projectID : undefined)
  const directory = createMemo(() => {
    if (props.scope === "all") return
    if (props.sessionID) return props.scope === "folder" ? currentSession()?.location.directory : undefined
    return (ctx.location ?? ctx.data.location.default()).directory
  })
  const resolveHomeScope = (directory: string): Promise<ListScope> => {
    if (homeScope?.directory === directory) return homeScope.filters
    const filters = ctx.client.location.get({ location: { directory } }).then((current) =>
      // Non-Git locations share the global project; keep Home scoped to its directory.
      current.project.id === "global" ? { directory: current.directory } : { project: current.project.id },
    ).catch((error) => {
      if (homeScope?.filters === filters) homeScope = undefined
      throw error
    })
    homeScope = { directory, filters }
    return filters
  }
  const refresh = async () => {
    const generation = ++request
    try {
      let filters: ListScope = {}
      if (props.scope === "folder") {
        const path = directory()
        if (!path) return
        filters = { directory: path }
      } else if (props.scope === "project") {
        if (props.sessionID) {
          const projectID = project()
          if (!projectID) return
          filters = { project: projectID }
        } else {
          const path = directory()
          if (!path) return
          filters = await resolveHomeScope(path)
        }
      }
      // Never use results from a previous scope or a panel that has closed.
      if (disposed || generation !== request) return
      const response = await ctx.client.session.list({ limit: props.settings.limit, parentID: null, ...filters })
      if (disposed || generation !== request) return
      batch(() => {
        setSessions(response.data)
        list.reconcile()
      })
    } catch {
      if (!disposed && generation === request) ctx.ui.toast.show({ variant: "error", message: "Unable to load sessions" })
    } finally {
      if (!disposed && generation === request) setLoading(false)
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void refresh() }, 100)
  }
  createEffect(on([() => props.scope, project, directory], () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    batch(() => {
      setLoading(true)
      setSessions([])
    })
    void refresh()
  }))
  const close = () => props.close()
  const switchTo = (id: string) => {
    if (!list.has(id)) return
    close()
    if (id !== props.sessionID) ctx.ui.router.navigate({ type: "session", sessionID: id })
  }
  ctx.keymap.layer(() => ({
    priority: 30,
    commands: [
      { id: commands.close, bind: props.settings.closeKey, run: close },
      { bind: "escape", run: close },
      { id: commands.scope, bind: "tab", run: props.toggleScope },
      { id: commands.next, bind: "down", run: () => list.step(1) },
      { id: commands.previous, bind: "up", run: () => list.step(-1) },
      { id: commands.select, bind: "enter", run: () => { const id = list.selected(); if (id) switchTo(id) } },
      { id: commands.backspace, bind: "backspace", run: () => list.edit([...list.query()].slice(0, -1).join("")) },
      { id: commands.clear, bind: "ctrl+u", run: () => list.edit("") },
    ],
  }))
  const onKey = (event: import("@opentui/core").KeyEvent) => {
    if (event.eventType === "release" || event.ctrl || event.meta || event.option || event.super || event.hyper ||
      event.defaultPrevented || event.propagationStopped ||
      (event.name !== "space" && [...event.name].length !== 1) || [...event.sequence].length !== 1 || /\p{C}/u.test(event.sequence)) return
    event.preventDefault()
    list.edit(list.query() + event.sequence)
  }
  onMount(() => ctx.renderer.keyInput.on("keypress", onKey))
  const off = [
    ctx.data.on("session.created", schedule),
    ctx.data.on("session.renamed", schedule),
    ctx.data.on("session.metadata.updated", schedule),
    ctx.data.on("session.deleted", schedule),
    ...(props.settings.showStatus ? [ctx.data.on("session.status", ({ data }) => {
      const value = data.status.type
      const status = value === "retry" ? "retrying" : value === "busy" ? "running" : null
      setStatuses((previous) => previous.get(data.sessionID) === status
        ? previous : new Map(previous).set(data.sessionID, status))
    })] : []),
  ]
  onCleanup(() => {
    disposed = true
    request++
    if (timer) clearTimeout(timer)
    off.forEach((stop) => stop())
    ctx.renderer.keyInput.off("keypress", onKey)
  })
  const theme = ctx.theme
  return <SessionRail list={list} loading={loading()} switchTo={switchTo} close={close}
    scopeLabel={props.scope === "all" ? "All" : props.scope === "folder" ? "Folder" : "Project"} toggleScope={props.toggleScope}
    palette={{
      panel: theme.background.raised.base, raised: theme.background.raised.high,
      border: theme.border.base, text: theme.text.base, muted: theme.text.muted,
      accent: theme.text.action.primary.base, running: theme.text.feedback.success.base, retrying: theme.text.feedback.warning.base,
    }} />
}

export default Plugin.define({
  id: "session-sidebar",
  setup(ctx) {
    const settings = options(ctx.options)
    if (!settings.enabled) return
    const [openTarget, setOpenTarget] = createSignal<Target>()
    const [scope, setScope] = createSignal<Scope>(settings.scope)
    const localScope = settings.scope === "project" ? "project" : "folder"
    const toggleScope = () => setScope((current) => current === "all" ? localScope : "all")
    let editor: typeof ctx.renderer.currentFocusedEditor = null
    const target = (): Target | undefined => {
      const route = ctx.ui.router.current()
      if (route.type === "home") return homeTarget
      if (route.type === "session") return route.sessionID
    }
    const close = (restore = true) => {
      setOpenTarget(undefined)
      const previous = editor
      editor = null
      if (restore && previous && !previous.isDestroyed && !ctx.renderer.isDestroyed) previous.focus()
    }
    const toggle = () => {
      if (openTarget()) return close()
      const current = target()
      if (!current) return
      editor = ctx.renderer.currentFocusedEditor
      editor?.blur()
      setOpenTarget(current)
    }
    const button = () => <text fg={ctx.theme.text.action.primary.base} selectable={false} onMouseUp={toggle}>[Sessions]</text>
    const stops = [
      ctx.ui.slot({ append: "home.footer.status", render: button }),
      ctx.ui.slot({ append: "prompt.footer.status", render: () => <Show when={typeof target() === "string"}>{button()}</Show> }),
      ctx.ui.slot({ append: "app", render: () => {
        const visibleTarget = () => openTarget() === target() ? openTarget() : undefined
        createEffect(() => { if (openTarget() && !visibleTarget()) close(false) })
        ctx.keymap.layer(() => ({ mode: "global", commands: [{ id: commands.toggle, title: "Toggle sessions panel", group: "Session", palette: true,
          slash: { name: "sessions-panel" }, run: toggle }] }))
        if (settings.openKey) ctx.keymap.layer(() => ({ mode: "global", priority: 10, enabled: () =>
          target() !== undefined && !openTarget() &&
          (!settings.requireEmptyPrompt || ctx.renderer.currentFocusedEditor?.plainText === ""),
          commands: [{ bind: settings.openKey, run: toggle }],
        }))
        return <Show when={visibleTarget()} keyed>
          {(current) => <Sessions sessionID={typeof current === "string" ? current : undefined}
            scope={scope()} toggleScope={toggleScope} settings={settings} close={close} />}
        </Show>
      } }),
    ]
    return () => { close(false); stops.forEach((stop) => stop()) }
  },
})
