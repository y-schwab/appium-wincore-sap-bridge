// Disabled while the e2e suite is scaled down to sap-discovery.e2e.ts — uncomment to re-enable
// (and remove it from the exclude list in vitest.e2e.config.ts).

// import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// import type { Browser } from 'webdriverio';
// import { createSapGuiSession, quitSession, bootstrapSapSession } from './helpers/session.js';
//
// /**
//  * Find / read / write against the SAP Logon screen — the one screen guaranteed to be
//  * up right after `sap.attach`, with well-known, version-stable field ids (the same
//  * ones any SAP GUI Scripting recording produces). Basic smoke coverage: is each verb
//  * wired end to end at all, not full behavioral coverage of every GuiComponent type —
//  * expand per-control-type cases once this is green against a real backend.
//  *
//  * Cold-start friendly (see helpers/session.ts bootstrapSapSession): only needs the
//  * SAP backend itself already up. If SAP Logon opens a *fresh* connection (nothing
//  * running yet, or nothing open in an already-running SAP Logon), that connection
//  * naturally lands on the login screen this suite expects. If a connection was
//  * already open AND already logged past the login screen, these tests will fail —
//  * log off first in that case.
//  */
// const LOGIN_USER_FIELD = 'wnd[0]/usr/txtRSYST-BNAME';
// const LOGIN_CLIENT_FIELD = 'wnd[0]/usr/txtRSYST-MANDT';
//
// describe('sap-bridge interaction', () => {
//     let driver: Browser;
//
//     beforeAll(async () => {
//         driver = await createSapGuiSession();
//         await bootstrapSapSession(driver);
//     });
//
//     afterAll(async () => {
//         await quitSession(driver);
//     });
//
//     it('sap.pageSource returns a non-empty tree rooted at the active window', async () => {
//         const xml = await driver.executeScript('windows: sapPageSource', []) as string;
//         expect(xml).toContain('<');
//         expect(xml).toMatch(/Type="Gui\w+"/);
//     });
//
//     it('sap.findElement resolves a known field id to a sap:-prefixed element', async () => {
//         const id = await driver.executeScript('windows: sapFindElement', [{ id: LOGIN_USER_FIELD }]) as string | null;
//         expect(id).toMatch(/^sap:/);
//     });
//
//     it('sap.findElement returns null for an id that does not exist', async () => {
//         const id = await driver.executeScript('windows: sapFindElement', [{ id: 'wnd[0]/usr/doesNotExist' }]) as string | null;
//         expect(id).toBeNull();
//     });
//
//     it('sap.getProperty / sap.getText / sap.getTagName / sap.getRect all resolve the same element', async () => {
//         const id = await driver.executeScript('windows: sapFindElement', [{ id: LOGIN_USER_FIELD }]) as string;
//
//         const type = await driver.executeScript('windows: sapGetProperty', [{ elementId: id, property: 'Type' }]);
//         expect(type).toBe('GuiTextField');
//
//         const tagName = await driver.executeScript('windows: sapGetTagName', [{ elementId: id }]);
//         expect(tagName).toBe('GuiTextField');
//
//         await driver.executeScript('windows: sapGetText', [{ elementId: id }]); // just must not throw
//
//         const rect = await driver.executeScript('windows: sapGetRect', [{ elementId: id }]) as { x: number; y: number; width: number; height: number };
//         expect(rect.width).toBeGreaterThan(0);
//         expect(rect.height).toBeGreaterThan(0);
//     });
//
//     it('sap.setValue writes a value that sap.getText reads back, and restores it', async () => {
//         const id = await driver.executeScript('windows: sapFindElement', [{ id: LOGIN_USER_FIELD }]) as string;
//         const original = await driver.executeScript('windows: sapGetText', [{ elementId: id }]) as string;
//
//         try {
//             await driver.executeScript('windows: sapSetValue', [{ elementId: id, value: 'wincore-e2e' }]);
//             const written = await driver.executeScript('windows: sapGetText', [{ elementId: id }]);
//             expect(written).toBe('wincore-e2e');
//         } finally {
//             await driver.executeScript('windows: sapSetValue', [{ elementId: id, value: original }]);
//         }
//     });
//
//     it('sap.setFocus / sap.select do not throw against an interactive field', async () => {
//         const id = await driver.executeScript('windows: sapFindElement', [{ id: LOGIN_CLIENT_FIELD }]) as string;
//         await driver.executeScript('windows: sapSetFocus', [{ elementId: id }]);
//     });
//
//     it('sap.evaluateXPath finds the same field by attribute, matching sap.findElement', async () => {
//         const byId = await driver.executeScript('windows: sapFindElement', [{ id: LOGIN_USER_FIELD }]) as string;
//         // `Id` (the SAP-canonical, GetProperty-readable form) is the full absolute path —
//         // e.g. "/app/con[0]/ses[0]/wnd[0]/usr/txtRSYST-BNAME" — even though FindById also
//         // accepts the short session-relative form used above. Read it back rather than
//         // assuming the two strings match.
//         const fullId = await driver.executeScript('windows: sapGetProperty', [{ elementId: byId, property: 'Id' }]) as string;
//         const byXPath = await driver.executeScript(
//             'windows: sapEvaluateXPath',
//             [{ expression: '//*[@Id="' + fullId + '"]', multiple: false }],
//         ) as string | null;
//         expect(byXPath).toBe(byId);
//     });
//
//     it('sap.evaluateXPath with multiple=true returns every GuiTextField on the login screen', async () => {
//         const ids = await driver.executeScript('windows: sapEvaluateXPath', [{ expression: '//GuiTextField', multiple: true }]) as string[];
//         expect(Array.isArray(ids)).toBe(true);
//         expect(ids.length).toBeGreaterThan(0);
//         expect(ids.every((id) => id.startsWith('sap:'))).toBe(true);
//     });
// });
