/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { PluginContextProvider } from "@opencode/plugin/tui"
import type { Context, KeymapLayer, Route, SlotPath } from "@opencode/plugin/tui/context"
import type { SessionInfo } from "@opencode/client"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"
import plugin from "../tui/v2"

function session(id: string, updated: number, projectID = "project", parentID?: string): SessionInfo {
  return { id, projectID, parentID, title: `Session ${id}`, time: { created: updated, updated }, location: { directory: "/project" }, cost: 0, tokens: {} } as SessionInfo
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function harness(settings: Record<string, unknown> = {}, size = { width: 80, height: 24 }) {
  const screen = await createTestRenderer({ ...size })
  const slots = new Map<SlotPath, (input: any) => any>()
  const layers: Array<() => KeymapLayer> = []
  const listeners = new Map<string, Set<(event: any) => void>>()
  const requests: unknown[] = []
  const locations: unknown[] = []
  const replies: Array<Promise<{ data: SessionInfo[] }>> = []
  const navigations: string[] = []
  const toasts: string[] = []
  const [route, setRoute] = createSignal<Route>({ type: "session", sessionID: "active" })
  const [active, setActive] = createSignal<SessionInfo | undefined>(session("active", 2))
  let locate = async () => ({ directory: "/project", project: { id: "project" } })
  let list = [session("old", 1), session("active", 2)]
  let editorFocused = true
  let stops: (() => void) | void
  const editor = { plainText: "", blur: () => { editorFocused = false }, focus: () => { editorFocused = true } }
  Object.defineProperty(screen.renderer, "currentFocusedEditor", { configurable: true, get: () => editorFocused ? editor : null })
  const ctx = {
    options: settings,
    renderer: screen.renderer,
    theme: { background: { raised: { base: "#111111", high: "#333333" } }, border: { base: "#aaaaaa" }, text: { base: "#ffffff", muted: "#888888", action: { primary: { base: "#00aaff" } }, feedback: { success: { base: "#00ff00" }, warning: { base: "#ffcc00" } } } },
    client: {
      location: { get(input: unknown) { locations.push(input); return locate() } },
      session: { list(input: unknown) { requests.push(input); return replies.shift() ?? Promise.resolve({ data: list }) } },
    },
    data: {
      location: { default: () => ({ directory: "/project" }) },
      session: { get: (id: string) => id === "active" ? active() : list.find((s) => s.id === id), status: () => "idle" },
      on(name: string, callback: (event: any) => void) {
        const group = listeners.get(name) ?? new Set()
        group.add(callback); listeners.set(name, group)
        return () => group.delete(callback)
      } },
    ui: {
      slot(claim: { append: SlotPath; render: (input: any) => any }) { slots.set(claim.append, claim.render); return () => slots.delete(claim.append) },
      router: { current: route, navigate: (target: { sessionID: string }) => navigations.push(target.sessionID) },
      toast: { show: (toast: { message: string }) => toasts.push(toast.message) },
    },
    keymap: { layer(input: () => KeymapLayer) { layers.push(input) } },
  } as unknown as Context
  stops = await plugin.setup(ctx)
  async function mount() {
    await render(() => <PluginContextProvider value={ctx}>
      <box width={size.width} height={size.height}>
        {slots.get("app")?.({})}
      </box>
    </PluginContextProvider>, screen.renderer)
    await screen.renderOnce()
  }
  function run(id: string) {
    const found = layers.flatMap((layer) => layer().commands ?? []).find((cmd) => cmd.id === `session-sidebar.sessions.${id}`)
    if (!found) throw new Error(`Missing command ${id}`)
    void found.run()
  }
  return {
    screen, slots, layers, listeners, requests, locations, navigations, toasts, ctx, editor,
    mount, run, setRoute, setActive, setList(value: SessionInfo[]) { list = value },
    setLocate(value: typeof locate) { locate = value },
    enqueue(promise: Promise<{ data: SessionInfo[] }>) { replies.push(promise) },
    emit(name: string, data: unknown = {}) { listeners.get(name)?.forEach((listener) => listener({ data })) },
    get open() { return !editorFocused }, get focused() { return editorFocused },
    dispose() { stops?.(); screen.renderer.destroy() },
  }
}

test("default registers left overlay, footer and palette/slash command without a global open key", async () => {
  const h = await harness()
  try {
    expect(plugin.id).toBe("session-sidebar")
    expect([...h.slots.keys()].sort()).toEqual(["app", "home.footer.status", "prompt.footer.status"])
    await h.mount()
    expect(h.layers).toHaveLength(1) // palette/slash toggle; overlay controls mount on open
    expect(h.layers.flatMap((layer) => layer().commands ?? []).some((cmd) => cmd.bind === "left")).toBe(false)
    const toggle = h.layers.flatMap((layer) => layer().commands ?? []).find((cmd) => cmd.id === "session-sidebar.sessions.toggle")
    expect(toggle?.palette).toBe(true)
    expect(toggle?.slash).toEqual({ name: "sessions-panel" })
    h.run("toggle")
    expect(h.open).toBe(true)
    expect(h.requests).toEqual([{ limit: 50, parentID: null, project: "project" }])
    await Promise.resolve()
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("Session active")
    expect(h.screen.captureCharFrame()).toContain("Current")
    expect(h.screen.captureCharFrame().split("\n")[0]).toMatch(/^\s{0,2}Sessions/)
  } finally { h.dispose() }
})

test("project scope waits for the current session to sync before listing", async () => {
  const h = await harness()
  try {
    h.setActive(undefined)
    await h.mount()
    h.run("toggle")
    expect(h.requests).toEqual([])
    h.setActive(session("active", 2))
    await Promise.resolve()
    await h.screen.renderOnce()
    expect(h.requests).toEqual([{ limit: 50, parentID: null, project: "project" }])
    expect(h.screen.captureCharFrame()).toContain("Session active")
  } finally { h.dispose() }
})

test("changing sessions outside the overlay closes it and cleans up its listeners", async () => {
  const h = await harness()
  try {
    await h.mount()
    h.run("toggle")
    expect(h.listeners.get("session.created")?.size).toBe(1)
    h.setRoute({ type: "session", sessionID: "other" })
    await h.screen.renderOnce()
    expect(h.listeners.get("session.created")?.size).toBe(0)
    expect(h.screen.captureCharFrame()).not.toContain("Sessions")
  } finally { h.dispose() }
})

test("explicit left open key works on Home or a session only with an empty prompt and no panel", async () => {
  const h = await harness({ openKey: "left" })
  try {
    await h.mount()
    const openLayer = h.layers.find((layer) => layer().commands?.some((cmd) => cmd.bind === "left"))!
    expect((openLayer().enabled as () => boolean)()).toBe(true)
    h.editor.plainText = "draft"
    expect((openLayer().enabled as () => boolean)()).toBe(false)
    h.editor.plainText = ""
    h.run("toggle")
    expect((openLayer().enabled as () => boolean)()).toBe(false)
    h.run("toggle")
    h.setRoute({ type: "home" })
    expect((openLayer().enabled as () => boolean)()).toBe(true)
    h.editor.plainText = "new draft"
    expect((openLayer().enabled as () => boolean)()).toBe(false)
    h.editor.plainText = ""
    h.setRoute({ type: "plugin", id: "other", name: "other" })
    expect((openLayer().enabled as () => boolean)()).toBe(false)
  } finally { h.dispose() }
})

test("search filters titles, excludes subagents, navigates only matching sessions", async () => {
  const h = await harness()
  try {
    h.setList([session("old", 1), session("active", 2), session("old-child", 3, "project", "old")])
    await h.mount()
    h.run("toggle")
    await Promise.resolve()
    await h.screen.mockInput.typeText("OLD")
    await h.screen.renderOnce()
    const frame = h.screen.captureCharFrame()
    expect(frame).toContain("Search: OLD")
    expect(frame).toContain("Session old")
    expect(frame).not.toContain("Session active")
    expect(frame).not.toContain("Session old-child")
    h.run("select")
    expect(h.navigations).toEqual(["old"])
    expect(h.open).toBe(false)
  } finally { h.dispose() }
})

test("no matches makes Enter inert; backspace restores a selectable row", async () => {
  const h = await harness()
  try {
    await h.mount()
    h.run("toggle")
    await Promise.resolve()
    await h.screen.mockInput.typeText("z")
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("No matches")
    h.run("select")
    expect(h.navigations).toEqual([])
    h.run("backspace")
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("▸ Session active")
  } finally { h.dispose() }
})

test("status events update running/retrying markers and list events debounce", async () => {
  const h = await harness({ scope: "all", limit: 0.25 })
  try {
    await h.mount()
    h.run("toggle")
    expect(h.requests).toEqual([{ limit: 1, parentID: null }])
    h.emit("session.status", { sessionID: "old", status: { type: "busy" } })
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("running")
    h.emit("session.status", { sessionID: "old", status: { type: "retry" } })
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("retrying")
    h.emit("session.renamed")
    h.emit("session.created")
    await new Promise((resolve) => setTimeout(resolve, 130))
    expect(h.requests).toHaveLength(2)
  } finally { h.dispose() }
})

test("disabled plugin registers nothing", async () => {
  const h = await harness({ enabled: false })
  try { expect(h.slots.size).toBe(0); expect(h.layers).toHaveLength(0) } finally { h.dispose() }
})

test("Home opens a scoped session picker without a current session", async () => {
  const h = await harness()
  try {
    const location = deferred<{ directory: string; project: { id: string } }>()
    h.setLocate(() => location.promise)
    h.setActive(undefined)
    h.setRoute({ type: "home" })
    await h.mount()
    h.run("toggle")
    expect(h.open).toBe(true)
    expect(h.locations).toEqual([{ location: { directory: "/project" } }])
    expect(h.requests).toEqual([])
    location.resolve({ directory: "/project", project: { id: "project" } })
    await h.screen.renderOnce()
    expect(h.requests).toEqual([{ limit: 50, parentID: null, project: "project" }])
    expect(h.screen.captureCharFrame()).toContain("▸ Session active")
    expect(h.screen.captureCharFrame()).not.toContain("Current")
    h.run("select")
    expect(h.navigations).toEqual(["active"])
    expect(h.open).toBe(false)
  } finally { h.dispose() }
})

test("Home in a non-Git directory uses directory scope and closes after a route change", async () => {
  const h = await harness()
  try {
    h.setLocate(async () => ({ directory: "/plain", project: { id: "global" } }))
    h.setRoute({ type: "home" })
    await h.mount()
    h.run("toggle")
    await h.screen.renderOnce()
    expect(h.requests).toEqual([{ limit: 50, parentID: null, directory: "/plain" }])
    h.setRoute({ type: "session", sessionID: "active" })
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).not.toContain("Sessions")
    expect(h.listeners.get("session.created")?.size).toBe(0)
  } finally { h.dispose() }
})

