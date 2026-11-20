// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { Menu, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export interface DesktopOperCapabilityFlags {
  canOper: boolean;
  canDeoper: boolean;
  canKill: boolean;
  canKline: boolean;
  canDline: boolean;
  canGline: boolean;
  canZline: boolean;
  canShun: boolean;
  canSpamfilter: boolean;
  canRehash: boolean;
  canBroadcast: boolean;
  canServerRouting: boolean;
  canUban: boolean;
  canDefcon: boolean;
  canModules: boolean;
  canDns: boolean;
  canPrivs: boolean;
}

export interface DesktopMenuState {
  loggedIn: boolean;
  isAdmin: boolean;
  dccEnabled: boolean;
  networkId: number | null;
  networkName: string;
  networkState: string;
  target: string;
  hasActiveBuffer: boolean;
  canCloseBuffer: boolean;
  isChannel: boolean;
  isAway: boolean;
  nick: string;
  isOper: boolean;
  operSoftwareLabel: string;
  operToolbarVisible: boolean;
  canRename?: boolean;
  showChannelList: boolean;
  showMemberList: boolean;
  activeThemeId: string;
  themes: Array<{ id: string; name: string }>;
  operCaps: DesktopOperCapabilityFlags;
}

export interface MenuActionPayload {
  action: string;
  arg?: string;
}

export const DEFAULT_MENU_STATE: DesktopMenuState = {
  loggedIn: false,
  isAdmin: false,
  dccEnabled: false,
  networkId: null,
  networkName: '',
  networkState: '',
  target: '',
  hasActiveBuffer: false,
  canCloseBuffer: false,
  isChannel: false,
  isAway: false,
  nick: '',
  isOper: false,
  operSoftwareLabel: '',
  operToolbarVisible: true,
  showChannelList: true,
  showMemberList: true,
  activeThemeId: 'dark',
  themes: [],
  operCaps: {
    canOper: false,
    canDeoper: false,
    canKill: false,
    canKline: false,
    canDline: false,
    canGline: false,
    canZline: false,
    canShun: false,
    canSpamfilter: false,
    canRehash: false,
    canBroadcast: false,
    canServerRouting: false,
    canUban: false,
    canDefcon: false,
    canModules: false,
    canDns: false,
    canPrivs: false,
  },
};

export interface BuildMenuOptions {
  state: DesktopMenuState;
  window: BrowserWindow | null;
  onAction: (action: string, arg?: string) => void;
  onOpenUserData: () => void;
}

