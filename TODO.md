# TODO

Open work on the SAP GUI bridge, found while building the demo e2e tests
(`test/e2e/sap-demo-*.e2e.ts`). Roughly in priority order.

Verified so far on A4H: main window, popups (`wnd[1]`), command field,
buttons, title and status bar, text fields, labels, checkboxes, radio
buttons, classic lists, the SAP Easy Access tree and ALV grid rows and
cells.

## Open run

- [ ] Run the ALV demo with SE16's "Field Label" setting and check the grid
  column titles are the labels users see, not field names.
- [ ] If they are, locate grid cells by the visible `@Title` instead of
  `@Column='MANDT'`.
- [ ] Slim the ALV demo down to the verified flow.
- [ ] Run all three demos (SE16, SU3, ALV) in one go to check they don't
  interfere with each other.

## New demo test

Display-only, built step by step like the others.

- [ ] **Tabs** (`GuiTab`): switch tabs in SE11 → T000 (e.g. Fields) and
  read content that only exists once the tab is selected.
- [ ] **Table control** (`GuiTableControl`): read the SE11 field list.
- [ ] **Menus** (`GuiMenu`): System → Status from the menu bar, read client
  and user in the popup, close it. Menu items have no screen position, so
  `click()` probably fails — fix in the bridge or document
  `windows: invoke`.
- [ ] **Dropdowns** (`GuiComboBox`): on SU3's Defaults tab, read a
  dropdown's visible text and its key.

## Bridge

- [ ] **Dropdown `setValue`**: accept the visible text ("English"), not
  only SAP's internal key (`EN`).
- [ ] **Scrolling**: grids and table controls only expose the rows on
  screen. Reach the rest by scrolling or by exposing every row; test with a
  table bigger than T000.
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
- [ ] Decide whether SAP function keys (F2, F8, …) need a command. Pressing
  toolbar buttons covers them so far; the bridge's `sendVKey` is disabled.
