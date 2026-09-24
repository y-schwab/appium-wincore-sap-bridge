import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Attach against an already logged-in SAP window.
 *
 * Precondition: a SAP connection is open and logged in (e.g. SAP Easy Access). The
 * test does not open or log into anything itself.
 *
 * Flow: switch to the SAP window by title → attach → page source (should now be the
 * SAP tree) → if the screen has a tree (SAP Easy Access does): expand a collapsed
 * folder and select one of its children. Output in test-output/attached-window/:
 * SUMMARY.md, 01-attach-result.json (includes per-connection diagnostics when attach
 * fails), 02-page-source-after-attach.xml and 03-page-source-after-expand.xml.
 *
 * Env:
 *   SAP_WINDOW_TITLE  partial title of the logged-in window, matched via
 *                     `windows: switchToWindowByTitle` (default: "SAP Easy")
 */
const OUTPUT_DIR = resolve(process.cwd(), 'test-output', 'attached-window');
const WINDOW_TITLE = process.env.SAP_WINDOW_TITLE ?? 'SAP Easy';

type Status = 'PASS' | 'FAIL' | 'INFO';

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
    const icon: Record<Status, string> = { PASS: '✅', FAIL: '❌', INFO: 'ℹ️' };
    const lines = [
        '# SAP attached-window e2e',
        '',
        `Run: ${new Date().toISOString()}  `,
        `PASS: ${checks.filter((c) => c.status === 'PASS').length} · FAIL: ${checks.filter((c) => c.status === 'FAIL').length}`,
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
    message?: string;
    windowHandles?: string[];
    connections?: unknown[];
    [key: string]: unknown;
}

/**
 * Finds a collapsed folder by XPath, expands it with `windows: expand` and checks its
 * children show up in page source; then selects the first child. Leaves the folder
 * expanded (the driver has no provider-routed collapse) — the next run picks another.
 */
async function checkTreeExpand(driver: Browser, tree: string): Promise<void> {
    const folder = await driver.$(`${tree}//TreeNode[@IsFolder='True' and @IsExpanded='False']`);
    if (!(await folder.isExisting())) {
        record('Find collapsed folder by XPath', 'INFO', 'no collapsed folder left in the tree — expand check skipped');
        return;
    }
    const folderId = await folder.elementId;
    const key = await folder.getAttribute('Key');
    const text = await folder.getText();
    record('Find collapsed folder by XPath', 'PASS', `"${text}" key=${key} id=${folderId}`);

    const childXPath = `${tree}//TreeNode[@Key='${key}']/TreeNode`;
    const before = (await driver.$$(childXPath)).length;
    record('Collapsed folder shows no children', before === 0 ? 'PASS' : 'FAIL', `${before} child TreeNode(s)`);

    try {
        await driver.executeScript('windows: expand', [{ elementId: folderId }]);
    } catch (err) {
        record('windows: expand on folder', 'FAIL', errMsg(err));
        return;
    }
    const state = await folder.getAttribute('ExpandCollapseState');
    record('windows: expand on folder', state === 'Expanded' ? 'PASS' : 'FAIL', `ExpandCollapseState=${state}`);

    const expanded = await driver.getPageSource();
    save('03-page-source-after-expand.xml', expanded);
    const children = await driver.$$(childXPath);
    // Sequential: WDIO's ElementArray.map returns a promise, not an array.
    const childTexts: string[] = [];
    for (const c of children) {childTexts.push(await c.getText());}
    record('Expanded folder shows its children', children.length > 0 ? 'PASS' : 'FAIL',
        `${children.length} child TreeNode(s): ${JSON.stringify(childTexts)}`);
    if (children.length === 0) {return;}

    // Select only — windows: invoke would double-click and start the transaction.
    const child = children[0];
    try {
        await driver.executeScript('windows: select', [{ elementId: await child.elementId }]);
        const selected = await child.getAttribute('IsSelected');
        record('windows: select on child node', String(selected).toLowerCase() === 'true' ? 'PASS' : 'FAIL',
            `"${childTexts[0]}" IsSelected=${selected}`);
    } catch (err) {
        record('windows: select on child node', 'FAIL', errMsg(err));
    }
}

describe('sap-bridge attached window', () => {
    let driver: Browser;

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

    it('serves page source from the SAP tree once attached', async () => {
        // 1. Switch to the logged-in SAP window by (partial) title.
        let target: { handle: string; title: string };
        try {
            await driver.executeScript('windows: switchToWindowByTitle', [{ title: WINDOW_TITLE }]);
            target = { handle: await driver.getWindowHandle(), title: await driver.getTitle() };
        } catch (err) {
            record(`Switch to window by title "${WINDOW_TITLE}"`, 'FAIL',
                `${errMsg(err)} — is a SAP connection open and logged in? (or set SAP_WINDOW_TITLE)`);
            expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
            return;
        }
        record(`Switch to window by title "${WINDOW_TITLE}"`, 'INFO', `${target.handle} "${target.title}"`);

        // 2. Attach. Retry only on throw (COM moniker can lag); record whatever comes back.
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
        save('01-attach-result.json', attach);
        if (!attach.attached) {
            record('Attach', 'FAIL', `reason=${attach.reason ?? attach.error ?? 'unknown'}${attach.message ? ` — ${attach.message}` : ''}`);
            for (const con of attach.connections ?? []) {
                record('Connection seen by scripting engine', 'INFO', JSON.stringify(con));
            }
            expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
            return;
        }
        record('Attach', 'PASS', `system=${attach.system}; sessionInfo=${JSON.stringify(attach.sessionInfo)}`);

        // The provider owns windows by handle — the window we're on must be one of them.
        const owned = (attach.windowHandles ?? []).map((h) => h.toLowerCase());
        record('Target handle is in attach windowHandles',
            owned.includes(target.handle.toLowerCase()) ? 'PASS' : 'FAIL',
            `target ${target.handle} vs ${JSON.stringify(attach.windowHandles)}`);

        // 3. Page source after attach — should now come from the SAP tree.
        const after = await driver.getPageSource();
        save('02-page-source-after-attach.xml', after);
        const afterGui = guiTagSummary(after);
        record('Page source after attach is SAP tree', afterGui.total > 0 ? 'PASS' : 'FAIL',
            `${after.length} chars, root <${rootTag(after)}>, Gui* tags: ${afterGui.total} ${JSON.stringify(afterGui.tags)}`);

        // 4. Tree nodes: nested under their parents, collapsed folders hide their children.
        const TREE = "//GuiShell[@SubType='Tree']";
        if (!after.includes('SubType="Tree"')) {
            record('Tree nodes', 'INFO', 'no SubType="Tree" shell on this screen — tree checks skipped');
        } else {
            record('Tree nodes are nested', /<TreeNode\b[^>]*[^/]>\s*<TreeNode\b/.test(after) ? 'PASS' : 'FAIL',
                'expected at least one TreeNode inside another (children of an expanded folder)');
            try {
                await checkTreeExpand(driver, TREE);
            } catch (err) {
                record('Tree expand checks', 'FAIL', `threw: ${errMsg(err)}`);
            }
        }

        expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    }, 90_000);
});