function buildOperSubmenu(
  state: DesktopMenuState,
  connected: boolean,
  onAction: (action: string, arg?: string) => void,
): MenuItemConstructorOptions[] {
  const { operCaps } = state;
  if (!state.isOper) {
    return [
      {
        label: 'Oper Login (/oper)…',
        enabled: connected,
        click: () => onAction('oper:open-tab', 'auth'),
      },
    ];
  }

  const items: MenuItemConstructorOptions[] = [
    {
      label: state.operSoftwareLabel ? `IRCd: ${state.operSoftwareLabel}` : 'IRC Operator Active',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Oper Control Center…',
      enabled: connected,
      click: () => onAction('oper:open-tab', 'bans'),
    },
    ...(operCaps.canBroadcast
      ? [
          {
            label: 'Broadcast & Global Notices…',
            enabled: connected,
            click: () => onAction('oper:open-tab', 'broadcast'),
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    ...(operCaps.canServerRouting || operCaps.canRehash
      ? [
          {
            label: 'Server & Routing Control…',
            enabled: connected,
            click: () => onAction('oper:open-tab', 'server'),
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Show Oper Toolbar',
      type: 'checkbox',
      checked: state.operToolbarVisible,
      enabled: connected,
      click: () => onAction('view:toggle-oper-toolbar'),
    },
  ];

  const quickActions: MenuItemConstructorOptions[] = [];
  if (operCaps.canKill) {
    quickActions.push({
      label: 'Kill User (/kill)…',
      enabled: connected,
      click: () => onAction('irc:prompt', 'kill'),
    });
  }
  if (operCaps.canGline || operCaps.canZline) {
    quickActions.push({
      label: 'TKL Bans: G-Line / Z-Line…',
      enabled: connected,
      click: () => onAction('oper:open-tab', 'bans'),
    });
  } else if (operCaps.canKline || operCaps.canDline) {
    quickActions.push({
      label: 'Server Bans: K-Line / D-Line…',
      enabled: connected,
      click: () => onAction('oper:open-tab', 'bans'),
    });
  }
  if (operCaps.canShun || operCaps.canSpamfilter) {
    quickActions.push({
      label: 'Shun / Spamfilter…',
      enabled: connected,
      click: () => onAction('oper:open-tab', 'bans'),
    });
  }
  if (operCaps.canUban) {
    quickActions.push({
      label: 'UBAN List (Ergo)',
      enabled: connected,
      click: () => onAction('irc:slash', '/raw UBAN LIST'),
    });
  }
  if (operCaps.canDefcon) {
    quickActions.push({
      label: 'DEFCON Status (Ergo)',
      enabled: connected,
      click: () => onAction('irc:slash', '/raw DEFCON'),
    });
  }
  if (operCaps.canModules) {
    quickActions.push({
      label: 'Server Modules (/module list)',
      enabled: connected,
      click: () => onAction('irc:slash', '/raw MODULE list'),
    });
  }
  if (operCaps.canDns) {
    quickActions.push({
      label: 'IRCd DNS Stats (/dns)',
      enabled: connected,
      click: () => onAction('irc:slash', '/raw DNS'),
    });
  }
  if (operCaps.canPrivs) {
    quickActions.push({
      label: 'Oper Privileges (/privs)',
      enabled: connected,
      click: () => onAction('irc:slash', '/raw PRIVS'),
    });
  }
  if (operCaps.canRehash) {
    quickActions.push({
      label: 'Rehash Server Config (/rehash)',
      enabled: connected,
      click: () => onAction('irc:slash', '/rehash'),
    });
  }

  if (quickActions.length > 0) {
    items.push({ type: 'separator' }, ...quickActions);
  }

  if (operCaps.canDeoper) {
    items.push(
      { type: 'separator' },
      {
        label: 'Drop Oper Status (/deoper)',
        enabled: connected,
        click: () => onAction('irc:slash', '/deoper'),
      },
    );
  }

  return items;
}

export function buildApplicationMenu({
  state,
  window: win,
  onAction,
  onOpenUserData,
}: BuildMenuOptions): Menu {
  const isMac = process.platform === 'darwin';
  const hasNetwork = state.loggedIn && state.networkId !== null;
  const connected = hasNetwork && state.networkState === 'connected';
  const canDisconnectNet =
    hasNetwork && (state.networkState === 'connected' || state.networkState === 'reconnecting');
  const inChannel = connected && state.isChannel;

  const networkSummary = hasNetwork
    ? `Network: ${state.networkName || `#${state.networkId}`} (${state.networkState || 'disconnected'})`
    : 'No active IRC network';

  const themeSubmenu: MenuItemConstructorOptions[] = [
    ...(state.themes.length > 0
      ? state.themes.map((t) => ({
          label: t.name,
          type: 'radio' as const,
          checked: t.id === state.activeThemeId,
          enabled: state.loggedIn,
          click: () => onAction('theme:select', t.id),
        }))
      : []),
    ...(state.themes.length > 0 ? ([{ type: 'separator' }] satisfies MenuItemConstructorOptions[]) : []),
    {
      label: 'Theme Studio & Customize…',
      enabled: state.loggedIn,
      click: () => onAction('nav:themes'),
    },
  ];

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Add IRC Network…',
        accelerator: 'CmdOrCtrl+Shift+N',
        enabled: state.loggedIn,
        click: () => onAction('network:new'),
      },
      {
        label: 'Join Channel…',
        accelerator: 'CmdOrCtrl+J',
        enabled: connected,
        click: () => onAction('channel:join'),
      },
      {
        label: 'Browse Channel Directory (/LIST)…',
        accelerator: 'CmdOrCtrl+L',
        enabled: connected,
        click: () => onAction('channel:list'),
      },
      {
        label: 'Quick Buffer Switcher…',
        accelerator: 'CmdOrCtrl+K',
        enabled: state.loggedIn,
        click: () => onAction('switcher:open'),
      },
      {
        label: 'Close Current Buffer',
        enabled: state.loggedIn && state.canCloseBuffer,
        click: () => onAction('buffer:close'),
      },
      { type: 'separator' },
      {
        label: 'Uploads & Files…',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('uploads:open'),
      },
      {
        label: 'DCC Transfers & Files…',
        enabled: state.loggedIn && state.dccEnabled,
        click: () => onAction('dcc:open'),
      },
      { type: 'separator' },
      {
        label: 'Settings & Preferences…',
        accelerator: 'CmdOrCtrl+,',
        enabled: state.loggedIn,
        click: () => onAction('nav:settings'),
      },
      {
        label: 'Lurkr Server Connection…',
        click: () => onAction('nav:server-connection'),
      },
      ...(state.isAdmin
        ? [
            {
              label: 'Admin Panel…',
              click: () => onAction('nav:admin'),
            } satisfies MenuItemConstructorOptions,
          ]
        : []),
      { type: 'separator' },
      {
        label: 'Log Out',
        enabled: state.loggedIn,
        click: () => onAction('auth:logout'),
      },
      ...(!isMac
        ? [
            { type: 'separator' } satisfies MenuItemConstructorOptions,
            { label: 'Quit Lurkr', role: 'quit' as const } satisfies MenuItemConstructorOptions,
          ]
        : []),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      {
        label: 'Paste Image to Chat',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('composer:paste-image'),
      },
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Find / Search Messages…',
        accelerator: 'CmdOrCtrl+F',
        enabled: state.loggedIn,
        click: () => onAction('search:open'),
      },
      {
        label: 'Highlights & Activity…',
        enabled: state.loggedIn,
        click: () => onAction('highlights:open'),
      },
      {
        label: 'Bookmarks…',
        enabled: state.loggedIn,
        click: () => onAction('bookmarks:open'),
      },
      {
        label: 'Ignore Rules…',
        enabled: state.loggedIn,
        click: () => onAction('ignores:open'),
      },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Previous Buffer',
        accelerator: 'Alt+Up',
        enabled: state.loggedIn,
        click: () => onAction('buffer:prev'),
      },
      {
        label: 'Next Buffer',
        accelerator: 'Alt+Down',
        enabled: state.loggedIn,
        click: () => onAction('buffer:next'),
      },
      {
        label: 'System Console',
        enabled: state.loggedIn,
        click: () => onAction('buffer:system'),
      },
      {
        label: 'Active Network Status (*status)',
        enabled: hasNetwork,
        click: () => onAction('buffer:status'),
      },
      { type: 'separator' },
      {
        label: 'Show Channel List Sidebar',
        type: 'checkbox',
        checked: state.showChannelList,
        enabled: state.loggedIn,
        click: () => onAction('view:toggle-channel-list'),
      },
      {
        label: 'Show Member List',
        type: 'checkbox',
        checked: state.showMemberList,
        enabled: state.loggedIn && state.isChannel,
        click: () => onAction('view:toggle-member-list'),
      },
      ...(state.isOper
        ? [
            {
              label: 'Show Oper Toolbar',
              type: 'checkbox',
              checked: state.operToolbarVisible,
              enabled: connected,
              click: () => onAction('view:toggle-oper-toolbar'),
            } satisfies MenuItemConstructorOptions,
          ]
        : []),
      {
        label: 'Theme',
        submenu: themeSubmenu,
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const ircMenu: MenuItemConstructorOptions = {
    label: 'IRC',
    submenu: [
      { label: networkSummary, enabled: false },
      {
        label: 'Connection',
        submenu: [
          {
            label: 'Connect Network',
            enabled: hasNetwork && !canDisconnectNet,
            click: () => onAction('irc:connect'),
          },
          {
            label: 'Disconnect Network',
            enabled: canDisconnectNet,
            click: () => onAction('irc:disconnect'),
          },
          {
            label: 'Reconnect Network',
            enabled: hasNetwork,
            click: () => onAction('irc:reconnect'),
          },
          { type: 'separator' },
          {
            label: 'Edit Current Network…',
            enabled: hasNetwork,
            click: () => onAction('network:edit'),
          },
          {
            label: 'Add IRC Network…',
            enabled: state.loggedIn,
            click: () => onAction('network:new'),
          },
          {
            label: 'Open Network Status Buffer',
            enabled: hasNetwork,
            click: () => onAction('buffer:status'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Join Channel (/join)…',
        enabled: connected,
        click: () => onAction('channel:join'),
      },
      {
        label: 'Browse Channel Directory (/LIST)…',
        enabled: connected,
        click: () => onAction('channel:list'),
      },
      {
        label: 'Channel Settings & Modes…',
        enabled: inChannel,
        click: () => onAction('irc:channel-settings'),
      },
      {
        label: 'Rename Channel (/rename)…',
        enabled: inChannel && state.canRename !== false,
        click: () => onAction('irc:prompt', 'rename'),
      },
      {
        label: 'Set Channel Topic (/topic)…',
        enabled: inChannel,
        click: () => onAction('irc:prompt', 'topic'),
      },
      {
        label: 'Invite User to Channel (/invite)…',
        enabled: connected,
        click: () => onAction('irc:prompt', 'invite'),
      },
      {
        label: 'Cycle Channel (/cycle)',
        enabled: inChannel,
        click: () => onAction('irc:cycle'),
      },
      {
        label: 'Part Channel (/part)',
        enabled: inChannel,
        click: () => onAction('irc:part'),
      },
      { type: 'separator' },
      {
        label: state.nick ? `Change Nickname (${state.nick})…` : 'Change Nickname (/nick)…',
        enabled: connected,
        click: () => onAction('irc:prompt', 'nick'),
      },
      {
        label: 'Open Direct Message (/query)…',
        enabled: connected,
        click: () => onAction('irc:prompt', 'query'),
      },
      ...(state.isAway
        ? [
            {
              label: 'Return from Away (/back)',
              enabled: connected,
              click: () => onAction('irc:back'),
            } satisfies MenuItemConstructorOptions,
            {
              label: 'Update Away Message (/away)…',
              enabled: connected,
              click: () => onAction('irc:prompt', 'away'),
            } satisfies MenuItemConstructorOptions,
          ]
        : [
            {
              label: 'Set Away Status (/away)…',
              enabled: connected,
              click: () => onAction('irc:prompt', 'away'),
            } satisfies MenuItemConstructorOptions,
          ]),
      {
        label: 'Channel / User Modes (/mode)…',
        enabled: connected,
        click: () => onAction('irc:prompt', 'mode'),
      },
      { type: 'separator' },
      {
        label: 'User & Server Queries',
        submenu: [
          {
            label: 'WHOIS User (/whois)…',
            enabled: connected,
            click: () => onAction('irc:prompt', 'whois'),
          },
          {
            label: 'WHOWAS History (/whowas)…',
            enabled: connected,
            click: () => onAction('irc:prompt', 'whowas'),
          },
          {
            label: 'Query Buffer Users (/who)',
            enabled: connected && Boolean(state.target),
            click: () => onAction('irc:slash', '/who'),
          },
          { type: 'separator' },
          {
            label: 'Server Version & ISUPPORT (/version)',
            enabled: connected,
            click: () => onAction('irc:slash', '/version'),
          },
          {
            label: 'Message of the Day (/motd)',
            enabled: connected,
            click: () => onAction('irc:slash', '/motd'),
          },
          {
            label: 'Network User Counts (/lusers)',
            enabled: connected,
            click: () => onAction('irc:slash', '/lusers'),
          },
          {
            label: 'Linked Servers (/links)',
            enabled: connected,
            click: () => onAction('irc:slash', '/links'),
          },
          {
            label: 'Network Topology Map (/map)',
            enabled: connected,
            click: () => onAction('irc:slash', '/map'),
          },
          {
            label: 'Server Time (/time)',
            enabled: connected,
            click: () => onAction('irc:slash', '/time'),
          },
          {
            label: 'Server Build Info (/info)',
            enabled: connected,
            click: () => onAction('irc:slash', '/info'),
          },
          {
            label: 'Server Admin Info (/admin)',
            enabled: connected,
            click: () => onAction('irc:slash', '/admin'),
          },
          {
            label: 'Server Rules (/rules)',
            enabled: connected,
            click: () => onAction('irc:slash', '/rules'),
          },
          { type: 'separator' },
          {
            label: 'Server Uptime Stats (/stats u)',
            enabled: connected,
            click: () => onAction('irc:slash', '/stats u'),
          },
          {
            label: 'Configured Opers (/stats o)',
            enabled: connected,
            click: () => onAction('irc:slash', '/stats o'),
          },
        ],
      },
      {
        label: 'Operator',
        submenu: buildOperSubmenu(state, connected, onAction),
      },
      { type: 'separator' },
      {
        label: 'Start Jitsi Video Call (/jitsi)',
        enabled: connected && state.hasActiveBuffer,
        click: () => onAction('irc:slash', '/jitsi'),
      },
      {
        label: 'Mark Relay / Janus Bot (/relay)…',
        enabled: hasNetwork && state.hasActiveBuffer,
        click: () => onAction('irc:prompt', 'relay'),
      },
      {
        label: 'Manage Relay Bots & Aliases in Settings…',
        enabled: state.loggedIn,
        click: () => onAction('nav:relays'),
      },
      {
        label: 'Run Slash / Raw IRC Command (/raw)…',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('irc:prompt', 'raw'),
      },
      {
        label: 'IRC Commands Reference…',
        click: () => onAction('help:commands'),
      },
      {
        label: 'Show /help in Active Buffer',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('irc:slash', '/help'),
      },
      {
        label: 'Clear Scrollback (/clear)',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('irc:clear'),
      },
      {
        label: 'Restore Cleared Scrollback (/unclear)',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('irc:unclear'),
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      ...(isMac
        ? [{ role: 'zoom' as const } satisfies MenuItemConstructorOptions]
        : [
            {
              label: win?.isMaximized() ? 'Restore Window' : 'Maximize Window',
              click: () => {
                if (!win) return;
                if (win.isMaximized()) win.unmaximize();
                else win.maximize();
              },
            } satisfies MenuItemConstructorOptions,
          ]),
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: win?.isAlwaysOnTop() ?? false,
        click: () => {
          if (!win) return;
          win.setAlwaysOnTop(!win.isAlwaysOnTop());
        },
      },
      { type: 'separator' },
      { role: 'close' },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'About Lurkr…',
        click: () => onAction('help:about'),
      },
      {
        label: 'Check for Updates…',
        click: () => onAction('help:check-updates'),
      },
      {
        label: 'Server & IRC Network Info…',
        click: () => onAction('help:network-info'),
      },
      {
        label: 'IRC Commands Reference…',
        accelerator: 'F1',
        click: () => onAction('help:commands'),
      },
      {
        label: 'Keyboard Shortcuts…',
        click: () => onAction('help:shortcuts'),
      },
      { type: 'separator' },
      {
        label: 'Print /help in Active Buffer',
        enabled: state.loggedIn && state.hasActiveBuffer,
        click: () => onAction('irc:slash', '/help'),
      },
      {
        label: 'Copy Diagnostics Info',
        click: () => onAction('help:copy-diagnostics'),
      },
      {
        label: 'Open User Data Folder',
        click: () => onOpenUserData(),
      },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ],
  };

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: app.name || 'Lurkr',
      submenu: [
        { label: 'About Lurkr…', click: () => onAction('help:about') },
        { label: 'Check for Updates…', click: () => onAction('help:check-updates') },
        { type: 'separator' },
        {
          label: 'Settings & Preferences…',
          accelerator: 'CmdOrCtrl+,',
          enabled: state.loggedIn,
          click: () => onAction('nav:settings'),
        },
        { label: 'Lurkr Server Connection…', click: () => onAction('nav:server-connection') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(fileMenu, editMenu, viewMenu, ircMenu, windowMenu, helpMenu);
  return Menu.buildFromTemplate(template);
}