test("Home with all-project scope does not need a location lookup", async () => {
  const h = await harness({ scope: "all" })
  try {
    h.setRoute({ type: "home" })
    await h.mount()
    h.run("toggle")
    await h.screen.renderOnce()
    expect(h.locations).toEqual([])
    expect(h.requests).toEqual([{ limit: 50, parentID: null }])
  } finally { h.dispose() }
})

test("Tab switches between Folder and All, keeps search, and discards stale results", async () => {
  const h = await harness({ scope: "folder" })
  const pending = deferred<{ data: SessionInfo[] }>()
  h.enqueue(pending.promise)
  try {
    h.setRoute({ type: "home" })
    await h.mount()
    h.run("toggle")
    const toggle = h.layers.flatMap((layer) => layer().commands ?? []).find((cmd) => cmd.id === "session-sidebar.sessions.scope")
    expect(toggle?.bind).toBe("tab")
    expect(h.requests).toEqual([{ limit: 50, parentID: null, directory: "/project" }])
    await h.screen.mockInput.typeText("match")
    h.setList([session("match-remote", 2), session("unrelated", 1)])
    h.run("scope")
    await h.screen.renderOnce()
    let frame = h.screen.captureCharFrame()
    expect(frame).toContain("All [Tab]")
    expect(frame).toContain("Search: match")
    expect(frame).toContain("Session match-remote")
    expect(frame).not.toContain("Session unrelated")

    pending.resolve({ data: [session("match-stale", 3)] })
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).not.toContain("Session match-stale")

    h.setList([session("match-local", 4)])
    const allX = frame.split("\n")[0]!.indexOf("All [Tab]")
    await h.screen.mockMouse.click(allX, 0)
    await h.screen.renderOnce()
    frame = h.screen.captureCharFrame()
    expect(frame).toContain("Folder [Tab]")
    expect(frame).toContain("Session match-local")
    expect(h.requests).toEqual([
      { limit: 50, parentID: null, directory: "/project" },
      { limit: 50, parentID: null },
      { limit: 50, parentID: null, directory: "/project" },
    ])
    expect(h.locations).toEqual([])
  } finally { h.dispose() }
})

