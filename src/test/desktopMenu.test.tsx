// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAppInfo, DesktopMenuState } from '../api';
import { AboutModal } from '../components/AboutModal';
import { IrcCommandsModal } from '../components/IrcCommandsModal';
import { IrcCommandPromptModal } from '../components/IrcCommandPromptModal';
import { useDesktopMenuBridge } from '../hooks/useDesktopMenuBridge';
import { buildDiagnosticsReport } from '../lib/appMeta';
import { buildCapabilityContext } from '../lib/networkCapabilities';
import { resetSession } from '../stores/sessionReset';
import { useAuthStore } from '../stores/auth';
import { useBuffersStore } from '../stores/buffers';
import { useConfigStore } from '../stores/config';
import { useDesktopUiStore } from '../stores/desktopUi';
import { useNetworksStore } from '../stores/networks';
import { usePinsStore } from '../stores/pins';
import { useSettingsStore } from '../stores/settings';
import * as socketBus from '../services/socketBus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BridgeHarness: React.FC = () => {
  useDesktopMenuBridge();
  return null;
};

describe('Desktop application menu, About & IRC Commands GUI', () => {
  const origDesktop = window.lurkerDesktop;
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    resetSession();
    container = document.createElement('div');
    document.body.appendChild(container);

    useAuthStore.setState({
      user: { id: 1, username: 'alice', role: 'admin' },
      checked: true,
      error: null,
    });
    useConfigStore.setState({
      checked: true,
      edition: 'standalone',
      features: { linkPreviews: true, bouncer: true, dcc: true },
    });
    useNetworksStore.setState({
      networks: [
        {
          id: 1,
          name: 'LiberaLab',
          host: 'irc.example.net',
          port: 6697,
          nick: 'alice',
          tls: true,
        },
      ],
      states: {
        1: {
          networkId: 1,
          channels: ['#lobby', '#dev'],
          state: 'connected',
          nick: 'alice',
          userModes: 'iwo',
          lagMs: 24,
        },
      },
      profiles: {
        1: {
          ircd: 'unrealircd',
          ircdVersion: 'UnrealIRCd-6.1.8',
          services: 'anope',
          negotiatedCaps: ['message-tags', 'labeled-response', 'multi-prefix'],
          capsKnown: true,
          isupport: { NETWORK: 'LiberaLab', PREFIX: '(ov)@+' },
          isupportKnown: true,
          availableUserModes: 'iwoOsH',
          availableChanModes: 'beI,k,l,mnt',
          availableModesKnown: true,
          snomask: 'cF',
          operClass: 'netadmin',
          operCapabilities: [],
          operCapabilitiesKnown: false,
          unsupportedCommands: [],
          absentServices: [],
          observedServices: ['OperServ'],
          roleplayEnabled: false,
          detectedAt: Date.now(),
        },
      },
      activeKey: '1::#lobby',
      loaded: true,
    });

    const bufs = useBuffersStore.getState();
    bufs.ensure(1, ':server:1');
    bufs.ensure(1, '#lobby');
    bufs.ensure(1, '#dev');
    useBuffersStore.setState((s) => ({
      buffers: {
        ...s.buffers,
        '1::#lobby': {
          ...s.buffers['1::#lobby'],
          joined: true,
          topic: 'Welcome to Lobby',
        },
        '1::#dev': {
          ...s.buffers['1::#dev'],
          joined: true,
        },
      },
    }));
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    window.lurkerDesktop = origDesktop;
    vi.restoreAllMocks();
  });

  it('syncs IRCd capability-gated menu state and routes menu actions cleanly', async () => {
    let pushedState: DesktopMenuState | null = null;
    let menuCallback: ((payload: { action: string; arg?: string }) => void) | null = null;

    const sendSpy = vi.spyOn(socketBus, 'socketSend').mockImplementation(() => true);
    const rawAckSpy = vi
      .spyOn(socketBus, 'socketSendWithAck')
      .mockResolvedValue({ ok: true });
    const setValueSpy = vi
      .spyOn(useSettingsStore.getState(), 'setValue')
      .mockResolvedValue();

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: vi.fn(async () => ({ serverUrl: 'https://chat.example.com', allowSelfSigned: false })),
      setConfig: vi.fn(async (next) => ({
        serverUrl: next.serverUrl || 'https://chat.example.com',
        allowSelfSigned: !!next.allowSelfSigned,
      })),
      setBadge: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      openExternal: vi.fn(async () => {}),
      onNavigate: vi.fn(() => () => {}),
      updateMenuState: vi.fn(async (st) => {
        pushedState = st;
      }),
      onMenuAction: vi.fn((cb) => {
        menuCallback = cb;
        return () => {
          menuCallback = null;
        };
      }),
    };

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <BridgeHarness />
        </MemoryRouter>,
      );
    });

    expect(pushedState).not.toBeNull();
    expect(pushedState!.loggedIn).toBe(true);
    expect(pushedState!.isAdmin).toBe(true);
    expect(pushedState!.isOper).toBe(true);
    expect(pushedState!.isChannel).toBe(true);
    expect(pushedState!.operCaps.canGline).toBe(true);
    expect(pushedState!.operCaps.canUban).toBe(false);

    // Switch buffer order via menu actions (next / prev)
    usePinsStore.getState().setNetwork(1, ['#lobby', '#dev']);
    await act(async () => {
      menuCallback?.({ action: 'buffer:next' });
    });
    expect(useNetworksStore.getState().activeKey).toBe('1::#dev');

    await act(async () => {
      menuCallback?.({ action: 'buffer:prev' });
    });
    expect(useNetworksStore.getState().activeKey).toBe('1::#lobby');

    // Toggle sidebar via View menu action
    await act(async () => {
      menuCallback?.({ action: 'view:toggle-channel-list' });
    });
    expect(setValueSpy).toHaveBeenCalledWith('look.layout.show_channel_list', false);

    // Trigger IRC slash command (/version) and dialog actions
    await act(async () => {
      menuCallback?.({ action: 'irc:slash', arg: '/version' });
    });
    expect(rawAckSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'raw', networkId: 1, line: 'VERSION' }),
    );

    await act(async () => {
      menuCallback?.({ action: 'irc:back' });
    });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'away', networkId: 1, message: '' }),
    );

    await act(async () => {
      menuCallback?.({ action: 'help:about' });
    });
    expect(useDesktopUiStore.getState().aboutOpen).toBe(true);
    expect(useDesktopUiStore.getState().aboutTab).toBe('program');

    await act(async () => {
      menuCallback?.({ action: 'help:commands' });
    });
    expect(useDesktopUiStore.getState().commandsOpen).toBe(true);
  });

  it('renders program info and active IRC network/CAP info in AboutModal', async () => {
    const mockAppInfo: DesktopAppInfo = {
      name: 'Lurkr',
      version: '2.6.3',
      electron: '35.0.0',
      chrome: '134.0.0',
      node: '22.0.0',
      platform: 'linux',
      arch: 'x64',
      userDataPath: '/home/user/.config/Lurkr',
      configPath: '/home/user/.config/Lurkr/lurker-desktop.json',
      sessionType: 'wayland',
    };

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: vi.fn(async () => ({ serverUrl: 'https://chat.example.com', allowSelfSigned: true })),
      setConfig: vi.fn(async () => ({ serverUrl: 'https://chat.example.com', allowSelfSigned: true })),
      getAppInfo: vi.fn(async () => mockAppInfo),
      setBadge: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      openExternal: vi.fn(async () => {}),
      onNavigate: vi.fn(() => () => {}),
    };

    useDesktopUiStore.getState().openAbout('program');

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AboutModal />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    expect(text).toContain('About Lurkr');
    expect(text).toContain('v2.6.3');
    expect(text).toContain('MPL-2.0');
    expect(text).toContain('Electron 35.0.0');
    expect(text).toContain('wayland');
    expect(text).toContain('/home/user/.config/Lurkr');

    const netTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Active IRC Network'),
    );
    expect(netTabBtn).toBeTruthy();

    await act(async () => {
      netTabBtn!.click();
    });

    const netText = container.textContent ?? '';
    expect(netText).toContain('LiberaLab');
    expect(netText).toContain('UnrealIRCd (UnrealIRCd-6.1.8)');
    expect(netText).toContain('message-tags');
    expect(netText).toContain('labeled-response');

    const capCtx = buildCapabilityContext(
      useNetworksStore.getState().states[1],
      useNetworksStore.getState().profiles[1],
      { target: '#lobby' },
    );
    const report = buildDiagnosticsReport({
      appInfo: mockAppInfo,
      serverUrl: 'https://chat.example.com',
      edition: 'standalone',
      features: { linkPreviews: true, bouncer: true, dcc: true },
      username: 'alice',
      role: 'admin',
      networkName: 'LiberaLab',
      capCtx,
    });
    expect(report).toContain('Lurkr v2.6.3 (MPL-2.0)');
    expect(report).toContain('IRCd: UnrealIRCd (UnrealIRCd-6.1.8)');
  });

  it('filters IRC commands by active IRCd capabilities in IrcCommandsModal and executes prompts', async () => {
    const rawSpy = vi.spyOn(socketBus, 'socketSend').mockImplementation(() => true);

    // Switch network 1 to Ergo oper to confirm Unreal-only commands are hidden by default
    useNetworksStore.setState((s) => ({
      profiles: {
        ...s.profiles,
        1: {
          ...s.profiles[1],
          ircd: 'ergo',
          ircdVersion: 'ergo-2.15',
          services: 'ergo',
          operCapabilities: ['ban', 'rehash', 'defcon'],
          operCapabilitiesKnown: true,
        },
      },
    }));

    useDesktopUiStore.getState().openCommands();

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <IrcCommandsModal />
          <IrcCommandPromptModal />
        </MemoryRouter>,
      );
    });

    const cmdText = container.textContent ?? '';
    expect(cmdText).toContain('Ergo (ergo-2.15)');
    expect(cmdText).toContain('/dline');
    expect(cmdText).toContain('/defcon');
    expect(cmdText).not.toContain('/gline');

    // Close commands modal and test prompt submission (/nick)
    await act(async () => {
      useDesktopUiStore.getState().closeCommands();
      useDesktopUiStore.getState().openPrompt('nick');
    });

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('alice');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'alice_new');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(rawSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'raw', networkId: 1, line: 'NICK alice_new' }),
    );
  });
});
