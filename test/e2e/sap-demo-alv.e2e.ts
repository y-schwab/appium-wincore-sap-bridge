import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, errMsg, shortId } from './helpers/sap-demo.js';

/**
 * Demo: ALV grid. SE16N doesn't exist on this system, and SE16 shows a classic list for
 * this user — its output format is a per-user setting in SE16's "User Parameters"
 * popup (list vs. ALV grid). So this test switches it to ALV grid through that popup
 * (exercising popups, wnd[1], on the way), reads T000 from the grid, and switches it
 * back at the end. Built step by step: each step captures the screen it lands on, the
 * next one is written from what SAP actually showed.
 *
 *   Step 1 (this version): /nSE16 → User Parameters (F6) → capture the popup →
 *   close it with its Cancel button, changing nothing.
 *   Next: pick "ALV Grid display" in the popup, T000 → Execute → grid; restore.
 *
 * Ends with /n back to SAP Easy Access.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-alv/: SUMMARY.md, page source of each explored
 * screen, plus the page source of the screen a step failed on (failed-<step>.xml).
 */
const USER_PARAMETERS_BUTTON = '~wnd[0]/tbar[1]/btn[6]'; // "User Parameters... (F6)", SE16 initial screen

const demo = new SapDemo('sap-demo-alv', 'SAP demo: SE16 ALV grid');

describe('sap demo: SE16 ALV grid', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('shows table T000 in an ALV grid', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        try {
            const popup = await demo.runTransaction('/nSE16', 'Open SE16', 'Data Browser')
                && await demo.openPopup(USER_PARAMETERS_BUTTON, 'User Parameters → popup');
            if (popup) {
                await demo.captureScreen('User Parameters popup', '01-page-source-user-parameters.xml');

                // Close without changing anything — the popup's own Cancel button, found by tooltip.
                const cancel = await driver.$("//GuiButton[starts-with(@Tooltip,'Cancel')]");
                if (await cancel.isExisting()) {
                    const id = shortId(await cancel.elementId);
                    await cancel.click();
                    const closed = await driver.waitUntil(
                        async () => !(await driver.getWindowHandles()).includes(popup),
                        { timeout: 10_000 }).then(() => true, () => false);
                    demo.record('Cancel popup', closed ? 'PASS' : 'FAIL', `${id}; popup ${closed ? 'closed' : 'still open'}`);
                } else {
                    demo.record('Cancel popup', 'FAIL', 'no button with tooltip "Cancel…" in the popup — see buttons above');
                }
            }
        } catch (err) {
            await demo.fail('SE16 user parameters', errMsg(err));
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
