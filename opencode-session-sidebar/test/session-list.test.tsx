import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionList, type SessionStatus } from "../tui/session-list"

const session = (id: string, updated: number, title = id, parentID?: string) =>
  ({ id, title, parentID, time: { updated } })

test("the list prioritizes current and active roots, dedupes, and retains selection across search", () => {
  createRoot((dispose) => {
    try {
      const [status, setStatus] = createSignal<SessionStatus | undefined>("running")
      const list = createSessionList(
        () => [session("current", 1), session("active", 2, "Active café"), session("newest", 9, "New café"),
          session("newest", 8), session("child", 10, "child", "current")],
        () => "current",
        (id) => id === "active" ? status() : undefined,
      )
      const ids = () => list.results().rows.map((row) => row.id)
      list.reset()
      expect(ids()).toEqual(["current", "active", "newest"])
      expect(list.selected()).toBe("current")
      list.edit("CAFÉ")
      expect(ids()).toEqual(["active", "newest"])
      expect(list.selected()).toBe("active")
      setStatus(undefined)
      expect(ids()).toEqual(["newest", "active"])
      expect(list.selectedIndex()).toBe(1)
      list.step(1, false)
      expect(list.selected()).toBe("active")
      list.step(1)
      expect(list.selected()).toBe("newest")
      list.edit("no matches")
      expect(list.selected()).toBeUndefined()
    } finally { dispose() }
  })
})

test("typing and navigation do not rebuild indexed titles or re-read host statuses", () => {
  createRoot((dispose) => {
    try {
      let titleReads = 0
      let statusReads = 0
      const [sessions] = createSignal(Array.from({ length: 1000 }, (_, i) => ({
        ...session(String(i), i),
        get title() { titleReads++; return `Session ${i}` },
      })))
      const list = createSessionList(sessions, () => "500", () => { statusReads++; return undefined })
      list.reset()
      expect(titleReads).toBe(1000)
      expect(statusReads).toBe(1000)

      for (const query of ["s", "ses", "Session 1", "SESSION 10", "no match", ""]) list.edit(query)
      const result = list.results()
      for (let i = 0; i < 100; i++) list.step(1)
      expect(list.results()).toBe(result)
      expect(titleReads).toBe(1000)
      expect(statusReads).toBe(1000)
    } finally { dispose() }
  })
})
