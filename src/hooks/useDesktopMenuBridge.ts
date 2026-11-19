// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getServerUrl, type DesktopMenuState } from '../api';
import { isChannelTarget } from '../shared/channels';
import { buildCapabilityContext, evaluateCommand, formatServerSummary } from '../lib/networkCapabilities';
import { dispatchSlashCommand } from '../lib/commands/dispatch';
import { SYSTEM_KEY } from '../lib/virtualBuffers';
import { APP_NAME, APP_VERSION, buildDiagnosticsReport } from '../lib/appMeta';
import { useAuthStore } from '../stores/auth';
import { useBuffersStore } from '../stores/buffers';
import { useConfigStore } from '../stores/config';
import { useDccStore } from '../stores/dcc';
import { activeBufferFrom, isNetworkOper, useNetworksStore } from '../stores/networks';
import { useNicklistCollapseStore } from '../stores/nicklistCollapse';
import { useOperStore, type OperTab } from '../stores/oper';
import { useSettingsStore } from '../stores/settings';
import { useSearchStore } from '../stores/search';
import { useThemesStore } from '../stores/themes';
import { useToastsStore } from '../stores/toasts';
import { useDesktopUiStore, type IrcPromptKind } from '../stores/desktopUi';
import { cycleActiveBuffer } from '../utils/cycleBuffers';

const CHAT_SCOPED_ACTIONS = new Set([
  'network:new',
  'network:edit',
  'channel:join',
  'channel:list',
  'switcher:open',
  'uploads:open',
  'highlights:open',
  'bookmarks:open',
  'ignores:open',
  'irc:channel-settings',
  'composer:paste-image',
]);

