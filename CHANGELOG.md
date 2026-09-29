# Changelog

## Unreleased

### New since 1.0.0

- Dropdown entries are elements (`sap:<dropdown id>#entry:<key>`):
  `windows: select` / `windows: invoke` pick one, `getText` and `isSelected`
  read it; `click()` is refused (no screen position). Page source marks the
  current entry with `Selected`.

## 1.0.0 — 2026-09-28

First release. SAP GUI for Windows controls, served to
`appium-wincore-driver` (3.0.1 or later) through the SAP GUI Scripting API.

### Added

- `windows: attachSapGui` / `windows: detachSapGui`: bind to the running SAP
  GUI scripting engine and select a session; its windows are then served from
  the SAP tree for standard find, page source and XPath.
- Standard locators over SAP properties: accessibility id (`Id`, one lookup
  for ids from `wnd[…]` on), `name`, `class name` / `tag name` (`Type`) and
  full XPath 1.0.
- Element commands: `click`, `getText`, `getAttribute`, `setValue`,
  `isSelected`, `windows: select`, `windows: invoke`, `windows: expand`.
- Trees: nodes as `TreeNode` elements, expand, select and invoke.
- ALV grids: rows and cells as `GridRow` / `GridCell` elements with `Column`
  and `Title`; select, invoke, edit cells.
- Table controls: cells grouped into `TableRow` elements with column `Title`s;
  `RowCount`, `VisibleRowCount`, `ScrollPosition` on the table.
- Menus: the whole menu bar in page source, items selected with
  `windows: invoke`.
- Dropdowns: `setValue` by visible text or key; selected `Key` and entries in
  page source; the visible text without SAP's padding.
- `windows: select` ticks a checkbox.
- `click()` on elements without screen geometry (tree nodes, grid rows and
  cells, menu items) is refused with a pointer to `windows: select` /
  `windows: invoke`.

Verified end to end on SAP NetWeaver AS ABAP developer edition (A4H) with SAP
GUI 8.00: see the `gui-*.e2e.ts` tests and
[Known limitations](README.md#known-limitations).
