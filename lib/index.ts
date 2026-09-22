import { BasePlugin } from 'appium/plugin';
import type { ExecuteMethodMap, ExternalDriver, NextPluginCallback } from '@appium/types';
import { join } from 'node:path';
import {
    attachSapGui,
    detachSapGui,
    sapGuiStatus,
    sapPageSource,
    sapFindElement,
    sapEvaluateXPath,
    sapGetProperty,
    sapGetText,
    sapGetTagName,
    sapGetRect,
    sapSetValue,
    sapInvoke,
    sapSetFocus,
    sapSelect,
    sapSendVKey,
} from './commands.js';

/**
 * The real work of this bridge is a WincoreServer tree-provider plugin
 * (`native/plugin/WincoreSapBridge.dll`). It is made discoverable by appending its
 * folder to `WINCORE_SERVER_PLUGINS` here, at module load — which happens once when
 * Appium boots an enabled plugin, before any session spawns a server, so the server
 * inherits the variable.
 *
 * `__dirname` at runtime is `build/lib/`, so the payload sits three levels up.
 */
const PLUGIN_NATIVE_DIR = join(__dirname, '..', '..', 'native', 'plugin');
const existing = process.env.WINCORE_SERVER_PLUGINS;
process.env.WINCORE_SERVER_PLUGINS =
    existing && existing.length > 0 ? `${existing};${PLUGIN_NATIVE_DIR}` : PLUGIN_NATIVE_DIR;

export class SapBridgePlugin extends BasePlugin {
    static override executeMethodMap: ExecuteMethodMap<SapBridgePlugin> = {
        'windows: attachSapGui': { command: 'attachSapGui', params: { optional: ['connectionIndex', 'sessionIndex'] } },
        'windows: detachSapGui': { command: 'detachSapGui' },
        'windows: sapGuiStatus': { command: 'sapGuiStatus' },
        'windows: sapPageSource': { command: 'sapPageSource', params: { optional: ['contextElementId'] } },
        'windows: sapFindElement': { command: 'sapFindElement', params: { required: ['id'] } },
        'windows: sapEvaluateXPath': {
            command: 'sapEvaluateXPath',
            params: { required: ['expression'], optional: ['multiple', 'contextElementId'] },
        },
        'windows: sapGetProperty': { command: 'sapGetProperty', params: { required: ['elementId', 'property'] } },
        'windows: sapGetText': { command: 'sapGetText', params: { required: ['elementId'] } },
        'windows: sapGetTagName': { command: 'sapGetTagName', params: { required: ['elementId'] } },
        'windows: sapGetRect': { command: 'sapGetRect', params: { required: ['elementId'] } },
        'windows: sapSetValue': { command: 'sapSetValue', params: { required: ['elementId', 'value'] } },
        'windows: sapInvoke': { command: 'sapInvoke', params: { required: ['elementId'] } },
        'windows: sapSetFocus': { command: 'sapSetFocus', params: { required: ['elementId'] } },
        'windows: sapSelect': { command: 'sapSelect', params: { required: ['elementId'] } },
        'windows: sapSendVKey': { command: 'sapSendVKey', params: { required: ['vkey'], optional: ['windowElementId'] } },
    };

    attachSapGui = attachSapGui;
    detachSapGui = detachSapGui;
    sapGuiStatus = sapGuiStatus;
    sapPageSource = sapPageSource;
    sapFindElement = sapFindElement;
    sapEvaluateXPath = sapEvaluateXPath;
    sapGetProperty = sapGetProperty;
    sapGetText = sapGetText;
    sapGetTagName = sapGetTagName;
    sapGetRect = sapGetRect;
    sapSetValue = sapSetValue;
    sapInvoke = sapInvoke;
    sapSetFocus = sapSetFocus;
    sapSelect = sapSelect;
    sapSendVKey = sapSendVKey;

    /**
     * Appium's plugin dispatcher only gives a plugin a turn for the classic
     * `execute`/`executeScript` endpoint if the instance defines an `execute`
     * method; `BasePlugin` implements only `executeMethod`. Delegating into the
     * inherited `executeMethod` (which does the `executeMethodMap` lookup and calls
     * `next()` for anything it does not recognise) is what makes the command
     * reachable. Same shim as the sibling appium-wincore-java-bridge / dotnet-bridge
     * / uia-bridge plugins.
     */
    async execute(next: NextPluginCallback, driver: ExternalDriver, script: string, args: unknown[]): Promise<unknown> {
        return await this.executeMethod(next, driver, script, args as [Record<string, unknown>]);
    }
}

export default SapBridgePlugin;
