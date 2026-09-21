import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Find / read / write against the SAP Logon screen — the one screen guaranteed to be
 * up right after `sap.attach`, with well-known, version-stable field ids (the same
 * ones any SAP GUI Scripting recording produces). Basic smoke coverage: is each verb
 * wired end to end at all, not full behavioral coverage of every GuiComponent type —
 * expand per-control-type cases once this is green against a real backend.
 *
 * Needs SAP Logon running, attached at the login screen (client/user/password/language
 * fields empty or already-attempted — this suite only reads and restores, never
 * submits). Skipped by default; set RUN_SAP_E2E=1 once a live backend is available.
 */
const LOGIN_USER_FIELD = 'wnd[0]/usr/txtRSYST-BNAME';
const LOGIN_CLIENT_FIELD = 'wnd[0]/usr/txtRSYST-MANDT';

describe.skipIf(!process.env.RUN_SAP_E2E)('sap-bridge interaction', () => {
    let driver: Browser;
    let attached = false;

    beforeAll(async () => {
        driver = await createSapGuiSession();
        const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]) as { attached: boolean };
        attached = status.attached;
    });

    afterAll(async () => {
        await quitSession(driver);
    });

    it('sap.pageSource returns a non-empty tree rooted at the active window', async () => {
        if (!attached) {return;}
        const xml = await driver.executeScript('windows: sapPageSource', []) as string;
        expect(xml).toContain('<');
        expect(xml).toMatch(/Type="Gui\w+"/);
    });

    it('sap.findElement resolves a known field id to a sap:-prefixed element', async () => {
        if (!attached) {return;}
        const id = await driver.executeScript('windows: sapFindElement', [LOGIN_USER_FIELD]) as string | null;
        expect(id).toMatch(/^sap:/);
    });

    it('sap.findElement returns null for an id that does not exist', async () => {
        if (!attached) {return;}
        const id = await driver.executeScript('windows: sapFindElement', ['wnd[0]/usr/doesNotExist']) as string | null;
        expect(id).toBeNull();
    });

    it('sap.getProperty / sap.getText / sap.getTagName / sap.getRect all resolve the same element', async () => {
        if (!attached) {return;}
        const id = await driver.executeScript('windows: sapFindElement', [LOGIN_USER_FIELD]) as string;

        const type = await driver.executeScript('windows: sapGetProperty', [id, 'Type']);
        expect(type).toBe('GuiTextField');

        const tagName = await driver.executeScript('windows: sapGetTagName', [id]);
        expect(tagName).toBe('GuiTextField');

        await driver.executeScript('windows: sapGetText', [id]); // just must not throw

        const rect = await driver.executeScript('windows: sapGetRect', [id]) as { x: number; y: number; width: number; height: number };
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
    });

    it('sap.setValue writes a value that sap.getText reads back, and restores it', async () => {
        if (!attached) {return;}
        const id = await driver.executeScript('windows: sapFindElement', [LOGIN_USER_FIELD]) as string;
        const original = await driver.executeScript('windows: sapGetText', [id]) as string;

        try {
            await driver.executeScript('windows: sapSetValue', [id, 'wincore-e2e']);
            const written = await driver.executeScript('windows: sapGetText', [id]);
            expect(written).toBe('wincore-e2e');
        } finally {
            await driver.executeScript('windows: sapSetValue', [id, original]);
        }
    });

    it('sap.setFocus / sap.select do not throw against an interactive field', async () => {
        if (!attached) {return;}
        const id = await driver.executeScript('windows: sapFindElement', [LOGIN_CLIENT_FIELD]) as string;
        await driver.executeScript('windows: sapSetFocus', [id]);
    });

    it('sap.evaluateXPath finds the same field by attribute, matching sap.findElement', async () => {
        if (!attached) {return;}
        const byId = await driver.executeScript('windows: sapFindElement', [LOGIN_USER_FIELD]) as string;
        // `Id` (the SAP-canonical, GetProperty-readable form) is the full absolute path —
        // e.g. "/app/con[0]/ses[0]/wnd[0]/usr/txtRSYST-BNAME" — even though FindById also
        // accepts the short session-relative form used above. Read it back rather than
        // assuming the two strings match.
        const fullId = await driver.executeScript('windows: sapGetProperty', [byId, 'Id']) as string;
        const byXPath = await driver.executeScript(
            'windows: sapEvaluateXPath',
            ['//*[@Id="' + fullId + '"]', false],
        ) as string | null;
        expect(byXPath).toBe(byId);
    });

    it('sap.evaluateXPath with multiple=true returns every GuiTextField on the login screen', async () => {
        if (!attached) {return;}
        const ids = await driver.executeScript('windows: sapEvaluateXPath', ['//GuiTextField', true]) as string[];
        expect(Array.isArray(ids)).toBe(true);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every((id) => id.startsWith('sap:'))).toBe(true);
    });
});
