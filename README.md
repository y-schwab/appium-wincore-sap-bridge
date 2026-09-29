# appium-wincore-sap-bridge

SAP GUI for Windows scripting bridge for
[appium-wincore-driver](https://github.com/y-schwab/appium-wincore-driver),
as an installable Appium plugin.

## The problem

SAP GUI for Windows draws its own controls — they are opaque to out-of-process
UI Automation, which sees one childless pane per session window. The controls
only exist in SAP's own automation surface, the **SAP GUI Scripting API**.

## The fix

Unlike the Java / .NET bridges, nothing is injected: the scripting engine
already runs in-process inside `saplogon.exe` whenever "Enable scripting" is
ticked in SAP GUI options (client side) and the server profile parameter
`sapgui/user_scripting` is `TRUE`. This plugin binds to it directly —
`Marshal.BindToMoniker("SAPGUI")`, the .NET equivalent of VBScript's
`GetObject("SAPGUI")` — via a **tree provider** (`ITreeProvider`) contributed
by this package's WincoreServer plugin (`native/plugin/WincoreSapBridge.dll`).

Same model as the Java bridge: attach is the only plugin command. Once
attached, the provider owns the attached session's frame windows (matched by
`GuiFrameWindow.Handle`), so standard `findElement` / `getPageSource` / XPath
rooted at one of them are served from the SAP tree, and element commands
(`click`, `setValue`, `getText`, …) reach it through the `sap:` element-id
prefix.

## Requirements

- Windows, Appium 3 and `appium-wincore-driver` 3.0.1 or later.
- SAP GUI for Windows (tested with 8.00) with scripting enabled on both sides:
  - client: SAP GUI Options → Accessibility & Scripting → Scripting →
    "Enable scripting";
  - server: profile parameter `sapgui/user_scripting = TRUE`. It only applies
    to sessions logged on after the change.
- A SAP connection open and logged on before attaching.
- Windows Smart App Control blocks unsigned binaries, such as a locally built
  `WincoreServer.exe` or plugin DLL. A blocked server shows up as
  `spawn UNKNOWN` when a session starts.

## Install

```bash
appium plugin install --source=npm appium-wincore-sap-bridge
appium --use-plugins=wincore-sap-bridge
```

The plugin registers its server-side tree provider by appending its
`native/plugin/` directory to the `WINCORE_SERVER_PLUGINS` environment
variable at load, before any session starts.

Run `appium` commands from outside this repository: inside it, Appium uses
the repository as its home and treats the plugin as "in development".

## Usage

Attach is a command, not a capability. Open a SAP connection first (e.g.
double-click it in the SAP Logon window), then:

```js
const status = await driver.executeScript('windows: attachSapGui',
    [{ connectionIndex: 0, sessionIndex: 0 }]);
// { attached: true, connectionCount, sessionCount, system, sessionInfo,
//   windowHandles: ['0x000a1b2c', ...] }
// or { attached: false, reason: 'no_open_connection', ... }

// Standard WebDriver from here on — root the session at a SAP window:
await driver.switchToWindow(status.windowHandles[0]);
const xml = await driver.getPageSource();                   // SAP tree
const user = await driver.$('~wnd[0]/usr/txtRSYST-BNAME');  // SAP Id
await user.setValue('myuser');
const fields = await driver.$$('//GuiTextField');           // SAP Type tags
```

Commands:

- `windows: attachSapGui` (`connectionIndex?`, `sessionIndex?`): bind to the
  SAP GUI scripting engine and select a session. Returns the session's
  `windowHandles`.
- `windows: detachSapGui`: drop the SAP session reference.

Standard locators map onto SAP scripting properties:

- `accessibility id` (`~…`) → `Id`, full (`/app/con[0]/ses[0]/wnd[0]/usr/txtX`)
  or from the window on (`wnd[0]/usr/txtX`). Either form is one lookup in SAP;
  a shorter trailing path (`usr/txtX`) walks the tree.
- `name` → `Name`, SAP's technical field name.
- `class name` / `tag name` → `Type` (`GuiTextField`, `GuiButton`, …).
- `xpath` → full XPath 1.0 over page source. Each XPath find rebuilds the page
  source, so prefer `~` ids where a test can.

