// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TranscodeWebmRequest {
  filename: string;
  mime?: string;
  sourcePath?: string;
  data?: Uint8Array;
}

export type TranscodeWebmResult =
  | {
      ok: true;
      data: Uint8Array;
      mime: string;
      filename: string;
    }
  | {
      ok: false;
      error: string;
      missingFfmpeg?: boolean;
    };

const PROBE_TIMEOUT_MS = 15_000;
const TRANSCODE_TIMEOUT_MS = 300_000;
const MAX_STDIO_BYTES = 10 * 1024 * 1024;

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        env: opts.env,
        timeout: opts.timeout,
        maxBuffer: MAX_STDIO_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const enriched = err as Error & { code?: string | number; stderr?: string };
          enriched.stderr = stderr;
          reject(enriched);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function detectStreams(
  inputPath: string,
  mime: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  const baseMime = (mime || '').split(';')[0].trim().toLowerCase();
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        inputPath,
      ],
      { env, timeout: PROBE_TIMEOUT_MS },
    );
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    return {
      hasVideo: lines.includes('video'),
      hasAudio: lines.includes('audio'),
    };
  } catch (err: unknown) {
    const code = (err as { code?: string | number } | null)?.code;
    if (code === 'ENOENT') {
      const audioOnly = baseMime === 'audio/webm';
      return { hasVideo: !audioOnly, hasAudio: audioOnly };
    }
    const audioOnly = baseMime === 'audio/webm';
    return { hasVideo: !audioOnly, hasAudio: true };
  }
}

export function buildConvertedFilename(filename: string, ext: '.mp4' | '.m4a'): string {
  const base = path.basename((filename || '').trim() || 'recording.webm');
  const stem = base.replace(/\.webm$/i, '');
  return `${stem || 'recording'}${ext}`;
}

/**
 * Convert a desktop `.webm` recording/clip (such as a GNOME Wayland screencast)
 * to MP4 (`H.264` + `AAC`) or M4A (`AAC` audio-only) using system `ffmpeg`
 * so servers accepting ISOBMFF containers can host and strip metadata from it.
 */
export async function transcodeWebmFile(
  req: TranscodeWebmRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TranscodeWebmResult> {
  let tmpDir = '';
  try {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lurkr-transcode-'));

    let inputPath = (req.sourcePath || '').trim();
    let hasReadablePath = false;
    if (inputPath) {
      try {
        const st = await fs.promises.stat(inputPath);
        hasReadablePath = st.isFile() && st.size > 0;
      } catch {
        hasReadablePath = false;
      }
    }

    if (!hasReadablePath) {
      if (!req.data || req.data.byteLength === 0) {
        return { ok: false, error: 'Empty WebM upload payload' };
      }
      inputPath = path.join(tmpDir, 'input.webm');
      await fs.promises.writeFile(inputPath, req.data);
    }

    const { hasVideo, hasAudio } = await detectStreams(inputPath, req.mime, env);
    if (!hasVideo && !hasAudio) {
      return { ok: false, error: 'WebM file contains no video or audio stream' };
    }

    const outExt: '.mp4' | '.m4a' = hasVideo ? '.mp4' : '.m4a';
    const outMime = hasVideo ? 'video/mp4' : 'audio/mp4';
    const outFilename = buildConvertedFilename(req.filename, outExt);
    const outputPath = path.join(tmpDir, `output${outExt}`);

    const args = hasVideo
      ? [
          '-y',
          '-i',
          inputPath,
          '-vf',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-fps_mode',
          'vfr',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath,
        ]
      : [
          '-y',
          '-i',
          inputPath,
          '-vn',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath,
        ];

    try {
      await execFileAsync('ffmpeg', args, { env, timeout: TRANSCODE_TIMEOUT_MS });
    } catch (err: unknown) {
      const e = err as { code?: string | number; stderr?: string; message?: string } | null;
      if (e?.code === 'ENOENT') {
        return { ok: false, missingFfmpeg: true, error: 'ffmpeg is not installed' };
      }
      const stderrLines = (e?.stderr || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const detail = stderrLines[stderrLines.length - 1] || e?.message || 'ffmpeg failed';
      return { ok: false, error: detail };
    }

    const bytes = await fs.promises.readFile(outputPath);
    return {
      ok: true,
      data: new Uint8Array(bytes),
      mime: outMime,
      filename: outFilename,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'WebM conversion failed';
    return { ok: false, error: msg };
  } finally {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
