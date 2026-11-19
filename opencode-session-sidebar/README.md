# opencode-session-sidebar 0.4.0

A sessions plugin for OpenCode V1 (1.18.29+) and [OpenCode V2](https://opencode.ai/v2/docs/build/plugins/cli), tested on V2 **2.2.7** and **2.3.2**. The `./tui` entry loads only the matching implementation. Starting in 0.3.0 there is no package root export: V2 treats a root export as a server plugin. If you previously imported the root directly, use `opencode-session-sidebar/tui`. `./v1` and `./v2` remain available as explicit exports.

## OpenCode V1

V1 uses a non-modal overlay over the left edge, from Home or a session. Press `left` with an empty prompt, click **Sessions** next to the prompt, or use `/sessions-panel`; `up`/`down` and `enter` navigate, `right` or `escape` closes. Clicking into the prompt closes the overlay without discarding a draft. The V1 default `openKey` remains `left` (it overrides the previous-child shortcut while the prompt is empty).

Run `bun install` in this checkout and add the package to V1's global `~/.config/opencode/tui.json` (or `$XDG_CONFIG_HOME/opencode/tui.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["/absolute/path/to/custom-plugin/opencode-session-sidebar", {
    "openKey": "left", "closeKey": "right", "scope": "project", "limit": 50
  }]]
}
```

See [`examples/tui.json`](examples/tui.json). Once 0.4.0 is published, you can use `"opencode-session-sidebar@0.4.0"` in the V1 `plugin` list instead of the local path. The V1 package loader uses the `./tui` export, not the V2 CLI config. For a manually installed local package, point V1 at the absolute path of `tui/index.ts` in that installed package; keep its dependencies installed. Do not copy only that file: it dynamically loads `v1.tsx` from the same directory.

## OpenCode V2

Open the sidebar directly from Home or from a session: click **Sessions** in the footer, use `/sessions-panel`, or select **Toggle sessions panel** from the command palette. With the [example config](#v2-configuration), you can also press **Left** at an empty prompt. You don't need to start or continue a session first.

- **Tab** or click the scope label: switch between **Folder** and **All** sessions with the example config. Switching keeps your search and remembers the selected scope until OpenCode exits.
- **Up/Down**, then **Enter**, or click a session: open the selected session.
- **Right**, **Esc**, or **×**: close the sidebar.

The overlay temporarily blurs the prompt and restores focus on close. Session status is refreshed from the V2 data cache and status events; retrying is shown when a retry status event is observed while the overlay is mounted.

## Sidebar controls (V1 and V2)

Type to filter fetched titles case-insensitively, use `backspace` to erase a character, or `ctrl+u` to clear the search. Scroll over the sidebar to move the selection. The current session appears first, then running or retrying sessions, then the most recently updated sessions. Subagent sessions are hidden. The footer shows how many sessions match or which part of the list is visible. On narrow or short terminals, rows collapse to one line so the selected title stays visible.

## Install

From this checkout, run `bun install` in this package directory, then add the
package directory to your **global** `~/.config/opencode/cli.json` (or
`$XDG_CONFIG_HOME/opencode/cli.json`). Replace the path with the absolute path
to your checkout:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/custom-plugin/opencode-session-sidebar"]
}
```

OpenCode loads the package's `./tui` export automatically. This configuration is local to the CLI and works when connected to a remote OpenCode server. Use `cli.json` for V2 and `tui.json` for V1; do not put this CLI-only plugin in server `opencode.json`. There is no project-local V2 `cli.json`. Restart the CLI after installation. See [CLI plugin installation](https://opencode.ai/v2/docs/cli/plugins).

Use the checkout instructions above until 0.4.0 is published. After
publication, `opencode plugin add opencode-session-sidebar@0.4.0` will add it
to `cli.json` as a TUI-only plugin. If you're using the older 0.2.1 release,
add `"opencode-session-sidebar@0.2.1"` to `cli.json` manually; its root
export makes `plugin add` register it as a server plugin.

## V2 configuration

This example enables **Left** at an empty prompt and starts the sidebar in **Folder** view. See [`examples/cli.json`](examples/cli.json) for a copyable file.

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{
    "package": "/absolute/path/to/custom-plugin/opencode-session-sidebar",
    "options": {
      "openKey": "left",
      "closeKey": "right",
      "requireEmptyPrompt": true,
      "scope": "folder",
      "limit": 50,
      "showStatus": true
    }
  }]
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `openKey` | unset in V2; `left` in V1 | Optional global key to open from Home or a session in V2; leave unset to preserve V2 shortcuts. |
| `closeKey` | `right` | Key to close (also `escape`). |
| `requireEmptyPrompt` | `true` | If `openKey` is set, do not intercept it while editing a draft. |
| `scope` | `project` | Initial view in V2: `folder` limits results to the current directory; `project` uses the launch project on Home or the current session's project; `all` lists across projects. When starting in `all`, Tab switches to `folder`. |
| `limit` | `50` | Maximum number of sessions fetched; positive fractions round down to at least one. |
| `showStatus` | `true` | Mark running/retrying sessions and group them before older sessions. |
| `enabled` | `true` | Disable this plugin without removing its configuration. |

Search only filters the fetched session titles, not message contents or sessions beyond `limit`. If the project identity is not yet available in the local session cache, the project view waits for the cache to sync before listing sessions.

To opt into the former arrow shortcut, add `"openKey": "left"` to this plugin's `options`. This registers a global keymap layer on Home and in sessions with the overlay closed; with the default `requireEmptyPrompt: true`, it is active only when the prompt is empty. **Tradeoff:** it may override V2's `session.child.previous` on `left` in that context. Choose another key after checking your [V2 keybindings](https://opencode.ai/v2/docs/cli/keybinds), or leave `openKey` unset to retain built-in navigation. Setting `openKey` to an empty string also leaves it unbound.

## Development

Run `bun install`, `bun test`, `bun run typecheck`, and `npm pack --dry-run` from this directory. The V2 test suite uses the OpenCode 2.3.2 SDK and OpenTUI 0.8.4. GPL-2.0-only; see [LICENSE](LICENSE).
