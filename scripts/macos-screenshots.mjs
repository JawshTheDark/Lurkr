#!/usr/bin/env node
// Launches a built Lurkr Electron executable against a temporary local mock
// Lurkr server and drives it over CDP to capture genuine desktop screenshots.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const [, , binaryArg, outDirArg] = process.argv;
if (!binaryArg || !outDirArg) {
  console.error('Usage: node scripts/macos-screenshots.mjs <electron-binary> <output-dir>');
  process.exit(2);
}

const binaryPath = path.resolve(binaryArg);
const outDir = path.resolve(outDirArg);
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Valid procedural PNG generator (zero external dependencies)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makeSamplePng(width = 420, height = 200) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < width; x += 1) {
      const idx = rowStart + 1 + x * 4;
      const inCard = x >= 24 && x < width - 24 && y >= 24 && y < height - 24;
      const inBadge = (x - 90) ** 2 + (y - height / 2) ** 2 <= 42 ** 2;
      if (inBadge) {
        raw[idx] = 88;
        raw[idx + 1] = 166;
        raw[idx + 2] = 255;
      } else if (inCard) {
        raw[idx] = 30 + Math.round((x / width) * 55);
        raw[idx + 1] = 36 + Math.round((y / height) * 40);
        raw[idx + 2] = 68 + Math.round((x / width) * 90);
      } else {
        raw[idx] = 18;
        raw[idx + 1] = 20;
        raw[idx + 2] = 26;
      }
      raw[idx + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const SAMPLE_PNG = makeSamplePng();

// ---------------------------------------------------------------------------
// Minimal RFC 6455 WebSocket + HTTP mock Lurkr server
// ---------------------------------------------------------------------------
function encodeWsText(text) {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const hdr = Buffer.alloc(4);
    hdr[0] = 0x81;
    hdr[1] = 126;
    hdr.writeUInt16BE(payload.length, 2);
    return Buffer.concat([hdr, payload]);
  }
  const hdr = Buffer.alloc(10);
  hdr[0] = 0x81;
  hdr[1] = 127;
  hdr.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([hdr, payload]);
}

function decodeWsFrames(buffer, onMessage, onPing) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (cursor + maskLen + len > buffer.length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskLen;
    const data = Buffer.from(buffer.subarray(cursor, cursor + len));
    if (mask) {
      for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
    }
    offset = cursor + len;
    if (opcode === 0x08) break;
    if (opcode === 0x09) onPing(data);
    if (opcode === 0x01) onMessage(data.toString('utf8'));
  }
  return buffer.subarray(offset);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function createMockServer() {
  let baseUrl = '';
  let loggedIn = false;
  const settingsValues = {
    'chat.inline_media.enabled': true,
    'chat.link_previews.enabled': true,
  };

  const buildSnapshot = () => ({
    kind: 'snapshot',
    networks: [
      {
        networkId: 1,
        state: 'connected',
        nick: 'jawsh',
        userModes: 'iwx',
        lagMs: 16,
        ircd: 'unrealircd',
        ircdVersion: 'UnrealIRCd-6.1.8',
        channels: [
          {
            name: '#lobby',
            joined: true,
            topic: 'Lurkr macOS Universal Client — Encrypted Cache + Theme Studio',
            modes: '+ntC',
            members: [
              { nick: 'jawsh', modes: ['o'], away: false },
              { nick: 'alice', modes: ['v'], away: false },
              { nick: 'bob', modes: [], away: false },
              { nick: 'charlie', modes: [], away: true },
            ],
          },
          {
            name: '#dev',
            joined: true,
            topic: 'Cross-platform Electron builds & security hardening',
            members: [
              { nick: 'jawsh', modes: ['o'], away: false },
              { nick: 'alice', modes: [], away: false },
            ],
          },
          {
            name: '#lurkr',
            joined: true,
            members: [{ nick: 'jawsh', modes: [], away: false }],
          },
        ],
      },
    ],
  });

  const buildBacklog = (target) => ({
    kind: 'backlog',
    networkId: 1,
    target,
    reset: true,
    hasMoreOlder: false,
    joined: true,
    events: [
      {
        id: 101,
        networkId: 1,
        target,
        type: 'message',
        nick: 'alice',
        text: 'Welcome to Lurkr on macOS Universal! Cross-platform CI and encrypted previews are live.',
        time: '2026-11-19T17:10:00.000Z',
      },
      {
        id: 102,
        networkId: 1,
        target,
        type: 'message',
        nick: 'bob',
        text: `Check out the encrypted preview cache render: ${baseUrl}/api/link-preview/media/sample.png`,
        time: '2026-11-19T17:11:00.000Z',
      },
      {
        id: 103,
        networkId: 1,
        target,
        type: 'message',
        nick: 'jawsh',
        self: true,
        text: 'AES-256-GCM decrypted cleanly into memory blob: URL without hitting Chromium disk cache.',
        time: '2026-11-19T17:12:00.000Z',
      },
    ],
  });

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', baseUrl || 'http://127.0.0.1');
    console.log(`[mock-http] ${req.method} ${reqUrl.pathname}`);
    const json = (status, body, extraHeaders = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
      res.end(JSON.stringify(body));
    };

    if (reqUrl.pathname === '/api/config') {
      return json(200, {
        edition: 'standalone',
        features: { linkPreviews: true, bouncer: true, dcc: true },
      });
    }
    if (reqUrl.pathname === '/api/auth/setup-status') {
      return json(200, { needsSetup: false });
    }
    if (reqUrl.pathname === '/api/auth/login/password' && req.method === 'POST') {
      loggedIn = true;
      return json(
        200,
        { user: { id: 1, username: 'jawsh', role: 'admin' } },
        { 'Set-Cookie': 'connect.sid=mock-mac-session; Path=/; HttpOnly' },
      );
    }
    if (reqUrl.pathname === '/api/auth/me') {
      if (!loggedIn) return json(401, { error: 'Unauthorized' });
      return json(200, { user: { id: 1, username: 'jawsh', role: 'admin' } });
    }
    if (reqUrl.pathname === '/api/settings/bootstrap') {
      return json(200, {
        values: { ...settingsValues },
        themes: [],
      });
    }
    if (reqUrl.pathname === '/api/settings' && req.method === 'PATCH') {
      const body = await readJsonBody(req);
      if (body?.changes && typeof body.changes === 'object') {
        Object.assign(settingsValues, body.changes);
      }
      if (Array.isArray(body?.resets)) {
        for (const k of body.resets) delete settingsValues[k];
      }
      return json(200, { values: { ...settingsValues } });
    }
    if (reqUrl.pathname === '/api/networks') {
      return json(200, {
        networks: [
          {
            id: 1,
            name: 'LurkrNet',
            host: 'irc.lurkr.local',
            port: 6697,
            nick: 'jawsh',
            tls: true,
          },
        ],
      });
    }
    if (reqUrl.pathname === '/api/link-preview/resolve' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const urls = Array.isArray(body?.urls) ? body.urls : [];
      const out = urls.map((u) => ({
        url: u,
        status: 'ok',
        kind: 'image',
        src: `/api/link-preview/media/sample.png`,
        title: 'Encrypted Preview Sample',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }));
      console.log('[mock-resolve]', JSON.stringify({ req: body, res: out }));
      return json(200, { previews: out });
    }
    if (reqUrl.pathname === '/api/link-preview/media/sample.png') {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': String(SAMPLE_PNG.length),
      });
      res.end(SAMPLE_PNG);
      return;
    }
    return json(200, {});
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );

    const sendJson = (obj) => {
      if (!socket.destroyed) socket.write(encodeWsText(JSON.stringify(obj)));
    };
    sendJson(buildSnapshot());
    sendJson(buildBacklog('#lobby'));

    let rxBuf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      rxBuf = decodeWsFrames(
        rxBuf,
        (msg) => {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'snapshot') {
              sendJson(buildSnapshot());
              sendJson(buildBacklog('#lobby'));
            } else if (parsed.type === 'history') {
              sendJson(buildBacklog(parsed.target || '#lobby'));
            } else if (parsed.type === 'ping') {
              sendJson({ kind: 'pong' });
            }
          } catch {
            /* ignore */
          }
        },
        (pingPayload) => {
          if (!socket.destroyed) {
            socket.write(Buffer.concat([Buffer.from([0x8a, pingPayload.length]), pingPayload]));
          }
        },
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({ server, baseUrl });
    });
  });
}