test("unmount unsubscribes listeners and ignores late list results", async () => {
  const h = await harness()
  const pending = deferred<{ data: SessionInfo[] }>()
  h.enqueue(pending.promise)
  try {
    await h.mount()
    h.run("toggle")
    expect(h.listeners.get("session.status")?.size).toBe(1)
    h.dispose()
    pending.resolve({ data: [session("late", 5)] })
    await pending.promise
    await Promise.resolve()
    expect(h.toasts).toEqual([])
  } finally { /* renderer already destroyed */ }
})

test("custom keys, draft override and disabled status apply to V2 layers", async () => {
  const h = await harness({ openKey: "ctrl+g", closeKey: "ctrl+j", requireEmptyPrompt: false, showStatus: false })
  try {
    await h.mount()
    h.run("toggle")
    const open = h.layers.find((layer) => layer().commands?.some((cmd) => cmd.bind === "ctrl+g"))!
    h.editor.plainText = "keep this draft"
    expect((open().enabled as () => boolean)()).toBe(false)
    const close = h.layers.flatMap((layer) => layer().commands ?? []).find((cmd) => cmd.id === "session-sidebar.sessions.close")
    expect(close?.bind).toBe("ctrl+j")
    h.emit("session.status", { sessionID: "old", status: { type: "busy" } })
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).not.toContain("running")
    expect(h.editor.plainText).toBe("keep this draft")
  } finally { h.dispose() }
})

