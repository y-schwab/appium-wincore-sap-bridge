// Post-publish tidy for native/plugin/:
//  - the shared contract assembly must NOT ship in the plugin folder (the host's
//    PluginLoadContext pins "WincoreServerSdk" to its own already-loaded copy);
//    strip it if a publish dragged it in.
//  - make sure plugin.json is present (it is source-controlled, but a clean
//    `dotnet publish -o` into an empty dir would omit it).
const fs = require('node:fs');
const path = require('node:path');

const pluginDir = path.join(__dirname, '..', 'native', 'plugin');

for (const stray of ['WincoreServerSdk.dll', 'WincoreServerSdk.pdb']) {
    const p = path.join(pluginDir, stray);
    if (fs.existsSync(p)) {
        fs.rmSync(p);
        console.log(`removed ${stray} from plugin payload (host provides it)`);
    }
}

const manifest = path.join(pluginDir, 'plugin.json');
if (!fs.existsSync(manifest)) {
    fs.writeFileSync(manifest, JSON.stringify({
        name: 'sap-bridge',
        entry: 'WincoreSapBridge.dll',
        type: 'Wincore.SapBridge.Plugin',
        sdkVersion: '1.0.0',
    }, null, 2) + '\n');
    console.log('regenerated plugin.json');
}