// ---------------------------------------------------------------------------
// Minimal CDP WebSocket helper
// ---------------------------------------------------------------------------
async function connectCdp(port) {
  let targets = [];
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resOpen, rejOpen) => {
          ws.addEventListener('open', resOpen, { once: true });
          ws.addEventListener('error', rejOpen, { once: true });
        });
        let nextId = 1;
        const pending = new Map();
        ws.addEventListener('message', (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.method === 'Runtime.consoleAPICalled') {
            console.log('[cdp-console]', msg.params.type, ...msg.params.args.map((a) => a.value ?? a.description ?? ''));
          } else if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[cdp-exception]', JSON.stringify(msg.params.exceptionDetails));
          } else if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        });
        const send = (method, params = {}) =>
          new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
          });
        await send('Page.enable');
        await send('Runtime.enable');
        const evalJs = async (expression) => {
          const r = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (r.exceptionDetails) {
            throw new Error(JSON.stringify(r.exceptionDetails));
          }
          return r.result?.value;
        };
        const waitFor = async (predicateExpr, timeoutMs = 15000, label = predicateExpr) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            try {
              if (await evalJs(`Boolean(${predicateExpr})`)) return;
            } catch {
              /* retry */
            }
            await new Promise((r) => setTimeout(r, 150));
          }
          const bodySnippet = await evalJs(`document.body?.innerText?.slice(0, 400) || ''`).catch(
            () => '',
          );
          throw new Error(`Timed out waiting for: ${label}\nVisible text:\n${bodySnippet}`);
        };
        const screenshot = async (filename) => {
          await new Promise((r) => setTimeout(r, 400));
          const { data } = await send('Page.captureScreenshot', { format: 'png' });
          const dest = path.join(outDir, filename);
          fs.writeFileSync(dest, Buffer.from(data, 'base64'));
          console.log(`Captured ${dest}`);
        };
        return { ws, evalJs, waitFor, screenshot };
      }
    } catch {
      /* keep polling CDP */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP target did not appear on port ${port}`);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lurkr-shots-home-'));
const { server, baseUrl } = await createMockServer();
const cdpPort = 19229;
const electronArgs = [`--remote-debugging-port=${cdpPort}`];
if (process.platform === 'linux') {
  electronArgs.push('--no-sandbox');
}

const child = spawn(binaryPath, electronArgs, {
  env: {
    ...process.env,
    HOME: tempHome,
    XDG_CONFIG_HOME: path.join(tempHome, '.config'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stderr.on('data', (d) => process.stderr.write(d));

function tryMacOsNativeCapture(filename, pid) {
  if (process.platform !== 'darwin') return;
  try {
    spawnSync('osascript', ['-e', `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`], {
      encoding: 'utf8',
    });
  } catch {
    /* ignore focus attempt */
  }
  const dest = path.join(outDir, filename);
  try {
    const widOut = execFileSync(
      'swift',
      [
        '-e',
        `import CoreGraphics; let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []; for w in list { if (w[kCGWindowOwnerPID as String] as? Int) == ${pid}, let layer = w[kCGWindowLayer as String] as? Int, layer == 0, let id = w[kCGWindowNumber as String] as? Int { print(id); break } }`,
      ],
      { encoding: 'utf8', timeout: 10000 },
    ).trim();
    if (widOut) {
      const winCap = spawnSync('screencapture', ['-x', '-l', widOut, dest], { encoding: 'utf8' });
      if (winCap.status === 0 && fs.existsSync(dest)) {
        console.log(`Captured native macOS Cocoa window ${dest} (CGWindowID ${widOut})`);
        return;
      }
    }
  } catch {
    /* fall back to full screen capture */
  }
  const res = spawnSync('screencapture', ['-x', dest], { encoding: 'utf8' });
  if (res.status === 0 && fs.existsSync(dest)) {
    console.log(`Captured native macOS screen ${dest}`);
  } else {
    console.warn(`screencapture skipped/failed (${res.status}): ${res.stderr}`);
  }
}

try {
  const cdp = await connectCdp(cdpPort);

  // 1. LoginView
  await cdp.waitFor(
    `document.querySelector('input[placeholder="username"]')`,
    15000,
    'LoginView username input',
  );
  await cdp.evalJs(`(() => {
    const changeBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Change');
    if (changeBtn) changeBtn.click();
  })()`);
  await cdp.waitFor(
    `document.querySelector('input[placeholder="https://irc.example.com"]')`,
    5000,
    'Server URL input',
  );
  await cdp.evalJs(`(() => {
    const setVal = (el, val) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const urlInput = document.querySelector('input[placeholder="https://irc.example.com"]');
    setVal(urlInput, ${JSON.stringify(baseUrl)});
    const form = urlInput.closest('form');
    form.requestSubmit();
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await cdp.screenshot('01-login.png');

  // 2. Sign in -> #lobby ChatView + Encrypted Image Preview
  await cdp.evalJs(`(() => {
    const setVal = (el, val) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const userInput = document.querySelector('input[placeholder="username"]');
    const passInput = document.querySelector('input[type="password"]');
    setVal(userInput, 'jawsh');
    setVal(passInput, 'password123');
    userInput.closest('form').requestSubmit();
  })()`);

  await cdp.waitFor(
    `document.body.innerText.includes('#lobby')`,
    15000,
    '#lobby in sidebar',
  );
  await cdp.evalJs(`(() => {
    const el = Array.from(document.querySelectorAll('span, div')).find((n) => n.textContent?.trim() === '#lobby');
    el?.click();
  })()`);
  await cdp.waitFor(
    `(() => {
      const img = document.querySelector('.msg-attachment-image img');
      return Boolean(img && img.src && img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0);
    })()`,
    10000,
    'decrypted blob: preview image in #lobby',
  ).catch(async (err) => {
    const domDiag = await cdp.evalJs(`JSON.stringify({
      imgs: Array.from(document.querySelectorAll('img')).map(i => ({ src: i.src, complete: i.complete, w: i.naturalWidth, h: i.naturalHeight })),
      attachments: document.querySelectorAll('.msg-attachment, .msg-attachment-image, [aria-busy="true"]').length,
      htmlSample: document.querySelector('.msg-attachment-image')?.outerHTML || null,
      cacheCheck: document.querySelector('.msg-attachments')?.outerHTML || null,
      msgHtml: Array.from(document.querySelectorAll('.msg-row')).map(e => e.outerHTML)
    })`);
    console.error('DOM diag:', domDiag);
    throw err;
  });
  await cdp.screenshot('02-chat-encrypted-preview.png');
  if (child.pid) tryMacOsNativeCapture('05-macos-native-window.png', child.pid);

  // 3. Settings -> Theme Studio
  await cdp.evalJs(`(() => {
    const btn = document.querySelector('button[title="Settings"]');
    if (btn) btn.click();
    else window.location.hash = '#/settings';
  })()`);
  await cdp.waitFor(
    `Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('Open Theme Studio'))`,
    10000,
    'Open Theme Studio button',
  );
  await cdp.evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Open Theme Studio'));
    btn?.click();
  })()`);
  await cdp.waitFor(
    `document.body.innerText.includes('Theme Studio') || document.body.innerText.includes('Palettes')`,
    10000,
    'Theme Studio open',
  );
  await cdp.screenshot('03-theme-studio.png');

  // 4. Settings -> Security & Passkeys -> Encrypted Image Preview Cache panel
  await cdp.evalJs(`(() => {
    const closeBtn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Close' || b.title === 'Close' || b.textContent?.trim() === 'Done' || b.textContent?.trim() === 'Close');
    if (closeBtn) closeBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  await cdp.evalJs(`(() => {
    const secBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Security & Passkeys'));
    secBtn?.click();
  })()`);
  await cdp.waitFor(
    `document.body.innerText.includes('Encrypted Image Preview Cache') && document.body.innerText.includes('1 images')`,
    10000,
    'Encrypted Image Preview Cache stats in Security tab',
  );
  await cdp.screenshot('04-security-encrypted-cache.png');

  // Capture process platform proof metadata
  const info = await cdp.evalJs(`window.lurkerDesktop?.getAppInfo ? window.lurkerDesktop.getAppInfo() : null`);
  fs.writeFileSync(path.join(outDir, 'app-info.json'), JSON.stringify(info, null, 2));
  console.log('App info:', info);

  try {
    execFileSync('true');
  } catch {
    /* noop */
  }
  cdp.ws.close();
} finally {
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  server.close();
  fs.rmSync(tempHome, { recursive: true, force: true });
}