Page source, XPath and element ids use a `sap:` element-id prefix and the SAP
`Type` string (`GuiTextField`, `GuiButton`, `GuiShell`, …) as the tag name —
already a stable, language-neutral identifier. Shell controls (grids, trees,
toolbars, HTML viewers, …) all report `Type` `GuiShell`; their kind is in a
`SubType` attribute (`//GuiShell[@SubType='Tree']`). Locate elements by their
visible text (`@Text`) where you can; it follows the logon language, so fix
the language for a test run.

## Controls

### Trees

Tree nodes (`SubType` `Tree`) are not real children in SAP; they are emitted
as `TreeNode` elements nested under their parent, with `Text`, `Key`,
`IsFolder` and (folders only) `IsExpanded`. Locate them by `@Text`: `Key` is
generated per system. A collapsed folder's children are not listed until it
is expanded. XPath returns nodes as elements (`sap:<shell id>#node:<key>`):

```js
const folder = await driver.$(
    "//TreeNode[@Text='Tools for Administrators and Developers']");
await driver.executeScript('windows: expand',
    [{ elementId: folder.elementId }]);
const editor = await driver.$("//TreeNode[@Text='ABAP Editor']");
// select only:
await driver.executeScript('windows: select',
    [{ elementId: editor.elementId }]);
// double-click, starts SE38:
await driver.executeScript('windows: invoke',
    [{ elementId: editor.elementId }]);
```

`getText` and `getAttribute` (`Text`, `Key`, `IsFolder`, `IsExpanded`,
`ExpandCollapseState`, `IsSelected`) work on nodes too.

### ALV grids

ALV grid rows (`SubType` `GridView`) are emitted as `GridRow` / `GridCell`
elements. Each cell carries `Column` (the column id, e.g. `MANDT`), `Title`
(the header the user sees, e.g. "Cl.") and `Text`. XPath returns rows as
`sap:<shell id>#row:<index>` and cells as `sap:<shell id>#cell:<index>:<col>`:

```js
const row = "//GuiShell[@SubType='GridView']"
    + "//GridRow[GridCell[@Column='MANDT' and @Text='001']]";
await driver.$(`${row}/GridCell[@Column='MTEXT']`).getText();  // "SAP SE"
const rowEl = await driver.$(row);
await driver.executeScript('windows: select', [{ elementId: rowEl.elementId }]);
```

`windows: select` selects a row or makes a cell the current cell,
`windows: invoke` double-clicks a cell, `setValue` writes an editable cell.
`Column` is stable; `Title` changes with the logon language and column width.

### Table controls

