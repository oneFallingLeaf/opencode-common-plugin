/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import type { SessionList, SessionRow } from "./session-list"

export type RailPalette = {
  panel: ColorInput
  raised: ColorInput
  border: ColorInput
  text: ColorInput
  muted: ColorInput
  accent: ColorInput
  running: ColorInput
  retrying: ColorInput
}

function recency(updated: number) {
  const now = new Date()
  const minutes = Math.max(0, Math.floor((now.getTime() - updated) / 60_000))
  const age = minutes === 0 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
  const day = new Date(updated)
  if (day.toDateString() === now.toDateString()) return `Today · ${age}`
  now.setDate(now.getDate() - 1)
  return day.toDateString() === now.toDateString() ? `Yesterday · ${age}` : age
}

export function SessionRail(props: {
  list: SessionList
  palette: RailPalette
  loading?: boolean
  scopeLabel?: string
  toggleScope?: () => void
  switchTo: (id: string) => void
  close: () => void
}) {
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => {
    const { width: cols, height } = dimensions()
    const width = Math.min(42, Math.max(1, cols >= 10 ? cols - 2 : cols))
    const search = height < 3 ? 0 : width >= 28 && height >= 10 ? 3 : 1
    const footer = height >= 5 && width >= 12
    const detail = height >= 8 && width >= 18
    const capacity = Math.max(0, Math.floor((height - 1 - search - Number(footer)) / (detail ? 2 : 1)))
    return { width, search, footer, detail, capacity }
  })
  const rows = () => props.list.results().rows
  const start = createMemo((previous: number) => {
    const size = layout().capacity
    if (!size) return 0
    const selected = Math.max(0, props.list.selectedIndex())
    const start = Math.min(previous, Math.max(0, rows().length - size))
    // Keep rows in place while the selection stays inside the viewport.
    return Math.max(selected - size + 1, Math.min(start, selected))
  }, 0)
  const visible = createMemo(() => rows().slice(start(), start() + layout().capacity))
  const range = () => {
    const total = rows().length
    if (!total) return props.loading ? "" : "0 results"
    if (total <= layout().capacity) {
      if (props.list.query()) return total === 1 ? "1 match" : `${total} matches`
      return total === 1 ? "1 session" : `${total} sessions`
    }
    const end = start() + visible().length
    return `${start() ? "↑" : ""}${start() + 1}–${end}/${total}${end < total ? " ↓" : ""}`
  }
  const searchText = () => (layout().width < 16 ? "/ " : "Search: ") +
    (props.list.query() || (layout().width < 16 ? "" : "type to filter"))
  const palette = createMemo(() => props.palette)
  return (
    <box position="absolute" top={0} bottom={0} left={0} width={layout().width} zIndex={1500}
      flexDirection="column" paddingX={layout().width >= 16 ? 1 : 0} overflow="hidden"
      backgroundColor={palette().panel} border={layout().width >= 4 ? ["right"] : false} borderColor={palette().border}
      onMouseScroll={(event) => {
        const direction = event.scroll?.direction
        if (direction !== "up" && direction !== "down") return
        event.stopPropagation()
        props.list.step(direction === "down" ? 1 : -1, false)
      }}
    >
      <box height={1} flexShrink={0} flexDirection="row">
        <text fg={palette().text} wrapMode="none" minWidth={0} flexGrow={1} truncate>
          <b>{layout().width < 10 ? "S" : "Sessions"}</b>
        </text>
        <Show when={props.scopeLabel && props.toggleScope && layout().width >= 19}>
          <text fg={palette().accent} flexShrink={0} selectable={false} onMouseUp={(event) => {
            if (event.button !== 0 || event.isDragging) return
            event.stopPropagation()
            props.toggleScope?.()
          }}>{layout().width >= 30 ? ` ${props.scopeLabel} [Tab]  ` : ` ${props.scopeLabel} `}</text>
        </Show>
        <text fg={palette().muted} flexShrink={0} selectable={false} onMouseUp={(event) => {
          if (event.button !== 0 || event.isDragging) return
          event.stopPropagation()
          props.close()
        }}>×</text>
      </box>
      <Show when={layout().search === 3} fallback={
        <Show when={layout().search === 1}>
          <text fg={palette().accent} height={1} flexShrink={0} wrapMode="none" truncate>{searchText()}</text>
        </Show>
      }>
        <box height={3} flexShrink={0} border borderStyle="heavy" borderColor={palette().accent}
          backgroundColor={palette().raised} paddingX={1}>
          <text fg={palette().text} wrapMode="none" truncate><b>{searchText()}</b></text>
        </box>
      </Show>
      <box minHeight={0} flexGrow={1} flexDirection="column" overflow="hidden">
        <For each={visible()}>{(row) => (
          <RailRow row={row}
            active={props.list.selected() === row.id} detail={layout().detail} badge={layout().width >= 14}
            palette={palette()} select={() => props.list.select(row.id)} open={() => props.switchTo(row.id)} />
        )}</For>
        <Show when={!rows().length}>
          <text fg={palette().muted} wrapMode="none" truncate>
            {props.loading && !props.list.hasSessions() ? "Loading…" : props.list.hasSessions() ? "No matches" : "No sessions"}
          </text>
        </Show>
      </box>
      <Show when={layout().footer}>
        <box height={1} flexShrink={0} flexDirection="row">
          <text fg={palette().muted} flexGrow={1} minWidth={0} wrapMode="none" truncate>{range()}</text>
          <Show when={layout().width >= 32}>
            <text fg={palette().muted} flexShrink={0}>{"  ↑↓ Enter Esc"}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function RailRow(props: {
  row: SessionRow
  active: boolean
  detail: boolean
  badge: boolean
  palette: RailPalette
  select: () => void
  open: () => void
}) {
  const { row } = props
  const palette = () => props.palette
  const metadata = recency(row.updated)
  const compactStatus = () => !props.detail && row.status
  const badge = () => compactStatus() ? (row.status === "running" ? "●" : "◌") : row.current ? "◆" : ""
  return (
    <box height={props.detail ? 2 : 1} flexShrink={0} flexDirection="column"
      backgroundColor={props.active ? palette().raised : palette().panel}
      onMouseDown={(event) => {
        if (event.button === 0) props.select()
      }}
      onMouseUp={(event) => {
        if (event.button !== 0 || event.isDragging) return
        event.stopPropagation()
        props.open()
      }}
    >
      <box height={1} flexShrink={0} flexDirection="row">
        <text width={2} flexShrink={0} selectable={false} fg={palette().accent}>{props.active ? "▸" : ""}</text>
        <text flexGrow={1} minWidth={0} wrapMode="none" truncate selectable={false} fg={props.active ? palette().accent : palette().text}>{row.title}</text>
        <Show when={props.badge && badge()}>
          <text fg={compactStatus() && row.status ? palette()[row.status] : palette().accent} flexShrink={0} selectable={false}>{` ${badge()}`}</text>
        </Show>
      </box>
      <Show when={props.detail}>
        <box height={1} flexShrink={0} flexDirection="row" paddingLeft={2}>
          <text fg={palette().muted} flexGrow={1} minWidth={0} wrapMode="none" truncate selectable={false}>
            {row.current ? `Current · ${metadata}` : metadata}
          </text>
          <Show when={row.status}>
            {(status) => <text fg={palette()[status()]} flexShrink={0} selectable={false}>{` ${status()}`}</text>}
          </Show>
        </box>
      </Show>
    </box>
  )
}
