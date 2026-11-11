// electron-builder afterPack hook (electron-builder.yml): runs on the packed app before the
// fuses and the signature, so the signed bundle carries this Info.plist.
//
// macOS only. electron-builder sets NSAppTransportSecurity.NSAllowsArbitraryLoads to true after
// it applies mac.extendInfo, so the key is rewritten here to false. The page talks only to the
// app's own loopback bridge, through Chromium's network stack, which App Transport Security
// does not govern; NSAllowsLocalNetworking and the loopback exceptions stay as they are.
// Then the hook checks the result and fails the build if any declared device use survived.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** usage strings the app must never declare: it asks for no device */
export const FORBIDDEN_USAGE = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSAudioCaptureUsageDescription',
];

const plutil = (...args) => execFileSync('/usr/bin/plutil', args, { encoding: 'utf8' });

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return;
  const plist = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist');
  plutil('-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'NO', plist);
  const info = JSON.parse(plutil('-convert', 'json', '-o', '-', plist));
  const left = FORBIDDEN_USAGE.filter((k) => k in info);
  if (left.length) throw new Error(`Info.plist still declares ${left.join(', ')}`);
  if (info.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== false) throw new Error('Info.plist: NSAllowsArbitraryLoads is not false');
  console.log(`  • afterPack: ${path.basename(path.dirname(path.dirname(plist)))} Info.plist: no device usage, NSAllowsArbitraryLoads false`);
}