A `GuiTableControl` (e.g. SE11's field list) lists its cells as ordinary
fields named by screen position (`txtDD03D-FIELDNAME[col,row]`). In page
source they are grouped into `TableRow` elements (`Index` = screen row,
`AbsoluteRow` = row in the whole table), and each cell carries its column
`Title`. The table carries `RowCount`, `VisibleRowCount` and
`ScrollPosition`.

```ts
const row = "//GuiTableControl/TableRow"
    + "[*[@Name='DD03D-FIELDNAME' and @Text='MANDT']]";
await (await driver.$(`${row}/*[@Name='DD03D-DATATYPE']`)).getText(); // CLNT
```

`TableRow` itself is not an element; act on its cells. Rows off screen are
not listed — see [Known limitations](#known-limitations).

### Menus

The whole menu bar is in page source without opening anything: `GuiMenubar`
→ `GuiMenu` items, nested per submenu. Find items by their text (their index
differs per screen) and select one with `windows: invoke`:

```ts
const status = await driver.$("//GuiMenubar/GuiMenu[@Text='System']"
    + "/GuiMenu[@Text='Status...']");
await driver.executeScript('windows: invoke',
    [{ elementId: status.elementId }]);
```

### Dropdowns

A `GuiComboBox` carries the selected entry's `Key` next to its visible `Text`,
and lists its entries as `ComboBoxEntry` children (`Key`, `Value`) in page
source. Set it with `windows: setValue`, passing the visible text or the key:

```ts
const date = await driver.$('~wnd[0]/usr/…/cmbSUID_ST_NODE_DEFAULTS-DATFM');
await driver.executeScript('windows: setValue',
    [{ elementId: date.elementId, value: 'MM/DD/YYYY (Gregorian Date)' }]);
await date.getAttribute('Key');  // '2'
```

A key wins over another entry's text; then the text matches exactly, then
ignoring case, then the key ignoring case. Blanks around either are ignored.
A value that matches no entry, or several, is an error.

Entries are elements too (`sap:<dropdown id>#entry:<key>`): pick one with
`windows: select` (or `windows: invoke`); `getText` is its text, `isSelected`
whether it is the current one. They have no screen position, so `click()` is
refused.

```ts
const iso = await driver.$("//GuiComboBox[@Name='SUID_ST_NODE_DEFAULTS-DATFM']"
    + "/ComboBoxEntry[@Value='YYYY-MM-DD (Gregorian Date, ISO 8601)']");
await driver.executeScript('windows: select', [{ elementId: iso.elementId }]);
```

### Other controls

Text fields, labels, buttons, checkboxes, radio buttons, tabs, the command
field, title and status bar and popups (`wnd[1]`, their own window) work
through standard WebDriver. `windows: select` ticks a checkbox.

## Known limitations

- Only rows on screen are listed for grids, table controls and classic lists.
  Table controls and classic lists don't have the other rows on the client at
  all. Scroll like a user, with the mouse wheel over the table, then find
  again:

  ```ts
  await driver.executeScript('windows: scroll',
      [{ elementId: table.elementId, deltaY: 120 }]);  // one notch down
  ```

- Tree nodes, grid rows and cells, dropdown entries and menu items have no
  screen position:
  `click()` is refused. Use `windows: select` / `windows: invoke`.
- Plain `element.setValue()` clears the field and types keystrokes; for
  dropdowns, use `windows: setValue`.
- When `windows: setValue` fails, the driver retries the value as a number and
  reports "not a valid number for the RangeValue pattern" instead of the
  bridge's message.
- `windows: collapse` is not routed to the bridge by driver 3.0.1.
- Mouse clicks, wheel and typed keys need the SAP window in focus.
- Classic lists (e.g. SE16 without ALV) are `GuiLabel`s positioned by
  `lbl[col,row]`, without row or column structure.

## Testing

`npm run test:unit` runs the C# unit tests (`csharp/WincoreSapBridge.Tests`,
no SAP needed).

The e2e tests expect Appium running with the plugin and a SAP connection open
and logged on, on SAP Easy Access. One test per SAP control, each a real task
on a SAP system (written against the A4H developer edition):

- `gui-label.e2e.ts`: SE16 classic list of T000, checkbox, detail screen.
- `gui-text-field.e2e.ts`: SU3, change, save and reread a field.
- `gui-grid-view.e2e.ts`: SE16 as ALV grid through a popup, rows, cells,
  titles.
- `gui-combo-box.e2e.ts`: SU3 Date Format by text or key.
- `gui-table-control.e2e.ts`: SE11 tabs, field list, scrolling.
- `gui-menu.e2e.ts`: System → Status from the menu bar.

Each writes `test-output/<name>/SUMMARY.md`, plus the page source of the
screen a step failed on. `sap-attached-window.e2e.ts` checks attach, standard
find and tree nodes; `sap-discovery.e2e.ts` dumps page source before and after
attach.

```bash
npm run test:e2e
npx vitest run --config vitest.e2e.config.ts test/e2e/gui-
```

Optional environment variables:

- `SAP_LOGON_EXE`: path used to launch SAP Logon if it isn't running
  (default `C:\Program Files (x86)\SAP\FrontEnd\SapGui\saplogon.exe`).
- `SAP_WINDOW_TITLE`: partial title of the logged-on window (default
  `SAP Easy`).
- `SAP_DEMO_RECORD=1`, `SAP_DEMO_PACE_MS`: screen recording and pacing for
  `gui-grid-view.e2e.ts`.

## Build from source

```bash
npm install
npm run build:all      # publish the plugin DLL, tsc
```

`npm publish` runs `build:all` first (`prepublishOnly`), so the package always
ships the plugin DLL.

## Contract

The plugin DLL compiles against
[`WincoreServerSdk`](https://www.nuget.org/packages/WincoreServerSdk)
(`ITreeProvider`, `IServerPlugin`) via a `PackageReference`. `PluginLoader`
refuses to load a plugin whose declared SDK major version doesn't match the
host's — see the driver's [server plugin architecture][plugins] docs.

[plugins]: https://github.com/y-schwab/appium-wincore-driver#readme
