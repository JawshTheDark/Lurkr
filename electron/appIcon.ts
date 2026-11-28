// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs';
import path from 'node:path';

export interface AppIconResolveOptions {
  platform?: NodeJS.Platform;
  isPackaged: boolean;
  baseDir: string;
  resourcesPath?: string;
  arch?: string;
  exists?: (candidate: string) => boolean;
}

/**
 * Packaged macOS bundles derive Dock, Finder, and Notification icons natively
 * from Contents/Resources/icon.icns. Overriding Dock with app.dock.setIcon at
 * runtime bypasses macOS squircle sizing and renders a raw oversized square.
 */
export function shouldSetMacDockIcon(
  platform: NodeJS.Platform = process.platform,
  isPackaged: boolean = false,
): boolean {
  return platform === 'darwin' && !isPackaged;
}

/**
 * Resolve the platform-appropriate icon file for BrowserWindow / Notifications /
 * unpackaged macOS dev Dock. Returns undefined for packaged macOS bundles so
 * AppKit keeps using the native .icns resource.
 */
export function resolveAppIconPath({
  platform = process.platform,
  isPackaged,
  baseDir,
  resourcesPath,
  arch = process.arch,
  exists = fs.existsSync,
}: AppIconResolveOptions): string | undefined {
  if (platform === 'darwin' && isPackaged) {
    return undefined;
  }

  const unpackedDirs = resourcesPath
    ? [
        path.join(resourcesPath, `app-${arch}.asar.unpacked`, 'dist'),
        path.join(resourcesPath, 'app.asar.unpacked', 'dist'),
      ]
    : [];
  const prodDist = path.join(baseDir, '../dist');
  const devPublic = path.join(baseDir, '../public');
  const buildDir = path.join(baseDir, '../build');

  if (platform === 'darwin') {
    for (const candidate of [
      path.join(buildDir, 'lurker-dock-dev.png'),
      path.join(devPublic, 'lurker-icon-512.png'),
      path.join(prodDist, 'lurker-icon-512.png'),
    ]) {
      if (exists(candidate)) return candidate;
    }
    return undefined;
  }

  const names =
    platform === 'win32'
      ? ['lurker-icon.ico', 'lurker-icon-512.png']
      : ['lurker-icon-512.png'];

  for (const name of names) {
    for (const dir of [...unpackedDirs, prodDist, devPublic]) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}
