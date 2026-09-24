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

Same model as the Java bridge: attach is the only plugin command. Once attached, the
provider owns the attached session's frame windows (matched by `GuiFrameWindow.Handle`),
so standard `findElement` / `getPageSource` / XPath rooted at one of them are served
from the SAP tree, and element commands (`click`, `setValue`, `getText`, …) reach it
through the `sap:` element-id prefix.

## Install

```bash
appium plugin install --source=npm appium-wincore-sap-bridge
appium --use-plugins=wincore-sap-bridge
```

Requires Appium 3 and `appium-wincore-driver`. The plugin registers its server-side
tree provider by appending its `native/plugin/` directory to the
`WINCORE_SERVER_PLUGINS` environment variable at load, before any session starts.

## Usage

Attach is a command, not a capability. Open a SAP connection first (e.g. double-click
it in the SAP Logon window), then:

```js
const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]);
// { attached: true, connectionCount, sessionCount, system, sessionInfo: { ... }, windowHandles: ['0x000a1b2c', ...] }
// or { attached: false, reason: 'no_open_connection', ... } if nothing is open yet

// Standard WebDriver from here on — root the session at a SAP window:
await driver.switchToWindow(status.windowHandles[0]);
const xml = await driver.getPageSource();                     // SAP tree
const user = await driver.$('~wnd[0]/usr/txtRSYST-BNAME');     // accessibility id = SAP Id
await user.setValue('myuser');
const fields = await driver.$$('//GuiTextField');             // XPath over SAP Type tags
```

| Command | Params | Description |
| --- | --- | --- |
| `windows: attachSapGui` | `connectionIndex?`, `sessionIndex?` | Bind to the SAP GUI scripting engine and select a session. Returns the session's `windowHandles`. |
| `windows: detachSapGui` | — | Drop the SAP session reference. |

Standard locators map onto SAP scripting properties:

| Locator | SAP property |
| --- | --- |
| `accessibility id` (`~…`) | `Id` — full (`/app/con[0]/ses[0]/wnd[0]/usr/txtX`) or any trailing path (`wnd[0]/usr/txtX`) |
| `name` | `Name` |
| `class name` / `tag name` | `Type` (`GuiTextField`, `GuiButton`, …) |
| `xpath` | full XPath 1.0 over page source |

Page source, XPath, and element ids all use a `sap:` element-id prefix and the SAP
`Type` string (`GuiTextField`, `GuiButton`, `GuiShell`, …) as the tag
name — already a stable, language-neutral PascalCase identifier, so no role-mapping
table is needed the way the Java bridge needs one. Shell controls (grids, trees, toolbars,
HTML viewers, …) all report `Type` `GuiShell`; their kind is in a `SubType` attribute
(`//GuiShell[@SubType='Tree']`). ALV grid rows (`SubType` `GridView`) and tree nodes
(`SubType` `Tree`) are virtualised (not real children) and are emitted as synthetic
`GridRow` / `GridCell` / `TreeNode` elements in page source and XPath.

## Testing

The e2e suite is currently scaled down to `sap-discovery.e2e.ts`: it launches SAP Logon
through the driver (`appium:app` = `saplogon.exe`, `appium:noReset` to reuse a running
instance), attaches, and dumps page source before / after attach — plus the SAP
window's page source when attached — into `test-output/`. `sap-attached-window.e2e.ts`
expects a SAP connection already open and logged in: it switches to that window, attaches,
and checks the page source is now served from the SAP tree, writing
`test-output/attached-window/SUMMARY.md`, the attach result (with per-connection
diagnostics when attach fails) and the after-attach page source. It switches with `windows: switchToWindowByTitle` on `SAP_WINDOW_TITLE` (partial match, default `SAP Easy`). The attach / interaction /
login suites are commented out and excluded in `vitest.e2e.config.ts` until they're
rebuilt on standard WebDriver commands.

Env vars for the bootstrap itself, both optional:

| Var | Default | Purpose |
| --- | --- | --- |
| `SAP_LOGON_EXE` | `C:\Program Files (x86)\SAP\FrontEnd\SapGui\saplogon.exe` | Path used to launch SAP Logon if it isn't already running. |
| `SAP_CONNECTION` | `A4H` | Connection entry name double-clicked in the SAP Logon window if nothing is open yet. |

```bash
npm run test:e2e
```

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
