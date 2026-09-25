import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: edit & save round trip in SU3 (Maintain Own User Data — only touches the
 * logged-in user), including the "save changes?" popup (wnd[1]). Built step by step:
 * each step captures the screen it lands on, the next one is written from what SAP
 * actually showed.
 *
 *   Step 1 (this version): /nSU3 → capture the screen (tabs, fields, buttons).
 *   Next: change a field, leave without saving → popup; handle it; save; restore.
 *
 * Ends with /n back to SAP Easy Access. Nothing is changed yet.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-su3/: SUMMARY.md, page source of each explored
 * screen, plus the page source of the screen a step failed on (failed-<step>.xml).
 */
const demo = new SapDemo('sap-demo-su3', 'SAP demo: SU3 own user data');

describe('sap demo: SU3', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('opens own user data from SAP Easy Access', async () => {
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        if (await demo.runTransaction('/nSU3', 'Open SU3')) {
            try {
                await demo.captureScreen('SU3', '01-page-source-su3.xml');
            } catch (err) {
                await demo.fail('SU3 screen', errMsg(err));
            }
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
