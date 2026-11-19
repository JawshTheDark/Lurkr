// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment node

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it, expect, afterEach } from 'vitest';
import { buildConvertedFilename, transcodeWebmFile } from '../../electron/transcode';

const execFileAsync = promisify(execFile);

describe('transcodeWebmFile', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('normalizes output filenames cleanly', () => {
    expect(buildConvertedFilename('Screencast_20261118_115849.webm', '.mp4')).toBe(
      'Screencast_20261118_115849.mp4',
    );
    expect(buildConvertedFilename('/home/user/Voice.WEBM', '.m4a')).toBe('Voice.m4a');
  });

  it('converts an odd-dimension VFR WebM screencast into H.264/yuv420p MP4 via ffmpeg', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lurkr-webm-test-'));
    tempDirs.push(dir);
    const inWebm = path.join(dir, 'Screencast_20261118_115849.webm');
    const outCheckMp4 = path.join(dir, 'check.mp4');

    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=0.4:size=321x241:rate=10',
      '-c:v',
      'libvpx',
      inWebm,
    ]);

    const res = await transcodeWebmFile({
      filename: 'Screencast_20261118_115849.webm',
      mime: 'video/webm',
      sourcePath: inWebm,
    });

    if (!res.ok) {
      throw new Error(`Expected transcodeWebmFile to succeed, got: ${res.error}`);
    }
    expect(res.ok).toBe(true);
    expect(res.filename).toBe('Screencast_20261118_115849.mp4');
    expect(res.mime).toBe('video/mp4');
    expect(res.data.byteLength).toBeGreaterThan(200);

    await fs.promises.writeFile(outCheckMp4, res.data);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt,width,height',
      '-of',
      'compact',
      outCheckMp4,
    ]);
    expect(stdout).toContain('codec_name=h264');
    expect(stdout).toContain('pix_fmt=yuv420p');
    expect(stdout).toContain('width=320');
    expect(stdout).toContain('height=240');
  });

  it('returns an explicit error when payload is empty', async () => {
    const res = await transcodeWebmFile({
      filename: 'empty.webm',
      mime: 'video/webm',
      data: new Uint8Array(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Empty WebM/i);
    }
  });
});