test("late failures and pending debounced refreshes are discarded when panel unmounts", async () => {
  const h = await harness()
  const late = deferred<{ data: SessionInfo[] }>()
  h.enqueue(late.promise)
  await h.mount()
  h.run("toggle")
  expect(h.requests).toHaveLength(1)
  h.emit("session.renamed")
  h.dispose()
  late.resolve({ data: [session("stale", 5)] })
  await late.promise
  await new Promise((resolve) => setTimeout(resolve, 130))
  expect(h.requests).toHaveLength(1)
  expect(h.toasts).toEqual([])
})

test("host-consumed keys and modifier shortcuts never enter the search", async () => {
  const h = await harness()
  try {
    await h.mount()
    h.run("toggle")
    const host = (event: import("@opentui/core").KeyEvent) => {
      if (event.name !== "/") return
      event.preventDefault()
      event.stopPropagation()
    }
    h.screen.renderer.keyInput.prependListener("keypress", host)
    try {
      h.screen.mockInput.pressKey("/")
      h.screen.mockInput.pressKey("x", { ctrl: true })
      h.screen.mockInput.pressKey("x", { meta: true })
      await h.screen.renderOnce()
      expect(h.screen.captureCharFrame()).toContain("Search: type to filter")
      await h.screen.mockInput.typeText("old")
      await h.screen.renderOnce()
      expect(h.screen.captureCharFrame()).toContain("Search: old")
    } finally { h.screen.renderer.keyInput.off("keypress", host) }
  } finally { h.dispose() }
})

