import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, errMsg } from './helpers/sap-demo.js';

/**
 * GuiMenu: the menu bar, from SAP Easy Access.
 *
 *   1. The whole menu tree is in page source without opening anything (GuiMenubar mbar
 *      → GuiMenu menu[n] → menu[n]/menu[m]). Items are found by their text: their
 *      index differs per screen (System is menu[4] on SAP Easy Access, menu[6] in
 *      SE11). They have no screen geometry, so click() is refused with a pointer to
 *      windows: invoke.
 *   2. windows: invoke on System → Status... → popup "System: Status" (wnd[1]).
 *   3. Read client (001) and user (DEVELOPER); close with Continue (tbar[0]/btn[0]).
 *   4. /n back to SAP Easy Access. Changes nothing.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/gui-menu/: SUMMARY.md, plus the page source of the screen a
 * step failed on (failed-<step>.xml).
 */
const STATUS_ITEM = "//GuiMenubar/GuiMenu[@Text='System']/GuiMenu[@Text='Status...']";
const POPUP_TITLE = 'Status'; // partial window title, "System: Status"
const CLIENT_FIELD = "//GuiTextField[@Name='SYST-MANDT']";
const USER_FIELD = "//GuiTextField[@Name='SYST-UNAME']";
const CONTINUE_BUTTON = '~wnd[1]/tbar[0]/btn[0]';

const CLIENT = '001';
const USER = 'DEVELOPER';

const demo = new SapDemo('gui-menu', 'GuiMenu: System → Status');

describe('GuiMenu: System → Status', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('opens System → Status from the menu bar', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        try {
            // 1. click() on a menu item: no screen position, so the bridge refuses it
            //    instead of the mouse landing somewhere else.
            try {
                await (await driver.$(STATUS_ITEM)).click();
                await demo.fail('click() on a menu item', 'no error — where did the click go?');
            } catch (err) {
                const msg = errMsg(err);
                if (msg.includes('windows: invoke')) {
                    demo.record('click() on a menu item', 'PASS', `refused: ${msg}`);
                } else {
                    await demo.fail('click() on a menu item', `unexpected error: ${msg}`);
                }
            }

            // 2. windows: invoke selects it → the status popup.
            const popup = await demo.openPopup(STATUS_ITEM, 'System → Status... (windows: invoke)', POPUP_TITLE, 10_000, 'invoke');
            if (popup) {
                // 3. Client and user of this session.
                try {
                    const client = await (await driver.$(CLIENT_FIELD)).getText();
                    const user = await (await driver.$(USER_FIELD)).getText();
                    const detail = `client "${client}", user "${user}"`;
                    if (client === CLIENT && user === USER) {demo.record('Client and user', 'PASS', detail);} else {await demo.fail('Client and user', detail);}
                } catch (err) {
                    await demo.fail('Client and user', errMsg(err));
                }

                // 4. Close it with Continue, back to the main window.
                try {
                    await demo.pause();
                    await (await driver.$(CONTINUE_BUTTON)).click();
                    const closed = await driver.waitUntil(
                        async () => !(await driver.getWindowHandles()).includes(popup),
                        { timeout: 10_000 }).then(() => true, () => false);
                    await driver.switchToWindow(demo.mainWindow);
                    if (closed) {demo.record('Close popup (Continue)', 'PASS', 'popup closed');} else {await demo.fail('Close popup (Continue)', 'popup still open');}
                } catch (err) {
                    await demo.fail('Close popup (Continue)', errMsg(err));
                }
            }
        } catch (err) {
            await demo.fail('Menu flow', errMsg(err));
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
