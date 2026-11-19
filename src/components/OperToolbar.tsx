// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useRef, useState } from 'react';
import {
  Shield,
  ShieldBan,
  UserCog,
  Bot,
  Server,
  Megaphone,
  Terminal,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { isChannelTarget } from '../shared/channels';
import { isNetworkOper, useNetworksStore, type NetworkState } from '../stores/networks';
import { executeOperRaw, useOperStore } from '../stores/oper';
import {
  buildCapabilityContext,
  effectiveServicesFamily,
  evaluateCommand,
  getAvailableBanTypes,
  getAvailableBroadcastTypes,
  getAvailableQuickServerCmds,
  getAvailableServices,
  getAvailableUserActions,
  supportsDefcon,
  supportsRehashTlsFlag,
  supportsServerRouting,
} from '../lib/networkCapabilities';

export interface OperMenuItem {
  id?: string;
  label?: string;
  section?: string;
  divider?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

interface OperDropdownProps {
  label: string;
  icon: React.ReactNode;
  items: OperMenuItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const OperDropdown: React.FC<OperDropdownProps> = ({
  label,
  icon,
  items,
  isOpen,
  onToggle,
  onClose,
}) => {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    if (!isOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 245)),
      top: rect.bottom + 4,
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
          isOpen
            ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text-primary)]'
            : 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            zIndex: 1150,
            minWidth: '230px',
            maxHeight: '72vh',
            overflowY: 'auto',
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-1 shadow-xl"
        >
          {items.map((item, idx) => {
            if (item.divider) {
              return <div key={`div-${idx}`} className="my-1 h-px bg-[var(--border)]" />;
            }
            if (item.section) {
              return (
                <div
                  key={`sec-${idx}`}
                  className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                >
                  {item.section}
                </div>
              );
            }
            return (
              <button
                key={item.id || `${item.label}-${idx}`}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  item.onClick?.();
                }}
                className={`block w-full rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
                  item.danger ? 'text-[var(--bad)]' : 'text-[var(--text-primary)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};

interface OperToolbarProps {
  networkId: number | null;
  target: string;
  netState: NetworkState | null | undefined;
}

function cleanMenuItems(raw: OperMenuItem[]): OperMenuItem[] {
  const out: OperMenuItem[] = [];
  for (const item of raw) {
    if (item.divider) {
      if (out.length === 0 || out[out.length - 1].divider || out[out.length - 1].section) continue;
      out.push(item);
      continue;
    }
    if (item.section) {
      while (out.length > 0 && out[out.length - 1].section) out.pop();
      out.push(item);
      continue;
    }
    out.push(item);
  }
  while (out.length > 0 && (out[out.length - 1].divider || out[out.length - 1].section)) {
    out.pop();
  }
  return out;
}

export const OperToolbar: React.FC<OperToolbarProps> = ({ networkId, target, netState }) => {
  const toolbarVisible = useOperStore((s) => s.toolbarVisible);
  const openModal = useOperStore((s) => s.openModal);
  const profile = useNetworksStore((s) =>
    networkId != null ? s.profiles[networkId] : undefined,
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const isOper = isNetworkOper(netState);
  if (!isOper || !toolbarVisible || networkId == null) {
    return null;
  }

  const nid = networkId;
  const isChan = isChannelTarget(target);
  const ownNick = netState?.nick || '';
  const modes = netState?.userModes || 'o';
  const chCtx = isChan ? target : '';

  const ctx = buildCapabilityContext(netState, profile, { target });
  const banTypes = getAvailableBanTypes(ctx);
  const userActions = getAvailableUserActions(ctx);
  const broadcastTypes = getAvailableBroadcastTypes(ctx);
  const servicesList = getAvailableServices(ctx);
  const svcFamily = effectiveServicesFamily(ctx);
  const defcon = supportsDefcon(ctx);
  const quickCmds = getAvailableQuickServerCmds(ctx);
  const canCmd = (c: string) => evaluateCommand(ctx, c).allowed;

  const bansItems = cleanMenuItems([
    { section: 'Add / Manage Bans' },
    ...banTypes.map((b) => ({
      label: `${b.label}…`,
      onClick: () => openModal({ tab: 'bans', networkId: nid, banType: b.value }),
    })),
    { divider: true },
    { section: 'Inspect Active Lists' },
    ...quickCmds
      .filter((c) => ['STATS g', 'STATS G', 'STATS k', 'STATS d', 'STATS s', 'UBAN LIST'].includes(c.cmd))
      .map((c) => ({
        label: c.label,
        onClick: () => void executeOperRaw(nid, c.cmd),
      })),
    ...(canCmd('SPAMFILTER')
      ? [{ label: 'List Spamfilters', onClick: () => void executeOperRaw(nid, 'SPAMFILTER') }]
      : []),
  ]);

  const userActionRaw: OperMenuItem[] = [
    { section: 'Force & Identity Commands' },
    ...userActions
      .filter((a) => !['OMODE', 'SETHOST', 'SETIDENT'].includes(a.value))
      .map((a) => ({
        label: `${a.label}…`,
        danger: a.value === 'KILL' || a.value === 'SAKILL' || a.value === 'SVSKILL',
        onClick: () =>
          openModal({
            tab: 'users',
            networkId: nid,
            userAction: a.value,
            ...(a.needsChannel ? { targetChannel: chCtx } : {}),
          }),
      })),
  ];

  const chanOverrideCmd = canCmd('SAMODE') ? 'SAMODE' : canCmd('OMODE') ? 'OMODE' : null;
  if (isChan && (chanOverrideCmd || canCmd('SATOPIC'))) {
    userActionRaw.push({ divider: true }, { section: `Channel: ${target}` });
    if (chanOverrideCmd) {
      userActionRaw.push(
        {
          label: `Moderate Channel (${chanOverrideCmd} ${target} +m)`,
          onClick: () => void executeOperRaw(nid, `${chanOverrideCmd} ${target} +m`),
        },
        {
          label: `Unmoderate Channel (${chanOverrideCmd} ${target} -m)`,
          onClick: () => void executeOperRaw(nid, `${chanOverrideCmd} ${target} -m`),
        },
        {
          label: `Invite-Only (${chanOverrideCmd} ${target} +i)`,
          onClick: () => void executeOperRaw(nid, `${chanOverrideCmd} ${target} +i`),
        },
        {
          label: `Clear Invite-Only (${chanOverrideCmd} ${target} -i)`,
          onClick: () => void executeOperRaw(nid, `${chanOverrideCmd} ${target} -i`),
        },
      );
    }
    if (canCmd('SATOPIC')) {
      userActionRaw.push({
        label: `Force Topic (SATOPIC ${target})…`,
        onClick: () =>
          openModal({ tab: 'users', networkId: nid, userAction: 'SATOPIC', targetChannel: target }),
      });
    }
  }
  const userItems = cleanMenuItems(userActionRaw);

  const servicesRaw: OperMenuItem[] = [];
  if (servicesList.includes('OperServ') && (svcFamily === 'anope' || svcFamily === 'atheme')) {
    servicesRaw.push(
      { section: `Global & OperServ (${svcFamily === 'atheme' ? 'Atheme' : 'Anope'})` },
      ...(canCmd('GLOBAL')
        ? [
            {
              label: 'Global Network Notice…',
              onClick: () => openModal({ tab: 'broadcast', networkId: nid, broadcastType: 'GLOBAL' }),
            },
          ]
        : []),
      {
        label: 'OperServ Console…',
        onClick: () => openModal({ tab: 'services', networkId: nid, serviceName: 'OperServ' }),
      },
      {
        label: 'OperServ STATS ALL',
        onClick: () => void executeOperRaw(nid, 'PRIVMSG OperServ :STATS ALL', 'OperServ STATS ALL'),
      },
      {
        label: 'OperServ AKILL LIST',
        onClick: () => void executeOperRaw(nid, 'PRIVMSG OperServ :AKILL LIST', 'OperServ AKILL LIST'),
      },
      {
        label: 'OperServ SQLINE LIST',
        onClick: () =>
          void executeOperRaw(nid, 'PRIVMSG OperServ :SQLINE LIST', 'OperServ SQLINE LIST'),
      },
      ...(svcFamily === 'anope'
        ? [
            {
              label: 'OperServ SESSION LIST',
              onClick: () =>
                void executeOperRaw(nid, 'PRIVMSG OperServ :SESSION LIST', 'OperServ SESSION LIST'),
            },
          ]
        : []),
      {
        label: 'OperServ JUPE Server…',
        onClick: () =>
          openModal({ tab: 'services', networkId: nid, serviceName: 'OperServ', serviceCmd: 'JUPE ' }),
      },
      {
        label: `OperServ CHANKILL ${chCtx || '#channel'}…`,
        danger: true,
        onClick: () =>
          openModal({
            tab: 'services',
            networkId: nid,
            serviceName: 'OperServ',
            serviceCmd: `CHANKILL ${chCtx || '#channel'} `,
          }),
      },
      {
        label: 'OperServ RELOAD',
        onClick: () => void executeOperRaw(nid, 'PRIVMSG OperServ :RELOAD', 'OperServ RELOAD'),
      },
      { divider: true },
    );
  }
  const coreSvcs = servicesList.filter((s) => s !== 'OperServ');
  if (coreSvcs.length > 0) {
    servicesRaw.push({
      section: svcFamily === 'ergo' ? 'Ergo Built-in Services' : 'Account & Channel Services',
    });
    for (const svcName of coreSvcs) {
      servicesRaw.push({
        label: `${svcName} Console…`,
        onClick: () => openModal({ tab: 'services', networkId: nid, serviceName: svcName }),
      });
    }
  }
  const servicesItems = cleanMenuItems(servicesRaw);

  const serverItems = cleanMenuItems([
    { section: 'Diagnostics & Status' },
    ...quickCmds
      .filter((c) => !['STATS g', 'STATS G', 'STATS k', 'STATS d', 'STATS s', 'UBAN LIST'].includes(c.cmd))
      .map((c) => ({
        label: c.label,
        onClick: () => void executeOperRaw(nid, c.cmd),
      })),
    { divider: true },
    { section: 'Admin & Routing' },
    ...(canCmd('REHASH')
      ? [{ label: 'REHASH Config', onClick: () => void executeOperRaw(nid, 'REHASH') }]
      : []),
    ...(supportsRehashTlsFlag(ctx)
      ? [{ label: 'REHASH TLS Certs (-tls)', onClick: () => void executeOperRaw(nid, 'REHASH -tls') }]
      : []),
    ...(defcon.ergo || defcon.anope
      ? [
          {
            label: defcon.ergo ? 'DEFCON Emergency Lockdown…' : 'Anope DEFCON Lockdown…',
            onClick: () => openModal({ tab: 'broadcast', networkId: nid }),
          },
        ]
      : []),
    ...(supportsServerRouting(ctx)
      ? [
          {
            label: 'Link / Squit Server…',
            onClick: () => openModal({ tab: 'server', networkId: nid }),
          },
        ]
      : []),
    ...(canCmd('CLOSE')
      ? [
          {
            label: 'Drop Unknown Conns (CLOSE)',
            danger: true,
            onClick: () => void executeOperRaw(nid, 'CLOSE'),
          },
        ]
      : []),
  ]);

  const toggleMenu = (name: string) => setOpenMenu((cur) => (cur === name ? null : name));
  const dialectBadge =
    ctx.profile.ircd !== 'unknown'
      ? ctx.profile.ircd === 'unrealircd'
        ? 'UnrealIRCd'
        : ctx.profile.ircd.charAt(0).toUpperCase() + ctx.profile.ircd.slice(1)
      : 'Detecting';
  const showBroadcast = broadcastTypes.length > 0 || defcon.ergo || defcon.anope;

  return (
    <div
      data-testid="oper-toolbar"
      className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)]/80 px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => openModal({ tab: 'auth', networkId: nid })}
          title={`IRC Operator active (+${modes}) — ${dialectBadge}`}
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
        >
          <Shield className="w-3 h-3" />
          <span>OPER</span>
          <span className="font-mono opacity-80">(+{modes})</span>
          <span className="text-[10px] opacity-75">· {dialectBadge}</span>
        </button>

        {bansItems.length > 0 && (
          <OperDropdown
            label={ctx.profile.ircd === 'ergo' ? 'Bans' : 'Bans / TKL'}
            icon={<ShieldBan className="w-3.5 h-3.5 text-[var(--bad)]" />}
            items={bansItems}
            isOpen={openMenu === 'bans'}
            onToggle={() => toggleMenu('bans')}
            onClose={() => setOpenMenu(null)}
          />
        )}

        {userItems.length > 0 && (
          <OperDropdown
            label="Users / SA*"
            icon={<UserCog className="w-3.5 h-3.5 text-[var(--accent)]" />}
            items={userItems}
            isOpen={openMenu === 'users'}
            onToggle={() => toggleMenu('users')}
            onClose={() => setOpenMenu(null)}
          />
        )}

        {servicesItems.length > 0 && (
          <OperDropdown
            label="Services"
            icon={<Bot className="w-3.5 h-3.5 text-[var(--good)]" />}
            items={servicesItems}
            isOpen={openMenu === 'services'}
            onToggle={() => toggleMenu('services')}
            onClose={() => setOpenMenu(null)}
          />
        )}

        {serverItems.length > 0 && (
          <OperDropdown
            label="Server"
            icon={<Server className="w-3.5 h-3.5 text-[var(--warn)]" />}
            items={serverItems}
            isOpen={openMenu === 'server'}
            onToggle={() => toggleMenu('server')}
            onClose={() => setOpenMenu(null)}
          />
        )}

        {showBroadcast && (
          <button
            type="button"
            onClick={() => openModal({ tab: 'broadcast', networkId: nid })}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Megaphone className="w-3.5 h-3.5 text-amber-400" />
            <span>Broadcast</span>
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            openModal({
              tab: bansItems.length > 0 ? 'bans' : userItems.length > 0 ? 'users' : 'server',
              networkId: nid,
              targetChannel: chCtx,
            })
          }
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>Oper Console</span>
        </button>
      </div>

      {ownNick && (
        <button
          type="button"
          title="Drop IRC Operator status (MODE -o)"
          onClick={() => void executeOperRaw(nid, `MODE ${ownNick} -o`, 'Dropped IRC Operator (-o)')}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
        >
          <LogOut className="w-3 h-3" />
          <span>De-Oper</span>
        </button>
      )}
    </div>
  );
};
