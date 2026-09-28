# TODO

Open work on the SAP GUI bridge, found while building the demo e2e tests
(`test/e2e/gui-*.e2e.ts`). Roughly in priority order.

Verified so far on A4H: main window, popups (`wnd[1]`), command field,
buttons, title and status bar, text fields, labels, checkboxes, radio
buttons, classic lists, the SAP Easy Access tree, ALV grid rows and
cells, dropdowns, tabs, table controls and menus.

## Open run

- [x] Run the ALV demo with SE16's "Field Label" setting and check the grid
  column titles are the labels users see, not field names ("Cl.", "Name", …).
- [x] ~~If they are, locate grid cells by the visible `@Title` instead of
  `@Column='MANDT'`.~~ Kept `@Column`: titles change with logon language and
  column width. `@Title` works in XPath too.
- [x] Slim the ALV demo down to the verified flow.
- [x] Run all four demos (SE16, SU3, ALV, dropdown) in one go to check they
  don't interfere with each other (46 PASS, ~51 s).

## New demo test

Display-only, built step by step like the others.

- [x] **Tabs** (`GuiTab`): switch tabs in SE11 → T000 (e.g. Fields) and
  read content that only exists once the tab is selected (`gui-table-control.e2e.ts`).
- [x] **Table control** (`GuiTableControl`): read the SE11 field list. Cells
  grouped into `TableRow` with column `Title`s (`gui-table-control.e2e.ts`).
  `TableRow` is not an element yet (grid rows are): no select / getText on a row.
- [x] **Menus** (`GuiMenu`): System → Status from the menu bar, read client
  and user in the popup, close it (`gui-menu.e2e.ts`). Menu items have no
  screen position: `click()` is refused with a pointer to `windows: invoke`.
- [x] **Dropdowns** (`GuiComboBox`): on SU3's Defaults tab, read a
  dropdown's visible text and its key (`gui-combo-box.e2e.ts`).

## Bridge

- [x] **Dropdown `setValue`**: accept the visible text ("English"), not
  only SAP's internal key (`EN`). Verified on A4H (`gui-combo-box.e2e.ts`).
- [x] **Scrolling**: decided to accept the limitation — page source lists
  only the rows on screen (table controls and classic lists don't have the
  others on the client at all). Tests scroll like a user, with the mouse wheel
  (`windows: scroll`), and find again. Needs the SAP window in focus. To
  confirm on A4H: `gui-table-control.e2e.ts` scrolls to LOGSYS.
- [ ] **Classic list structure**: turn the labels positioned by
  `lbl[col,row]` into rows and columns (`ListRow` / `@Column`), using the
  ABAP heading color to find the header row. Parked until users ask for it.

## Less urgent controls

- [ ] **Value help (F4) popups**: open one, pick an entry, check it lands in
  the field.
- [ ] **Right-click menus** (`GuiContextMenu`).
- [ ] **Multi-line text areas** (`GuiTextEdit`, e.g. long texts).
- [ ] **ALV grid toolbar** (Sort, Filter, Export): a toolbar shell without
  child elements, so it needs a bridge command.
- [ ] **Column and list trees**: only the simple tree (SAP Easy Access) has
  been tested.

## Driver (appium-wincore-driver)

- [ ] Route `windows: collapse` to the SAP bridge, so tree folders can be
  collapsed.
- [ ] Screen recording: `captureCursor` / `captureClicks` are passed to ffmpeg
  as `-capture_cursor` / `-capture_mouse_clicks` (macOS avfoundation
  options). Windows' gdigrab rejects them and ffmpeg exits, so
  `windows: startRecordingScreen` fails. Map `captureCursor` to
  `-draw_mouse`; gdigrab can't highlight clicks.
- [ ] `windows: setValue` (`patternSetValue`) retries any failed
  `setElementValue` as a RangeValue number, so a bridge error (e.g. "no
  dropdown entry 'X'. Entries: …") reaches the test as "not a valid number".
  Only fall back when the value is numeric, or rethrow the first error.
- [ ] Decide whether SAP function keys (F2, F8, …) need a command. Pressing
  toolbar buttons covers them so far; the bridge's `sendVKey` is disabled.
