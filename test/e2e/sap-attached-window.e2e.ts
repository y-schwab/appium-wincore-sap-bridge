import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * End-to-end check of the tree provider against an already logged-in SAP window.
 *
 * Precondition: a SAP connection is open and logged in (any screen, e.g. SAP Easy
 * Access). The test does not open or log into anything itself.
 *
 * Flow: find the logged-in SAP window by title → switch to it → page source (UIA)
 * → attach → page source (SAP tree) → find by accessibility id / xpath / class name
 * → element commands on the command field → detach → page source (UIA again).
 *
 * Every step is recorded instead of failing fast, so a single run leaves the full
 * picture in test-output/attached-window/ — SUMMARY.md first, then the numbered
 * dumps. The test fails at the end if any check failed.
 *
 * Env:
 *   SAP_WINDOW_TITLE  partial title of the logged-in window, matched via
 *                     `windows: switchToWindowByTitle` (default: "SAP Easy")
 */
const OUTPUT_DIR = resolve(process.cwd(), 'test-output', 'attached-window');
const WINDOW_TITLE = process.env.SAP_WINDOW_TITLE ?? 'SAP Easy';

// Command field — present on every SAP GUI screen, safe to type into without pressing Enter.
const OKCODE_ID = 'wnd[0]/tbar[0]/okcd';
const OKCODE_PROBE = 'ZZ_E2E_PROBE';

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'INFO';

interface Check {
    step: string;
    status: Status;
    detail: string;
}

const checks: Check[] = [];

function save(name: string, content: unknown): void {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    writeFileSync(resolve(OUTPUT_DIR, name), text, 'utf8');
}

function record(step: string, status: Status, detail: string): void {
    checks.push({ step, status, detail });
    writeReport();
}

