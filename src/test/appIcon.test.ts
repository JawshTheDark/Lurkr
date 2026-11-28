// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppIconPath, shouldSetMacDockIcon } from '../../electron/appIcon';

describe('macOS and desktop icon resolution', () => {
  it('never overrides Dock or window icons on packaged macOS builds', () => {
    expect(shouldSetMacDockIcon('darwin', true)).toBe(false);
    expect(
      resolveAppIconPath({
        platform: 'darwin',
        isPackaged: true,
        baseDir: '/Applications/Lurkr.app/Contents/Resources/app.asar/dist-electron',
        resourcesPath: '/Applications/Lurkr.app/Contents/Resources',
        exists: () => true,
      }),
    ).toBeUndefined();
  });

  it('uses the padded squircle dock icon for unpackaged macOS dev runs', () => {
    expect(shouldSetMacDockIcon('darwin', false)).toBe(true);
    const resolved = resolveAppIconPath({
      platform: 'darwin',
      isPackaged: false,
      baseDir: '/repo/dist-electron',
      exists: (candidate) => candidate.endsWith(path.join('build', 'lurker-dock-dev.png')),
    });
    expect(resolved).toBe(path.join('/repo/build', 'lurker-dock-dev.png'));
  });

  it('keeps resolving packaged icons normally on Windows and Linux', () => {
    expect(shouldSetMacDockIcon('win32', false)).toBe(false);
    expect(shouldSetMacDockIcon('linux', false)).toBe(false);

    expect(
      resolveAppIconPath({
        platform: 'win32',
        isPackaged: true,
        baseDir: 'C:\\Program Files\\Lurkr\\resources\\app.asar\\dist-electron',
        resourcesPath: 'C:\\Program Files\\Lurkr\\resources',
        arch: 'x64',
        exists: (candidate) => candidate.endsWith('lurker-icon.ico'),
      }),
    ).toContain('lurker-icon.ico');

    expect(
      resolveAppIconPath({
        platform: 'linux',
        isPackaged: true,
        baseDir: '/opt/Lurkr/resources/app.asar/dist-electron',
        resourcesPath: '/opt/Lurkr/resources',
        arch: 'x64',
        exists: (candidate) => candidate.endsWith('lurker-icon-512.png'),
      }),
    ).toContain('lurker-icon-512.png');
  });
});