test("refresh reconciles selection against filtered results and no matches cannot navigate", async () => {
  const h = await harness()
  try {
    await h.mount()
    h.run("toggle")
    await h.screen.mockInput.typeText("old")
    h.setList([session("new", 3), session("active", 2)])
    h.emit("session.renamed")
    await new Promise((resolve) => setTimeout(resolve, 130))
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("No matches")
    h.run("next")
    h.run("select")
    expect(h.navigations).toEqual([])
    h.setList([session("old-new", 4), session("active", 2)])
    h.emit("session.renamed")
    await new Promise((resolve) => setTimeout(resolve, 130))
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("▸ Session old-new")
  } finally { h.dispose() }
})

test("narrow left overlay keeps close control and selected session visible", async () => {
  for (const width of [12, 20]) {
    const h = await harness({}, { width, height: 10 })
    try {
      await h.mount()
      h.run("toggle")
      await h.screen.renderOnce()
      const frame = h.screen.captureCharFrame().split("\n")
      expect(frame[0]).toContain("×")
      expect(frame[0]!.indexOf("×")).toBeLessThan(width)
      expect(frame.join("\n")).toContain(width === 12 ? "▸ Se" : "▸ Sess")
      await h.screen.mockMouse.click(frame[0]!.indexOf("×"), 0)
      expect(h.focused).toBe(true)
    } finally { h.dispose() }
  }
})

test("viewport shows nine rows, keeps its window steady, and follows selection after resize", async () => {
  const h = await harness()
  try {
    h.setList([session("active", 0), ...Array.from({ length: 20 }, (_, i) => session(`item-${20 - i}`, 20 - i))])
    await h.mount()
    h.run("toggle")
    await h.screen.renderOnce()
    const initial = h.screen.captureCharFrame()
    expect(initial).toContain("1–9/21 ↓")
    expect(initial).toContain("▸ Session active")
    expect(initial).toContain("Session item-13")
    expect(initial).not.toContain("Session item-12")
    h.run("next")
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("▸ Session item-20")
    expect(h.screen.captureCharFrame()).toContain("1–9/21 ↓")

    // A short terminal still has room for two single-line rows.
    h.screen.resize(30, 4)
    h.run("next")
    await h.screen.renderOnce()
    const short = h.screen.captureCharFrame()
    expect(short).toContain("Search: type to filter")
    expect(short).toContain("▸ Session item-19")
    expect(short).toContain("Session item-20")
    expect(short).not.toContain("Session active")
    expect(h.requests).toHaveLength(1)
  } finally { h.dispose() }
})

test("mouse wheel moves selection before a click switches sessions", async () => {
  const h = await harness()
  try {
    await h.mount()
    h.run("toggle")
    await h.screen.renderOnce()
    const oldY = h.screen.captureCharFrame().split("\n").findIndex((line) => line.includes("Session old"))
    expect(oldY).toBeGreaterThan(0)
    await h.screen.mockMouse.scroll(5, oldY, "down")
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("▸ Session old")
    await h.screen.mockMouse.click(5, oldY)
    expect(h.navigations).toEqual(["old"])
  } finally { h.dispose() }
})

test("an unresolved first fetch shows loading instead of an empty list", async () => {
  const h = await harness()
  const pending = deferred<{ data: SessionInfo[] }>()
  h.enqueue(pending.promise)
  try {
    await h.mount()
    h.run("toggle")
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("Loading…")
    pending.resolve({ data: [] })
    await h.screen.renderOnce()
    expect(h.screen.captureCharFrame()).toContain("No sessions")
  } finally { h.dispose() }
})
