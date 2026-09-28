import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, errMsg } from './helpers/sap-demo.js';

/**
 * GuiMenu: the menu bar, from SAP Easy Access. Built step by step: each step captures
 * what it lands on, the next one is written from what SAP showed.
 *
 *   Step 1    System → Status...: the whole menu tree is in page source without opening
 *             anything (GuiMenubar mbar → GuiMenu menu[n] → menu[n]/menu[m]); items are
 *             found by their text, since their index differs per screen. Menu items
 *             have no screen geometry (-1), so click() must fail with a pointer to
 *             windows: invoke; windows: invoke selects the item → popup "System: Status"
 *             (wnd[1]). Capture it, read client (001) and user (DEVELOPER), close it with
 *             its Continue button (tbar[0]/btn[0]).
 *
 * Ends with /n back to SAP Easy Access. Changes nothing.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/gui-menu/: SUMMARY.md, the popup's page source
 * (status-popup.xml), plus the page source of the screen a step failed on.
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
                await demo.captureScreen('Status popup', 'status-popup.xml');

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
