# appium-wincore-sap-bridge

SAP GUI for Windows scripting bridge for
[appium-wincore-driver](https://github.com/y-schwab/appium-wincore-driver), as an installable
Appium plugin.

## The problem

SAP GUI for Windows draws its own controls — they are opaque to out-of-process UI
Automation, which sees one childless pane per session window. The controls only exist
in SAP's own automation surface, the **SAP GUI Scripting API**.

## The fix

Unlike the Java / .NET bridges, nothing is injected: the scripting engine already
runs in-process inside `saplogon.exe` whenever "Enable scripting" is ticked in SAP GUI
options (client side) and the server profile parameter `sapgui/user_scripting` is
`TRUE`. This plugin binds to it directly — `Marshal.BindToMoniker("SAPGUI")`, the .NET
equivalent of VBScript's `GetObject("SAPGUI")` — via a **tree provider**
(`ITreeProvider`) contributed by this package's WincoreServer plugin
(`native/plugin/WincoreSapBridge.dll`).

SAP exposes no attribute-based find and no per-window ownership model the way the Java
/ .NET trees do — you attach to a connection/session index, not a window — so this
bridge does not auto-route standard `findElement`/`getPageSource` the way the Java
bridge does. Every SAP interaction goes through this plugin's own `sap*` commands,
addressed by SAP id (e.g. `/app/con[0]/ses[0]/wnd[0]/usr/txtRSYST-BNAME`) or XPath.

## Install

```bash
appium plugin install --source=npm appium-wincore-sap-bridge
appium --use-plugins=wincore-sap-bridge
```

Requires Appium 3 and `appium-wincore-driver`. The plugin registers its server-side
tree provider by appending its `native/plugin/` directory to the
`WINCORE_SERVER_PLUGINS` environment variable at load, before any session starts.

## Usage

Attach is a command, not a capability. Once a session is created (any root window —
attach is keyed by SAP connection/session index, not by hwnd):

```js
const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]);
// { attached: true, connectionCount, sessionCount, system, sessionInfo: { user, transaction, program, ... } }
// or { attached: false, reason: 'no_open_connection', ... } if nobody is logged in yet

// Cold start — nothing open yet: start the session with 'appium:app' pointing at
// saplogon.exe, double-click the connection entry in the SAP Logon window, then attach
// (see test/e2e/helpers/session.ts bootstrapSapSession).

const id = await driver.executeScript('windows: sapFindElement', [{ id: 'wnd[0]/usr/txtRSYST-BNAME' }]);
await driver.executeScript('windows: sapSetValue', [{ elementId: id, value: 'myuser' }]);
await driver.executeScript('windows: sapSendVKey', [{ vkey: 0 }]); // Enter
```

| Command | Params | Description |
|---|---|---|
| `windows: attachSapGui` | `connectionIndex?`, `sessionIndex?` | Bind to the SAP GUI scripting engine and select a session. |
| `windows: detachSapGui` | — | Drop the SAP session reference. |
| `windows: sapGuiStatus` | — | `{ attached: boolean }`. |
| `windows: sapPageSource` | `contextElementId?` | XML dump of the SAP component tree (defaults to the active window). |
| `windows: sapFindElement` | `id` | Resolve a raw SAP id to an element reference, or `null`. |
| `windows: sapEvaluateXPath` | `expression`, `multiple?`, `contextElementId?` | Full XPath 1.0 over the SAP subtree. |
| `windows: sapGetProperty` | `elementId`, `property` | Any SAP scripting property by name (`Text`, `Changeable`, `IconName`, …). |
| `windows: sapGetText` / `sapGetTagName` / `sapGetRect` | `elementId` | Text, SAP `Type` (`GuiTextField`, `GuiButton`, …), and screen rect. |
| `windows: sapSetValue` | `elementId`, `value` | Sets text/key/checked value, dispatched per control type. |
| `windows: sapInvoke` | `elementId` | Press/Select/toggle, dispatched per control type. |
| `windows: sapSetFocus` / `sapSelect` | `elementId` | `SetFocus()` / `Select()`. |
| `windows: sapSendVKey` | `vkey`, `windowElementId?` | Send a virtual key (0 = Enter, 8 = F8, …) to a window; defaults to the active window. |

Page source, XPath, and element ids all use a `sap:` element-id prefix and the SAP
`Type` string (`GuiTextField`, `GuiButton`, `GuiGridView`, `GuiTree`, …) as the tag
name — already a stable, language-neutral PascalCase identifier, so no role-mapping
table is needed the way the Java bridge needs one. `GuiGridView` rows and `GuiTree`
nodes are virtualised (not real children) and are emitted as synthetic `GridRow` /
`GridCell` / `TreeNode` elements in page source and XPath.

## Testing

`test/e2e/` has three suites, and they're **cold-start friendly**: the only thing you
need already running is the SAP backend itself (the ABAP container — see
`appium-wincore-test-apps` sibling repo, `sap/`). SAP Logon does not need to be open —
each session is created with `appium:app` set to `saplogon.exe` (plus `appium:noReset`,
so an already-running instance is reused), and `bootstrapSapSession`
(`test/e2e/helpers/session.ts`) double-clicks the connection entry in the SAP Logon
window if nothing is open yet, before attaching. All three fail loudly
(not skip) if that bootstrap can't succeed.

- `sap-attach.e2e.ts` — connection lifecycle: status before attach, attach, status
  after attach, detach, commands failing cleanly with nothing attached.
- `sap-interaction.e2e.ts` — find/read/write against the SAP **Logon screen**'s
  well-known field ids: `sap.findElement` (hit and miss), `sap.getProperty` /
  `sap.getText` / `sap.getTagName` / `sap.getRect`, a `sap.setValue` round trip (value
  is restored after), and `sap.evaluateXPath` (single and `multiple: true`). Needs a
  **logged-out** session — it never submits the login form. A fresh cold-start
  connection lands here naturally; if a connection was already open AND already
  logged in, this suite fails — log off first in that case.
- `sap-login.e2e.ts` — fills client/user/password and `sendVKey`s Enter, then checks
  the login fields are gone. Idempotent (passes as a no-op if already logged in) but
  does **not** log off afterward, so run `sap-interaction.e2e.ts` first (or against a
  separate logged-out session) if you want both in one pass. Needs `SAP_USER` /
  `SAP_PASSWORD` env vars — no default; `SAP_CLIENT` is optional.

Env vars for the bootstrap itself, both optional:

| Var | Default | Purpose |
|---|---|---|
| `SAP_LOGON_EXE` | `C:\Program Files (x86)\SAP\FrontEnd\SapGui\saplogon.exe` | Path used to launch SAP Logon if it isn't already running. |
| `SAP_CONNECTION` | `A4H` | Connection entry name double-clicked in the SAP Logon window if nothing is open yet. |

This is basic wiring coverage — is each `sap.*` verb reachable end to end at all —
not full behavioral coverage of every `GuiComponent` type (`GuiGridView` /
`GuiComboBox` / `GuiTree` cases etc. still need adding once this is green).

```bash
SAP_USER=... SAP_PASSWORD=... npm run test:e2e
```

`sap-login.e2e.ts` fails (not skips) if `SAP_USER`/`SAP_PASSWORD` are unset — run it on its
own with `npx vitest run --config vitest.e2e.config.ts sap-attach sap-interaction` to skip
the login suite deliberately.

## Build from source

```bash
npm install
npm run build:all      # publish the plugin DLL, tsc
```

## Contract

The plugin DLL compiles against [`WincoreServerSdk`](https://www.nuget.org/packages/WincoreServerSdk)
(`ITreeProvider`, `IServerPlugin`) via a `PackageReference`. `PluginLoader` refuses to
load a plugin whose declared SDK major version doesn't match the host's — see the
driver's [server plugin architecture](https://github.com/y-schwab/appium-wincore-driver#readme)
docs.