export function useDesktopMenuBridge(): void {
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const dccEnabled = useConfigStore((s) => s.features.dcc);
  const edition = useConfigStore((s) => s.edition);
  const features = useConfigStore((s) => s.features);

  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const profiles = useNetworksStore((s) => s.profiles);
  const buffers = useBuffersStore((s) => s.buffers);

  const operToolbarVisible = useOperStore((s) => s.toolbarVisible);
  const settingsValues = useSettingsStore((s) => s.values);
  const savedThemes = useThemesStore((s) => s.saved);
  const collapsedByNet = useNicklistCollapseStore((s) => s.byNetwork);

  const menuState: DesktopMenuState = useMemo(() => {
    const activeBuffer = activeBufferFrom(activeKey, networks);
    const hasSystemActive = activeKey === SYSTEM_KEY;
    const netId = activeBuffer?.networkId ?? null;
    const netState = netId !== null ? states[netId] : null;
    const profile = netId !== null ? profiles[netId] : undefined;
    const target = activeBuffer?.target || (hasSystemActive ? '*status' : '');
    const activeBufObj =
      netId !== null && activeBuffer
        ? buffers[`${netId}::${activeBuffer.target}`]
        : hasSystemActive
          ? buffers[SYSTEM_KEY]
          : undefined;

    const isChannel = Boolean(activeBuffer && isChannelTarget(activeBuffer.target));
    const hasActiveBuffer = Boolean(activeBufObj);
    const canCloseBuffer = Boolean(
      activeBuffer && !activeBuffer.target.startsWith(':server:') && activeBuffer.target !== '*status',
    );

    const ownNick = netState?.nick || activeBuffer?.network?.nick || '';
    const selfMember =
      activeBufObj && ownNick
        ? activeBufObj.members.find((m) => m.nick.toLowerCase() === ownNick.toLowerCase())
        : undefined;

    const capCtx = buildCapabilityContext(netState || undefined, profile, {
      selfChannelModes: selfMember?.modes,
      channelModes: activeBufObj?.modes,
      target,
    });
    const summary = formatServerSummary(capCtx);

    const showChannelList = useSettingsStore.getState().effective('look.layout.show_channel_list') !== false;
    const showMemberList =
      isChannel && activeBuffer
        ? !(collapsedByNet[activeBuffer.networkId] || []).includes(activeBuffer.target)
        : false;

    const themes = useThemesStore.getState().all().map((t) => ({ id: t.id, name: t.name }));
    const activeThemeId = useThemesStore.getState().activeThemeId();

    return {
      loggedIn: Boolean(user),
      isAdmin: user?.role === 'admin',
      dccEnabled,
      networkId: netId,
      networkName: activeBuffer?.network?.name || '',
      networkState: netState?.state || '',
      target,
      hasActiveBuffer,
      canCloseBuffer,
      isChannel,
      isAway: Boolean(netState?.away?.active),
      nick: ownNick,
      isOper: isNetworkOper(netState),
      operSoftwareLabel: summary.softwareLabel,
      operToolbarVisible,
      canRename: evaluateCommand(capCtx, 'rename').allowed,
      showChannelList,
      showMemberList,
      activeThemeId,
      themes,
      operCaps: {
        canOper: evaluateCommand(capCtx, 'oper').allowed,
        canDeoper: evaluateCommand(capCtx, 'deoper').allowed,
        canKill: evaluateCommand(capCtx, 'kill').allowed,
        canKline: evaluateCommand(capCtx, 'kline').allowed,
        canDline: evaluateCommand(capCtx, 'dline').allowed,
        canGline: evaluateCommand(capCtx, 'gline').allowed,
        canZline: evaluateCommand(capCtx, 'zline').allowed,
        canShun: evaluateCommand(capCtx, 'shun').allowed,
        canSpamfilter: evaluateCommand(capCtx, 'spamfilter').allowed,
        canRehash: evaluateCommand(capCtx, 'rehash').allowed,
        canBroadcast:
          evaluateCommand(capCtx, 'wallops').allowed ||
          evaluateCommand(capCtx, 'globops').allowed,
        canServerRouting:
          evaluateCommand(capCtx, 'connect').allowed ||
          evaluateCommand(capCtx, 'squit').allowed,
        canUban: evaluateCommand(capCtx, 'uban').allowed,
        canDefcon: evaluateCommand(capCtx, 'defcon').allowed,
        canModules: evaluateCommand(capCtx, 'module').allowed,
        canDns: evaluateCommand(capCtx, 'dns').allowed,
        canPrivs: evaluateCommand(capCtx, 'privs').allowed,
      },
    };
  }, [
    user,
    dccEnabled,
    activeKey,
    networks,
    states,
    profiles,
    buffers,
    operToolbarVisible,
    settingsValues,
    savedThemes,
    collapsedByNet,
  ]);

  const lastSignatureRef = useRef<string>('');
  useEffect(() => {
    const updateMenuState = window.lurkerDesktop?.updateMenuState;
    if (!updateMenuState) return;
    const sig = JSON.stringify(menuState);
    if (sig === lastSignatureRef.current) return;
    lastSignatureRef.current = sig;
    void updateMenuState(menuState).catch(() => {});
  }, [menuState]);

  useEffect(() => {
    const onMenuAction = window.lurkerDesktop?.onMenuAction;
    if (!onMenuAction) return;

    return onMenuAction(({ action, arg }) => {
      const ui = useDesktopUiStore.getState();
      const nets = useNetworksStore.getState();
      const activeBuffer = activeBufferFrom(nets.activeKey, nets.networks);
      const currentTarget =
        activeBuffer?.target || (nets.activeKey === SYSTEM_KEY ? '*status' : '');

      if (CHAT_SCOPED_ACTIONS.has(action)) {
        if (!useAuthStore.getState().user) return;
        navigate('/');
        ui.dispatchChatAction(action, arg);
        return;
      }

      switch (action) {
        case 'nav:settings':
          if (!useAuthStore.getState().user) return;
          navigate('/settings');
          break;
        case 'nav:themes':
          if (!useAuthStore.getState().user) return;
          ui.requestSettingsSection('_themes');
          navigate('/settings');
          break;
        case 'nav:relays':
          if (!useAuthStore.getState().user) return;
          ui.requestSettingsSection('_relays');
          navigate('/settings');
          break;
        case 'nav:server-connection':
          if (useAuthStore.getState().user) {
            ui.requestSettingsSection('_connection');
            navigate('/settings');
          } else {
            ui.triggerLoginServerConfig();
            navigate('/login');
          }
          break;
        case 'nav:admin':
          if (useAuthStore.getState().isAdmin()) {
            navigate('/admin');
          }
          break;
        case 'auth:logout':
          void useAuthStore
            .getState()
            .logout()
            .then(() => navigate('/login'));
          break;
        case 'dcc:open':
          navigate('/');
          useDccStore.getState().openModal('transfers');
          break;
        case 'search:open':
          if (!useAuthStore.getState().user) return;
          navigate('/');
          useSearchStore.getState().openSearch({
            networkId: activeBuffer?.networkId ?? null,
            target: activeBuffer?.target ?? null,
          });
          break;
        case 'buffer:prev':
          navigate('/');
          cycleActiveBuffer(-1);
          break;
        case 'buffer:next':
          navigate('/');
          cycleActiveBuffer(1);
          break;
        case 'buffer:system':
          navigate('/');
          if (useBuffersStore.getState().buffers[SYSTEM_KEY]) {
            useBuffersStore.getState().activate(null, '*status');
          }
          break;
        case 'buffer:status':
          if (activeBuffer) {
            navigate('/');
            useBuffersStore
              .getState()
              .activate(activeBuffer.networkId, `:server:${activeBuffer.networkId}`);
          }
          break;
        case 'buffer:close':
          if (activeBuffer) {
            void dispatchSlashCommand('/close', activeBuffer.networkId, activeBuffer.target);
          }
          break;
        case 'view:toggle-channel-list': {
          const cur =
            useSettingsStore.getState().effective('look.layout.show_channel_list') !== false;
          void useSettingsStore.getState().setValue('look.layout.show_channel_list', !cur);
          break;
        }
        case 'view:toggle-member-list':
          if (activeBuffer && isChannelTarget(activeBuffer.target)) {
            useNicklistCollapseStore
              .getState()
              .toggle(activeBuffer.networkId, activeBuffer.target);
          }
          break;
        case 'view:toggle-oper-toolbar':
          useOperStore.getState().toggleToolbar();
          break;
        case 'theme:select':
          if (arg) {
            void useThemesStore.getState().applyTheme(arg);
          }
          break;
        case 'irc:connect':
          if (activeBuffer) void nets.connect(activeBuffer.networkId);
          break;
        case 'irc:disconnect':
          if (activeBuffer) void nets.disconnect(activeBuffer.networkId);
          break;
        case 'irc:reconnect':
          if (activeBuffer) void nets.reconnect(activeBuffer.networkId);
          break;
        case 'irc:part':
          if (activeBuffer && isChannelTarget(activeBuffer.target)) {
            void dispatchSlashCommand('/part', activeBuffer.networkId, activeBuffer.target);
          }
          break;
        case 'irc:cycle':
          if (activeBuffer && isChannelTarget(activeBuffer.target)) {
            void dispatchSlashCommand('/cycle', activeBuffer.networkId, activeBuffer.target);
          }
          break;
        case 'irc:back':
          if (activeBuffer) {
            void dispatchSlashCommand('/back', activeBuffer.networkId, activeBuffer.target);
          }
          break;
        case 'irc:clear':
          if (currentTarget) {
            useBuffersStore
              .getState()
              .clearBuffer(activeBuffer?.networkId ?? null, currentTarget);
          }
          break;
        case 'irc:unclear':
          if (currentTarget) {
            useBuffersStore
              .getState()
              .unclearBuffer(activeBuffer?.networkId ?? null, currentTarget);
          }
          break;
        case 'irc:slash':
          if (arg && currentTarget) {
            navigate('/');
            void dispatchSlashCommand(arg, activeBuffer?.networkId ?? null, currentTarget);
            if (
              !currentTarget.startsWith(':server:') &&
              arg !== '/help' &&
              arg !== '/jitsi' &&
              arg !== '/deoper' &&
              arg !== '/rehash'
            ) {
              useToastsStore
                .getState()
                .push(`Sent ${arg} — replies appear in network status buffer`, 'info');
            }
          }
          break;
        case 'irc:prompt':
          if (arg) {
            navigate('/');
            ui.openPrompt(arg as IrcPromptKind);
          }
          break;
        case 'oper:open-tab':
          if (activeBuffer) {
            navigate('/');
            useOperStore.getState().openModal({
              tab: (arg as OperTab) || 'bans',
              networkId: activeBuffer.networkId,
            });
          }
          break;
        case 'help:about':
          ui.openAbout('program');
          break;
        case 'help:network-info':
          ui.openAbout('network');
          break;
        case 'help:commands':
          ui.openCommands();
          break;
        case 'help:shortcuts':
          ui.openShortcuts();
          break;
        case 'help:copy-diagnostics': {
          const authState = useAuthStore.getState();
          const curNetState = activeBuffer ? nets.states[activeBuffer.networkId] : null;
          const curProfile = activeBuffer ? nets.profiles[activeBuffer.networkId] : undefined;
          const curCapCtx = curNetState
            ? buildCapabilityContext(curNetState, curProfile, { target: activeBuffer?.target })
            : null;
          void (async () => {
            const appInfo = window.lurkerDesktop?.getAppInfo
              ? await window.lurkerDesktop.getAppInfo().catch(() => null)
              : null;
            const report = buildDiagnosticsReport({
              appInfo,
              serverUrl: getServerUrl(),
              edition,
              features,
              username: authState.user?.username,
              role: authState.user?.role,
              networkName: activeBuffer?.network?.name,
              networkHost: activeBuffer?.network?.host,
              networkPort: activeBuffer?.network?.port,
              networkTls: activeBuffer?.network?.tls,
              networkState: curNetState?.state,
              nick: curNetState?.nick || activeBuffer?.network?.nick,
              lagMs: curNetState?.lagMs,
              capCtx: curCapCtx,
            });
            try {
              await navigator.clipboard.writeText(report);
              useToastsStore
                .getState()
                .push(`${APP_NAME} v${APP_VERSION} diagnostics copied`, 'success');
            } catch {
              useToastsStore.getState().push('Could not copy diagnostics to clipboard', 'error');
            }
          })();
          break;
        }
      }
    });
  }, [navigate, edition, features]);
}