/** Rewritten after every check, so a crash midway still leaves everything seen so far. */
function writeReport(): void {
    save('report.json', checks);
    const icon: Record<Status, string> = { PASS: '✅', FAIL: '❌', SKIP: '⏭️', INFO: 'ℹ️' };
    const counts = (['PASS', 'FAIL', 'SKIP'] as Status[])
        .map((s) => `${s}: ${checks.filter((c) => c.status === s).length}`)
        .join(' · ');
    const lines = [
        '# SAP attached-window e2e',
        '',
        `Run: ${new Date().toISOString()}  `,
        counts,
        '',
        '| # | Status | Step | Detail |',
        '| --- | --- | --- | --- |',
        ...checks.map((c, i) =>
            `| ${i + 1} | ${icon[c.status]} ${c.status} | ${c.step} | ${c.detail.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')} |`),
        '',
    ];
    save('SUMMARY.md', lines.join('\n'));
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Distinct SAP `Type` tags in a page source, with counts — the quickest tell of which tree served it. */
function guiTagSummary(xml: string): { total: number; tags: Record<string, number> } {
    const tags: Record<string, number> = {};
    for (const m of xml.matchAll(/<(Gui\w+|GridRow|GridCell|TreeNode)\b/g)) {
        tags[m[1]] = (tags[m[1]] ?? 0) + 1;
    }
    return { total: Object.values(tags).reduce((a, b) => a + b, 0), tags };
}

function rootTag(xml: string): string {
    return xml.match(/<([A-Za-z]\w*)/)?.[1] ?? '(none)';
}

interface AttachResult {
    attached?: boolean;
    reason?: string;
    windowHandles?: string[];
    [key: string]: unknown;
}

describe('sap-bridge attached window', () => {
    let driver: Browser;

    /** Driver's substring title match — polls briefly, throws NoSuchWindowError if nothing matches. */
    async function switchToSapWindow(): Promise<void> {
        await driver.executeScript('windows: switchToWindowByTitle', [{ title: WINDOW_TITLE }]);
    }

    beforeAll(async () => {
        rmSync(OUTPUT_DIR, { recursive: true, force: true });
        mkdirSync(OUTPUT_DIR, { recursive: true });
        driver = await createSapGuiSession();
    });

    afterAll(async () => {
        // Best-effort: never leave the provider owning the window for the next session.
        try { await driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(driver);
    });

    it('serves standard WebDriver from the SAP tree once attached', async () => {
        // 1. Switch to the logged-in SAP window by (partial) title.
        const rootHandle = await driver.getWindowHandle();
        const handles = await driver.getWindowHandles();
        save('00-windows.json', { rootHandle, handles, titleMatch: WINDOW_TITLE });
        record('Session root', 'INFO', `root ${rootHandle}; handles ${JSON.stringify(handles)}`);

        let target: { handle: string; title: string };
        try {
            await switchToSapWindow();
            target = { handle: await driver.getWindowHandle(), title: await driver.getTitle() };
        } catch (err) {
            record(`Switch to window by title "${WINDOW_TITLE}"`, 'FAIL',
                `${errMsg(err)} — is a SAP connection open and logged in? (or set SAP_WINDOW_TITLE)`);
            expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
            return;
        }
        record(`Switch to window by title "${WINDOW_TITLE}"`, 'PASS', `${target.handle} "${target.title}"`);

        // 2. Page source before attach — UIA, expected to show no SAP Type tags.
        const before = await driver.getPageSource();
        save('01-sap-window-before-attach.xml', before);
        const beforeGui = guiTagSummary(before);
        record('Page source before attach is UIA', beforeGui.total === 0 ? 'PASS' : 'FAIL',
            `${before.length} chars, root <${rootTag(before)}>, Gui* tags: ${beforeGui.total}`);

        // 3. Attach. Retry only on throw (COM moniker can lag); record whatever comes back.
        let attach: AttachResult = {};
        const deadline = Date.now() + 20_000;
        while (true) {
            try {
                attach = await driver.executeScript('windows: attachSapGui', [{}]) as AttachResult;
                break;
            } catch (err) {
                attach = { error: errMsg(err) };
                if (Date.now() > deadline) {break;}
                await delay(1000);
            }
        }
        save('02-attach-result.json', attach);
        if (!attach.attached) {
            record('Attach', 'FAIL', `attached=${attach.attached}; reason=${attach.reason ?? attach.error ?? 'unknown'}`);
            expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
            return;
        }
        record('Attach', 'PASS', `windowHandles=${JSON.stringify(attach.windowHandles)}`);

        // 4. The provider owns windows by handle — the window we're on must be one of them.
        const owned = (attach.windowHandles ?? []).map((h) => h.toLowerCase());
        record('Target handle is in attach windowHandles',
            owned.includes(target.handle.toLowerCase()) ? 'PASS' : 'FAIL',
            `target ${target.handle} vs ${JSON.stringify(attach.windowHandles)}`);

        // 5. Page source after attach, without re-switching — should now come from the SAP tree.
        const after = await driver.getPageSource();
        save('03-sap-window-after-attach.xml', after);
        const afterGui = guiTagSummary(after);
        record('Page source after attach is SAP tree (same handle, no re-switch)', afterGui.total > 0 ? 'PASS' : 'FAIL',
            `${after.length} chars, root <${rootTag(after)}>, Gui* tags: ${afterGui.total} ${JSON.stringify(afterGui.tags)}`);

        // 5b. Same after an explicit re-switch — tells a routing bug apart from a stale-root one.
        await switchToSapWindow();
        const afterSwitch = await driver.getPageSource();
        save('04-sap-window-after-attach-reswitch.xml', afterSwitch);
        const afterSwitchGui = guiTagSummary(afterSwitch);
        record('Page source after attach is SAP tree (after re-switch)', afterSwitchGui.total > 0 ? 'PASS' : 'FAIL',
            `${afterSwitch.length} chars, root <${rootTag(afterSwitch)}>, Gui* tags: ${afterSwitchGui.total}`);

        // 6. Standard locators served from the SAP tree.
        const found: Record<string, unknown> = {};
        let okcodeId: string | undefined;
        try {
            const el = await driver.findElement('accessibility id', OKCODE_ID);
            okcodeId = Object.values(el)[0] as string;
            found.accessibilityId = okcodeId;
            record(`Find ~${OKCODE_ID}`, okcodeId?.startsWith('sap:') ? 'PASS' : 'FAIL', `element id ${okcodeId}`);
        } catch (err) {
            found.accessibilityId = { error: errMsg(err) };
            record(`Find ~${OKCODE_ID}`, 'FAIL', errMsg(err));
        }

        for (const [label, using, value] of [
            ['xpath //GuiButton', 'xpath', '//GuiButton'],
            ['class name GuiTextField', 'class name', 'GuiTextField'],
            ['xpath //GuiOkCodeField', 'xpath', '//GuiOkCodeField'],
        ] as const) {
            try {
                const els = await driver.findElements(using, value);
                const ids = els.map((e) => Object.values(e)[0] as string);
                found[label] = ids;
                const allSap = ids.length > 0 && ids.every((id) => id.startsWith('sap:'));
                record(`Find ${label}`, allSap ? 'PASS' : 'FAIL',
                    `${ids.length} found${ids.length ? `, first id ${ids[0]}` : ''}`);
            } catch (err) {
                found[label] = { error: errMsg(err) };
                record(`Find ${label}`, 'FAIL', errMsg(err));
            }
        }
        save('05-find-results.json', found);

        // 7. Element commands through the sap: prefix — write, read back, clear. No Enter is sent.
        const interaction: Record<string, unknown> = {};
        if (okcodeId) {
            try {
                interaction.initialText = await driver.getElementText(okcodeId);
                await driver.elementClear(okcodeId);
                await driver.elementSendKeys(okcodeId, OKCODE_PROBE);
                const readBack = await driver.getElementText(okcodeId);
                interaction.readBack = readBack;
                record('setValue + getText on command field', readBack === OKCODE_PROBE ? 'PASS' : 'FAIL',
                    `wrote "${OKCODE_PROBE}", read "${readBack}"`);
            } catch (err) {
                interaction.error = errMsg(err);
                record('setValue + getText on command field', 'FAIL', errMsg(err));
            }
            try {
                await driver.elementClear(okcodeId);
                const cleared = await driver.getElementText(okcodeId);
                interaction.afterClear = cleared;
                record('clear on command field', cleared === '' ? 'PASS' : 'FAIL', `read "${cleared}" after clear`);
            } catch (err) {
                interaction.clearError = errMsg(err);
                record('clear on command field', 'FAIL', errMsg(err));
            }
        } else {
            record('setValue + getText on command field', 'SKIP', 'command field not found');
        }
        save('06-interaction.json', interaction);

        // 8. Detach — provider should release the window, page source back to UIA.
        try {
            const detach = await driver.executeScript('windows: detachSapGui', []);
            save('07-detach-result.json', detach ?? null);
            await switchToSapWindow();
            const afterDetach = await driver.getPageSource();
            save('08-sap-window-after-detach.xml', afterDetach);
            const detachGui = guiTagSummary(afterDetach);
            record('Page source after detach is UIA again', detachGui.total === 0 ? 'PASS' : 'FAIL',
                `${afterDetach.length} chars, root <${rootTag(afterDetach)}>, Gui* tags: ${detachGui.total}`);
        } catch (err) {
            record('Detach', 'FAIL', errMsg(err));
        }

        expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    }, 120_000);
});
