/** @jsxImportSource @opentui/solid */
/**
 * A collapsible, non-modal sessions rail on the left of the TUI. The host's
 * `app` slot is an overlay, not a layout wrapper: it cannot reserve width in
 * the home/session routes. The rail therefore covers the left edge while open.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Session } from "@opencode-ai/sdk/v2"
import { batch, createEffect, createRoot, createSignal, Show } from "solid-js"
import { createSessionList } from "./session-list"
import { SessionRail } from "./session-rail"

type Options = {
  enabled?: boolean
  openKey?: string
  closeKey?: string
  requireEmptyPrompt?: boolean
  scope?: "project" | "all"
  limit?: number
  showStatus?: boolean
}

type Resolved = {
  openKey: string
  closeKey: string
  requireEmptyPrompt: boolean
  scope: "project" | "all"
  limit: number
  showStatus: boolean
}

type Editor = { plainText?: string; blur: () => void; focus: () => void; isDestroyed?: boolean }

const command = {
  toggle: "session.panel.toggle",
  close: "session.panel.close",
  next: "session.panel.next",
  previous: "session.panel.previous",
  select: "session.panel.select",
  backspace: "session.panel.backspace",
  clear: "session.panel.clear",
}

function pick(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback
}

function resolve(input: Options | undefined): Resolved {
  return {
    openKey: pick(input?.openKey, "left"),
    closeKey: pick(input?.closeKey, "right"),
    requireEmptyPrompt: input?.requireEmptyPrompt !== false,
    scope: input?.scope === "all" ? "all" : "project",
    limit: typeof input?.limit === "number" && Number.isFinite(input.limit) && input.limit > 0 ? Math.max(1, Math.floor(input.limit)) : 50,
    showStatus: input?.showStatus !== false,
  }
}

function currentID(api: TuiPluginApi): string | undefined {
  const route = api.route.current
  if (route.name !== "session") return
  const params = route.params as { sessionID?: unknown } | undefined
  return typeof params?.sessionID === "string" ? params.sessionID : undefined
}

const tui: TuiPlugin = async (api, options) => {
  const input = resolve(options as Options | undefined)
  if ((options as Options | undefined)?.enabled === false) return

  const [open, setOpen] = createSignal(false)
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [loading, setLoading] = createSignal(false)
  const [revision, setRevision] = createSignal(0)
  let editor: Editor | undefined
  let request = 0
  let disposed = false
  let statusQueued = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  const validRoute = () => api.route.current.name === "home" || api.route.current.name === "session"
  const { list, dispose: disposeList } = createRoot((dispose) => ({
    dispose,
    list: createSessionList(sessions, () => currentID(api), (id) => {
      if (!input.showStatus) return
      revision()
      const value = api.state.session.status(id)?.type
      return value === "retry" ? "retrying" : value === "busy" ? "running" : undefined
    }),
  }))

  const refresh = async () => {
    const generation = ++request
    try {
      // The SDK rewrites its configured directory header into GET queries.
      // An explicit empty directory prevents that injection; the global
      // handler treats an empty directory as no directory filter.
      const response = await (input.scope === "all"
        ? api.client.experimental.session.list({ directory: "", roots: true, limit: input.limit })
        : api.client.session.list({ roots: true, limit: input.limit, scope: "project" }))
      if (disposed || !open() || generation !== request) return
      if (response.error) throw response.error
      batch(() => {
        setSessions(response.data ?? [])
        list.reconcile()
      })
    } catch {
      if (!disposed && open() && generation === request) api.ui.toast({ variant: "error", message: "Unable to load sessions" })
    } finally {
      if (!disposed && open() && generation === request) setLoading(false)
    }
  }

  const scheduleRefresh = () => {
    if (!open() || disposed) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      void refresh()
    }, 100)
  }

  const restore = () => {
    const value = editor
    editor = undefined
    if (value && !value.isDestroyed && !api.renderer.isDestroyed && !api.ui.dialog.open) value.focus()
  }

  const close = (refocus = true) => {
    // A response started by this opening must not update a later opening (or
    // surface an error after the rail is gone). A pending debounce is likewise
    // owned by this opening, not by the plugin's lifetime.
    request++
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = undefined
    setOpen(false)
    if (refocus) restore()
    else editor = undefined
  }

  const toggle = () => {
    if (open()) return close()
    if (!validRoute() || api.ui.dialog.open) return
    editor = api.renderer.currentFocusedEditor as Editor | null ?? undefined
    editor?.blur()
    batch(() => {
      if (input.showStatus) setRevision((value) => value + 1)
      list.reset()
      setLoading(true)
      setOpen(true)
    })
    void refresh()
  }

  const switchTo = (id: string) => {
    if (!list.has(id)) return
    const same = id === currentID(api)
    if (!same) api.route.navigate("session", { sessionID: id })
    close(same)
  }

  // The rail is not an editor: only take plain printable characters while it
  // owns keyboard focus. Leave modifier shortcuts, dialogs and prompt input to
  // the host. Named/navigation keys continue through the guarded keymap layer.
  const onKey = (key: import("@opentui/core").KeyEvent) => {
    if (!open() || !validRoute() || api.ui.dialog.open || api.renderer.currentFocusedEditor ||
      key.eventType === "release" || key.ctrl || key.meta || key.option || key.super || key.hyper ||
      key.defaultPrevented || key.propagationStopped) return
    if ((key.name !== "space" && [...key.name].length !== 1) || [...key.sequence].length !== 1 || /\p{C}/u.test(key.sequence)) return
    key.preventDefault()
    list.edit(list.query() + key.sequence)
  }
  api.renderer.keyInput.on("keypress", onKey)

  // The app slot cannot change the host's flex layout. It can, however, mount
  // a left-aligned, non-modal overlay that leaves the prompt and dialogs intact.
  api.slots.register({
    slots: {
      app() {
        // The app slot remains mounted across host routes. Observe the host's
        // reactive route here, not only in Show, so a hidden rail is closed.
        createEffect(() => {
          if (open() && !validRoute()) close(false)
        })
        return (
          <Show when={open() && validRoute()} fallback={null}>
            <SessionRail
              list={list}
              palette={{
                panel: api.theme.current.backgroundPanel, raised: api.theme.current.backgroundElement,
                border: api.theme.current.border, text: api.theme.current.text, muted: api.theme.current.textMuted,
                accent: api.theme.current.accent, running: api.theme.current.success, retrying: api.theme.current.warning,
              }}
              loading={loading()} switchTo={switchTo} close={() => close()} />
          </Show>
        )
      },
      home_prompt_right() {
        return <text fg={api.theme.current.accent} onMouseUp={toggle}>{open() ? "[Sessions ◀]" : "[Sessions ▶]"}</text>
      },
      session_prompt_right() {
        return <text fg={api.theme.current.accent} onMouseUp={toggle}>{open() ? "[Sessions ◀]" : "[Sessions ▶]"}</text>
      },
    },
  })

  api.keymap.registerLayer({
    commands: [{ name: command.toggle, title: "Toggle sessions panel", category: "Session", namespace: "palette", slashName: "sessions-panel", run: toggle }],
  })
  api.keymap.registerLayer({
    mode: "base",
    priority: 10,
    enabled: () => validRoute() && !open() && !api.ui.dialog.open &&
      (!input.requireEmptyPrompt || api.renderer.currentFocusedEditor?.plainText === ""),
    bindings: [{ key: input.openKey, cmd: command.toggle, desc: "Open sessions panel" }],
  })
  api.keymap.registerLayer({
    mode: "base",
    priority: 30,
    enabled: () => open() && validRoute() && !api.ui.dialog.open && !api.renderer.currentFocusedEditor,
    commands: [
      { name: command.close, title: "Close sessions panel", run: () => close() },
      { name: command.next, title: "Next session", run: () => list.step(1) },
      { name: command.previous, title: "Previous session", run: () => list.step(-1) },
      { name: command.select, title: "Switch session", run: () => { const id = list.selected(); if (id) switchTo(id) } },
      { name: command.backspace, title: "Erase search character", run: () => list.edit([...list.query()].slice(0, -1).join("")) },
      { name: command.clear, title: "Clear session search", run: () => list.edit("") },
    ],
    bindings: [
      { key: input.closeKey, cmd: command.close },
      { key: "escape", cmd: command.close },
      { key: "up", cmd: command.previous },
      { key: "down", cmd: command.next },
      { key: "enter", cmd: command.select },
      { key: "backspace", cmd: command.backspace },
      { key: "ctrl+u", cmd: command.clear },
    ],
  })

  const off = [
    api.event.on("session.created", scheduleRefresh),
    api.event.on("session.updated", scheduleRefresh),
    api.event.on("session.deleted", scheduleRefresh),
    ...(input.showStatus ? [api.event.on("session.status", () => {
      if (!open() || statusQueued) return
      statusQueued = true
      queueMicrotask(() => {
        statusQueued = false
        if (!disposed && open()) setRevision((value) => value + 1)
      })
    })] : []),
  ]
  // A click on the uncovered prompt gives its editor focus. Close the rail
  // without refocusing the previously captured editor or stealing that click.
  const onEditorFocus = (current: unknown) => {
    if (current && open()) close(false)
  }
  api.renderer.on("focused_editor", onEditorFocus)
  api.lifecycle.onDispose(() => {
    disposed = true
    off.forEach((unsubscribe) => unsubscribe())
    api.renderer.off("focused_editor", onEditorFocus)
    api.renderer.keyInput.off("keypress", onKey)
    close(!api.renderer.isDestroyed)
    disposeList()
  })
}

const plugin: TuiPluginModule & { id: string } = { id: "session-sidebar", tui }
export default plugin
