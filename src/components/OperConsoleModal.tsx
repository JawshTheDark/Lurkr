// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  ShieldBan,
  UserCog,
  Megaphone,
  Bot,
  Server,
  KeyRound,
  AlertTriangle,
} from 'lucide-react';
import { AppModal } from './AppModal';
import {
  activeBufferFrom,
  isNetworkOper,
  useNetworksStore,
} from '../stores/networks';
import { bufferKey, useBuffersStore } from '../stores/buffers';
import { executeOperRaw, useOperStore, type OperTab } from '../stores/oper';
import { formatTklBanLine, formatTrailing } from '../lib/commands/oper';
import { isChannelTarget } from '../shared/channels';
import {
  buildCapabilityContext,
  evaluateCommand,
  formatServerSummary,
  getAvailableBanTypes,
  getAvailableBroadcastTypes,
  getAvailableQuickServerCmds,
  getAvailableServices,
  getAvailableUserActions,
  getConfigurableUserModes,
  getServicePresets,
  supportsAndKillFlag,
  supportsDefcon,
  supportsRehashTlsFlag,
  supportsServerRouting,
  supportsSnomaskEdit,
} from '../lib/networkCapabilities';

const ALL_TABS: Array<{ id: OperTab; label: string; icon: React.ReactNode }> = [
  { id: 'bans', label: 'Bans / TKL', icon: <ShieldBan className="w-3.5 h-3.5" /> },
  { id: 'users', label: 'Users / SA*', icon: <UserCog className="w-3.5 h-3.5" /> },
  { id: 'broadcast', label: 'Broadcast / DEFCON', icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: 'services', label: 'Services', icon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'server', label: 'Server', icon: <Server className="w-3.5 h-3.5" /> },
  { id: 'auth', label: 'Oper Auth & Modes', icon: <KeyRound className="w-3.5 h-3.5" /> },
];

const DURATION_PRESETS = ['1h', '6h', '1d', '3d', '7d', '30d', '0'];

export const OperConsoleModal: React.FC = () => {
  const modalOpen = useOperStore((s) => s.modalOpen);
  const activeTab = useOperStore((s) => s.activeTab);
  const storeNetworkId = useOperStore((s) => s.networkId);
  const prefillBanType = useOperStore((s) => s.banType);
  const prefillBanMask = useOperStore((s) => s.banMask);
  const prefillBanDuration = useOperStore((s) => s.banDuration);
  const prefillBanFlags = useOperStore((s) => s.banFlags);
  const prefillBanReason = useOperStore((s) => s.banReason);
  const prefillTargetNick = useOperStore((s) => s.targetNick);
  const prefillTargetChannel = useOperStore((s) => s.targetChannel);
  const prefillUserAction = useOperStore((s) => s.userAction);
  const prefillUserValue = useOperStore((s) => s.userValue);
  const prefillBroadcastType = useOperStore((s) => s.broadcastType);
  const prefillServiceName = useOperStore((s) => s.serviceName);
  const prefillServiceCmd = useOperStore((s) => s.serviceCmd);

  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const profiles = useNetworksStore((s) => s.profiles);
  const activeBuffer = useMemo(
    () => activeBufferFrom(activeKey, networks),
    [activeKey, networks],
  );
  const buffers = useBuffersStore((s) => s.buffers);

  const networkId = storeNetworkId ?? activeBuffer?.networkId ?? networks[0]?.id ?? null;
  const netState = networkId != null ? states[networkId] : null;
  const profile = networkId != null ? profiles[networkId] : undefined;
  const netName = networks.find((n) => n.id === networkId)?.name || 'Network';
  const ownNick = netState?.nick || networks.find((n) => n.id === networkId)?.nick || '';
  const isOper = isNetworkOper(netState);

  const activeChannelTarget =
    activeBuffer && isChannelTarget(activeBuffer.target) ? activeBuffer.target : '';
  const activeChannelBuf =
    networkId != null && activeChannelTarget
      ? buffers[bufferKey(networkId, activeChannelTarget)]
      : undefined;
  const activeMembers = useMemo(() => activeChannelBuf?.members || [], [activeChannelBuf]);
  const selfChannelModes = useMemo(() => {
    if (!ownNick || !activeMembers.length) return [];
    const low = ownNick.toLowerCase();
    return activeMembers.find((m) => m.nick.toLowerCase() === low)?.modes || [];
  }, [activeMembers, ownNick]);

  const ctx = useMemo(
    () =>
      buildCapabilityContext(netState, profile, {
        target: activeChannelTarget,
        selfChannelModes,
        channelModes: activeChannelBuf?.modes || [],
      }),
    [netState, profile, activeChannelTarget, selfChannelModes, activeChannelBuf?.modes],
  );

  const availableBanTypes = useMemo(() => getAvailableBanTypes(ctx), [ctx]);
  const availableUserActions = useMemo(() => getAvailableUserActions(ctx), [ctx]);
  const availableBroadcastTypes = useMemo(() => getAvailableBroadcastTypes(ctx), [ctx]);
  const availableServices = useMemo(() => getAvailableServices(ctx), [ctx]);
  const quickServerCmds = useMemo(() => getAvailableQuickServerCmds(ctx), [ctx]);
  const defconSupport = useMemo(() => supportsDefcon(ctx), [ctx]);
  const andKillSupported = supportsAndKillFlag(ctx);
  const rehashTlsSupported = supportsRehashTlsFlag(ctx);
  const routingSupported = supportsServerRouting(ctx);
  const userModeToggles = useMemo(() => getConfigurableUserModes(ctx), [ctx]);
  const snomaskEditable = supportsSnomaskEdit(ctx);
  const serverSummary = useMemo(() => formatServerSummary(ctx), [ctx]);

  const visibleTabs = useMemo(() => {
    return ALL_TABS.filter((t) => {
      if (t.id === 'bans') return isOper && availableBanTypes.length > 0;
      if (t.id === 'users') return availableUserActions.length > 0;
      if (t.id === 'broadcast') {
        return isOper && (availableBroadcastTypes.length > 0 || defconSupport.ergo || defconSupport.anope);
      }
      if (t.id === 'services') return availableServices.length > 0;
      if (t.id === 'server') return isOper;
      return true;
    }).map((t) =>
      t.id === 'bans' && ctx.profile.ircd === 'ergo' ? { ...t, label: 'Bans' } : t,
    );
  }, [
    isOper,
    availableBanTypes.length,
    availableUserActions.length,
    availableBroadcastTypes.length,
    defconSupport.ergo,
    defconSupport.anope,
    availableServices.length,
    ctx.profile.ircd,
  ]);

  // Ban tab state
  const [banType, setBanType] = useState('GLINE');
  const [banMask, setBanMask] = useState('');
  const [banDuration, setBanDuration] = useState('7d');
  const [banFlags, setBanFlags] = useState('');
  const [banReason, setBanReason] = useState('');
  const [andKill, setAndKill] = useState(false);
  const [spamAction, setSpamAction] = useState('block');
  const [spamTarget, setSpamTarget] = useState('pc');
  const [spamMatchType, setSpamMatchType] = useState('simple');

  // Users / SA* tab state
  const [userAction, setUserAction] = useState('KILL');
  const [targetNick, setTargetNick] = useState('');
  const [targetChannel, setTargetChannel] = useState('');
  const [userValue, setUserValue] = useState('');

  // Broadcast & DEFCON tab state
  const [broadcastType, setBroadcastType] = useState('WALLOPS');
  const [broadcastChannel, setBroadcastChannel] = useState('');
  const [broadcastNpc, setBroadcastNpc] = useState('');
  const [broadcastText, setBroadcastText] = useState('');
  const [defconTarget, setDefconTarget] = useState<'ergo' | 'anope'>('ergo');

  // Services tab state
  const [serviceName, setServiceName] = useState('NickServ');
  const [serviceCmd, setServiceCmd] = useState('');

  // Server tab state
  const [rehashArg, setRehashArg] = useState('');
  const [connectServer, setConnectServer] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [squitServer, setSquitServer] = useState('');
  const [squitReason, setSquitReason] = useState('');
  const [dangerUnlocked, setDangerUnlocked] = useState(false);

  // Auth & modes tab state
  const [operName, setOperName] = useState('');
  const [operPass, setOperPass] = useState('');
  const [snomaskInput, setSnomaskInput] = useState('');
  const [capsExpanded, setCapsExpanded] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      useOperStore.getState().setTab(visibleTabs[0]?.id || 'auth');
    }
  }, [modalOpen, activeTab, visibleTabs]);

  useEffect(() => {
    if (availableBanTypes.length > 0 && !availableBanTypes.some((b) => b.value === banType)) {
      setBanType(availableBanTypes[0].value);
    }
  }, [availableBanTypes, banType]);

  useEffect(() => {
    if (
      availableUserActions.length > 0 &&
      !availableUserActions.some((a) => a.value === userAction)
    ) {
      setUserAction(availableUserActions[0].value);
    }
  }, [availableUserActions, userAction]);

  useEffect(() => {
    if (
      availableBroadcastTypes.length > 0 &&
      !availableBroadcastTypes.some((b) => b.value === broadcastType)
    ) {
      setBroadcastType(availableBroadcastTypes[0].value);
    }
  }, [availableBroadcastTypes, broadcastType]);

  useEffect(() => {
    if (availableServices.length > 0 && !availableServices.includes(serviceName)) {
      setServiceName(availableServices[0]);
      setServiceCmd('');
    }
  }, [availableServices, serviceName]);

  useEffect(() => {
    if (defconSupport.ergo && !defconSupport.anope) setDefconTarget('ergo');
    else if (!defconSupport.ergo && defconSupport.anope) setDefconTarget('anope');
  }, [defconSupport.ergo, defconSupport.anope]);

  useEffect(() => {
    setSnomaskInput(ctx.profile.snomask || '');
  }, [ctx.profile.snomask, networkId]);

  useEffect(() => {
    if (!modalOpen) return;
    setBanType(prefillBanType || availableBanTypes[0]?.value || 'KLINE');
    setBanMask(prefillBanMask || '');
    setBanDuration(prefillBanDuration || '7d');
    setBanFlags(prefillBanFlags || 'gkqs');
    setBanReason(prefillBanReason || '');
    setTargetNick(prefillTargetNick || '');
    setTargetChannel(prefillTargetChannel || activeChannelTarget || '');
    setUserAction(prefillUserAction || availableUserActions[0]?.value || 'KILL');
    setUserValue(prefillUserValue || '');
    setBroadcastType(prefillBroadcastType || availableBroadcastTypes[0]?.value || 'WALLOPS');
    setBroadcastChannel(prefillTargetChannel || activeChannelTarget || '');
    setServiceName(prefillServiceName || availableServices[0] || 'NickServ');
    setServiceCmd(prefillServiceCmd || '');
    setOperName((prev) => prev || ownNick);
    setDangerUnlocked(false);
  }, [
    modalOpen,
    prefillBanType,
    prefillBanMask,
    prefillBanDuration,
    prefillBanFlags,
    prefillBanReason,
    prefillTargetNick,
    prefillTargetChannel,
    prefillUserAction,
    prefillUserValue,
    prefillBroadcastType,
    prefillServiceName,
    prefillServiceCmd,
    activeChannelTarget,
    ownNick,
    availableBanTypes,
    availableUserActions,
    availableBroadcastTypes,
    availableServices,
  ]);

  const banPreview = useMemo(() => {
    const mask = banMask.trim() || '<mask>';
    const reason = banReason.trim() || 'Banned by operator';
    const dur = banDuration.trim() || '0';

    if (banType === 'TEMPSHUN') {
      return `TEMPSHUN ${mask} :${reason}`;
    }
    if (banType === 'ELINE') {
      const types = banFlags.trim() || 'gkqs';
      return `ELINE ${mask} ${types} ${dur} :${reason}`;
    }
    if (banType === 'UBAN ADD') {
      return `UBAN ADD ${mask}${dur !== '0' ? ` ${dur}` : ''} ${reason}`;
    }
    if (banType === 'SPAMFILTER') {
      const safeReason = reason.replace(/\s+/g, '_');
      return `SPAMFILTER add ${spamMatchType} ${spamTarget} ${spamAction} ${dur} ${safeReason} :${mask}`;
    }
    if (banType.startsWith('OS ')) {
      const sub = banType.slice(3);
      if (sub === 'AKILL') {
        const exp = dur === '0' ? '+0' : dur.startsWith('+') ? dur : `+${dur}`;
        return `PRIVMSG OperServ :AKILL ADD ${exp} ${mask} ${reason}`;
      }
      return `PRIVMSG OperServ :${sub} ADD ${mask} ${reason}`;
    }

    const parts: string[] = [];
    if ((banType === 'KLINE' || banType === 'DLINE') && andKill && andKillSupported) parts.push('ANDKILL');
    parts.push(mask);
    if (dur) parts.push(dur);
    parts.push(...reason.split(/\s+/));
    return formatTklBanLine(
      banType as 'KLINE' | 'GLINE' | 'DLINE' | 'ZLINE' | 'GZLINE' | 'SHUN',
      parts,
      andKillSupported && (banType === 'KLINE' || banType === 'DLINE'),
    );
  }, [banType, banMask, banDuration, banFlags, banReason, andKill, andKillSupported, spamMatchType, spamTarget, spamAction]);

  const banRemovePreview = useMemo(() => {
    const clean = banMask.trim().replace(/^[-+]+/, '') || '<mask>';
    if (banType === 'TEMPSHUN') return `TEMPSHUN -${clean}`;
    if (banType === 'ELINE') return `ELINE -${clean} ${banFlags.trim() || 'gkqs'}`;
    if (banType === 'UBAN ADD') return `UBAN DEL ${clean}`;
    if (banType === 'SPAMFILTER') return `SPAMFILTER del ${spamMatchType} ${spamTarget} ${spamAction} - - :${clean}`;
    if (banType === 'DLINE') return `UNDLINE ${clean}`;
    if (banType === 'KLINE' && (ctx.profile.ircd === 'ergo' || ctx.profile.ircd === 'solanum')) {
      return `UNKLINE ${clean}`;
    }
    if (banType.startsWith('OS ')) {
      return `PRIVMSG OperServ :${banType.slice(3)} DEL ${clean}`;
    }
    return `${banType} -${clean}`;
  }, [banType, banMask, banFlags, spamMatchType, spamTarget, spamAction, ctx.profile.ircd]);

  const userPreview = useMemo(() => {
    const nick = targetNick.trim() || '<nick>';
    const ch = targetChannel.trim() || '#channel';
    const val = userValue.trim();

    switch (userAction) {
      case 'KILL':
      case 'SAKILL':
      case 'SVSKILL':
        return `${userAction} ${nick} :${val || 'Killed by operator'}`;
      case 'SAJOIN':
        return `SAJOIN ${nick} ${ch}`;
      case 'SAPART':
        return val ? `SAPART ${nick} ${ch} :${val}` : `SAPART ${nick} ${ch}`;
      case 'SAMODE':
      case 'OMODE': {
        const tgt = nick !== '<nick>' && !nick.startsWith('#') ? nick : ch;
        return `${userAction} ${tgt} ${val || '+m'}`;
      }
      case 'SATOPIC':
        return `SATOPIC ${ch} :${val}`;
      case 'SANICK':
        return `SANICK ${nick} ${val || '<newnick>'}`;
      case 'CHGHOST':
      case 'CHGIDENT':
        return `${userAction} ${nick} ${val || '<value>'}`;
      case 'CHGNAME':
      case 'SWHOIS':
        return `${userAction} ${nick} :${val || '<text>'}`;
      case 'SETHOST':
      case 'SETIDENT':
        return `${userAction} ${val || '<value>'}`;
      case 'SETNAME':
        return `SETNAME :${val || '<realname>'}`;
      default:
        return `${userAction} ${nick}`;
    }
  }, [userAction, targetNick, targetChannel, userValue]);

  const broadcastPreview = useMemo(() => {
    const msg = broadcastText.trim() || '<message>';
    const ch = broadcastChannel.trim() || '#channel';
    const npc = broadcastNpc.trim() || '<npc>';
    if (broadcastType === 'GLOBAL') return `PRIVMSG Global :${msg}`;
    if (broadcastType === 'NPC') return `NPC ${ch} ${npc} :${msg}`;
    if (broadcastType === 'SCENE' || broadcastType === 'AMBIENCE') return `${broadcastType} ${ch} :${msg}`;
    return `${broadcastType} :${msg}`;
  }, [broadcastType, broadcastText, broadcastChannel, broadcastNpc]);

  const currentBanMeta = availableBanTypes.find((b) => b.value === banType) || availableBanTypes[0];
  const currentUserMeta = availableUserActions.find((a) => a.value === userAction) || availableUserActions[0];
  const presetList = useMemo(() => getServicePresets(ctx, serviceName), [ctx, serviceName]);

  const handleRun = async (line: string, summary?: string): Promise<boolean> => {
    if (networkId == null) return false;
    return executeOperRaw(networkId, line, summary);
  };

  return (
    <AppModal
      open={modalOpen}
      onClose={() => useOperStore.getState().closeModal()}
      title={
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" />
          <span>Oper Control Center — {netName}</span>
          {isOper ? (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              OPER (+{netState?.userModes || 'o'})
            </span>
          ) : (
            <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              Not Oper
            </span>
          )}
        </div>
      }
      width="720px"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4 text-xs">
        {/* Server Capability Summary Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
            <span>
              <strong className="text-[var(--text-primary)]">Server:</strong>{' '}
              {serverSummary.softwareLabel}
            </span>
            <span className="opacity-40">·</span>
            <span>
              <strong className="text-[var(--text-primary)]">Services:</strong>{' '}
              {serverSummary.servicesLabel}
            </span>
            <span className="opacity-40">·</span>
            <span>
              <strong className="text-[var(--text-primary)]">Modes:</strong>{' '}
              <code className="font-mono">{serverSummary.modesLabel}</code>
            </span>
            {serverSummary.capsCount > 0 && (
              <>
                <span className="opacity-40">·</span>
                <button
                  type="button"
                  onClick={() => setCapsExpanded((v) => !v)}
                  className="text-[var(--accent)] hover:underline"
                >
                  {serverSummary.capsCount} CAPs {capsExpanded ? '▾' : '▸'}
                </button>
              </>
            )}
          </div>
          {networkId != null && ctx.connected && (
            <button
              type="button"
              onClick={() => void handleRun('VERSION', 'Requested server VERSION')}
              className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title="Query server VERSION / 005 capabilities"
            >
              Refresh Info
            </button>
          )}
        </div>

        {capsExpanded && serverSummary.capsCount > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5 space-y-1.5 text-[10px]">
            <div className="font-semibold text-[var(--text-muted)]">
              Negotiated IRCv3 Capabilities ({serverSummary.capsCount})
            </div>
            <div className="flex flex-wrap gap-1">
              {serverSummary.capsList.map((c) => (
                <span
                  key={c}
                  className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[var(--text-secondary)]"
                >
                  {c}
                </span>
              ))}
            </div>
            {serverSummary.isupportHighlights.length > 0 && (
              <div className="text-[var(--text-muted)] pt-1">
                <strong>ISUPPORT:</strong>{' '}
                <span className="font-mono">{serverSummary.isupportHighlights.join(' · ')}</span>
              </div>
            )}
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => useOperStore.getState().setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === t.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* BANS / TKL TAB */}
        {activeTab === 'bans' && availableBanTypes.length > 0 && currentBanMeta && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Ban / Security System ({serverSummary.softwareLabel})
              </label>
              <select
                value={banType}
                onChange={(e) => setBanType(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
              >
                {availableBanTypes.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  Target Mask / IP / Nick / Pattern
                </label>
                <input
                  type="text"
                  value={banMask}
                  onChange={(e) => setBanMask(e.target.value)}
                  placeholder={currentBanMeta.hint}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  Duration
                </label>
                <div className="flex gap-1.5">
                  <select
                    value={DURATION_PRESETS.includes(banDuration) ? banDuration : '__custom'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom') setBanDuration(e.target.value);
                    }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    <option value="1h">1h</option>
                    <option value="6h">6h</option>
                    <option value="1d">1d</option>
                    <option value="3d">3d</option>
                    <option value="7d">7d</option>
                    <option value="30d">30d</option>
                    <option value="0">Permanent (0)</option>
                    <option value="__custom">Custom</option>
                  </select>
                  <input
                    type="text"
                    value={banDuration}
                    onChange={(e) => setBanDuration(e.target.value)}
                    placeholder="7d or 0"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)]"
                  />
                </div>
              </div>
            </div>

            {andKillSupported && (banType === 'KLINE' || banType === 'DLINE') && (
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={andKill}
                  onChange={(e) => setAndKill(e.target.checked)}
                />
                <span>Include Ergo <code>ANDKILL</code> flag (disconnect matching active clients)</span>
              </label>
            )}

            {banType === 'ELINE' && (
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  ELINE Exception Types (e.g. <code>gkqs</code>, <code>kGzeqs</code>)
                </label>
                <input
                  type="text"
                  value={banFlags}
                  onChange={(e) => setBanFlags(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)]"
                />
              </div>
            )}

            {banType === 'SPAMFILTER' && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Match Type</label>
                  <select
                    value={spamMatchType}
                    onChange={(e) => setSpamMatchType(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                  >
                    <option value="simple">simple</option>
                    <option value="regex">regex</option>
                    <option value="posix">posix</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Targets</label>
                  <input
                    type="text"
                    value={spamTarget}
                    onChange={(e) => setSpamTarget(e.target.value)}
                    placeholder="pcNnaq"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Action</label>
                  <select
                    value={spamAction}
                    onChange={(e) => setSpamAction(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                  >
                    <option value="block">block</option>
                    <option value="warn">warn</option>
                    <option value="kill">kill</option>
                    <option value="kline">kline</option>
                    <option value="gline">gline</option>
                    <option value="gzline">gzline</option>
                    <option value="shun">shun</option>
                    <option value="tempshun">tempshun</option>
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Reason
              </label>
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Banned by operator"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
              />
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)] break-all">
              Preview: {banPreview}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!banMask.trim() || networkId == null}
                  onClick={() => void handleRun(banPreview)}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40"
                >
                  Apply / Add Ban
                </button>
                <button
                  type="button"
                  disabled={!banMask.trim() || networkId == null}
                  onClick={() => void handleRun(banRemovePreview)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  Remove / Unban
                </button>
              </div>
              {ctx.profile.ircd === 'ergo' && banType === 'KLINE' && (
                <button
                  type="button"
                  disabled={!banMask.trim() || networkId == null}
                  onClick={() => void handleRun(`UNKLINE ${banMask.trim()}`)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  UNKLINE
                </button>
              )}
            </div>
          </div>
        )}

        {/* USERS / SA* TAB */}
        {activeTab === 'users' && availableUserActions.length > 0 && currentUserMeta && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Action
              </label>
              <select
                value={userAction}
                onChange={(e) => setUserAction(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
              >
                {availableUserActions.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!userAction.startsWith('SET') && userAction !== 'SATOPIC' && (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Target Nick
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={targetNick}
                      onChange={(e) => setTargetNick(e.target.value)}
                      placeholder="nickname"
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                    />
                    {activeMembers.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setTargetNick(e.target.value);
                        }}
                        className="max-w-[120px] rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-secondary)]"
                        title="Pick from current channel"
                      >
                        <option value="">Channel nick…</option>
                        {activeMembers.map((m) => (
                          <option key={m.nick} value={m.nick}>
                            {m.nick}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}

              {(currentUserMeta.needsChannel || userAction === 'SAMODE' || userAction === 'OMODE') && (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Channel
                  </label>
                  <input
                    type="text"
                    value={targetChannel}
                    onChange={(e) => setTargetChannel(e.target.value)}
                    placeholder="#channel"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
              )}
            </div>

            {(userAction === 'SAMODE' || userAction === 'OMODE') && (
              <div className="flex flex-wrap gap-1.5">
                {['+m', '-m', '+i', '-i', '+R', '-R', '+N', '+t', '+n'].map((modeChip) => (
                  <button
                    key={modeChip}
                    type="button"
                    onClick={() => setUserValue(modeChip)}
                    className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    {modeChip}
                  </button>
                ))}
              </div>
            )}

            {(currentUserMeta.needsValue || userAction === 'SAPART') && (
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  {currentUserMeta.needsValue || 'Value'}
                </label>
                <input
                  type="text"
                  value={userValue}
                  onChange={(e) => setUserValue(e.target.value)}
                  placeholder={currentUserMeta.needsValue}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                />
              </div>
            )}

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)] break-all">
              Preview: {userPreview}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={networkId == null}
                onClick={() => void handleRun(userPreview)}
                className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Execute Command
              </button>
            </div>
          </div>
        )}

        {/* BROADCAST / DEFCON TAB */}
        {activeTab === 'broadcast' && (
          <div className="space-y-4">
            {availableBroadcastTypes.length > 0 && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Broadcast / Announcement Type
                  </label>
                  <select
                    value={broadcastType}
                    onChange={(e) => setBroadcastType(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    {availableBroadcastTypes.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>

                {(broadcastType === 'NPC' || broadcastType === 'SCENE' || broadcastType === 'AMBIENCE') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--text-muted)] mb-1">Channel</label>
                      <input
                        type="text"
                        value={broadcastChannel}
                        onChange={(e) => setBroadcastChannel(e.target.value)}
                        placeholder="#channel"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    {broadcastType === 'NPC' && (
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">NPC Nick</label>
                        <input
                          type="text"
                          value={broadcastNpc}
                          onChange={(e) => setBroadcastNpc(e.target.value)}
                          placeholder="Narrator"
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Message
                  </label>
                  <textarea
                    rows={3}
                    value={broadcastText}
                    onChange={(e) => setBroadcastText(e.target.value)}
                    placeholder="Announcement text..."
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                    {broadcastPreview}
                  </span>
                  <button
                    type="button"
                    disabled={!broadcastText.trim() || networkId == null}
                    onClick={() => void handleRun(broadcastPreview)}
                    className="shrink-0 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    Send Broadcast
                  </button>
                </div>
              </div>
            )}

            {/* DEFCON Panel */}
            {(defconSupport.ergo || defconSupport.anope) && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-xs text-[var(--text-primary)]">
                    Emergency DEFCON Level ({defconSupport.ergo ? 'Ergo' : 'Anope OperServ'})
                  </div>
                  {defconSupport.ergo && defconSupport.anope && (
                    <div className="flex rounded-md border border-[var(--border)] overflow-hidden text-[11px]">
                      <button
                        type="button"
                        onClick={() => setDefconTarget('ergo')}
                        className={`px-2 py-0.5 ${
                          defconTarget === 'ergo'
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        Ergo (DEFCON)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDefconTarget('anope')}
                        className={`px-2 py-0.5 ${
                          defconTarget === 'anope'
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        Anope (OperServ DEFCON)
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { lvl: 1, label: '1 · Lockdown', cls: 'border-red-500/50 text-red-400 hover:bg-red-500/15' },
                    { lvl: 2, label: '2 · Strict', cls: 'border-orange-500/40 text-orange-300 hover:bg-orange-500/15' },
                    { lvl: 3, label: '3 · Guarded', cls: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/15' },
                    { lvl: 4, label: '4 · Reduced', cls: 'border-sky-500/40 text-sky-300 hover:bg-sky-500/15' },
                    { lvl: 5, label: '5 · Normal', cls: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15' },
                  ].map((d) => (
                    <button
                      key={d.lvl}
                      type="button"
                      onClick={() =>
                        void handleRun(
                          defconTarget === 'ergo' && defconSupport.ergo
                            ? `DEFCON ${d.lvl}`
                            : `PRIVMSG OperServ :DEFCON ${d.lvl}`,
                        )
                      }
                      className={`rounded-md border px-2 py-1.5 text-[11px] font-medium ${d.cls}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SERVICES TAB */}
        {activeTab === 'services' && availableServices.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  Service ({serverSummary.servicesLabel})
                </label>
                <select
                  value={serviceName}
                  onChange={(e) => {
                    setServiceName(e.target.value);
                    setServiceCmd('');
                  }}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  {availableServices.map((svc) => (
                    <option key={svc} value={svc}>
                      {svc}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                  Preset Subcommand
                </label>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setServiceCmd(e.target.value);
                  }}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="">Choose a preset…</option>
                  {presetList.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset.trim() || '(text)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Command & Arguments
              </label>
              <input
                type="text"
                value={serviceCmd}
                onChange={(e) => setServiceCmd(e.target.value)}
                placeholder={`e.g. ${presetList[1]?.trim() || 'HELP'} ...`}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)]"
              />
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
              Preview: PRIVMSG {serviceName} :{serviceCmd.trim() || 'HELP'}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={networkId == null}
                onClick={() => void handleRun(`PRIVMSG ${serviceName} :HELP`, `${serviceName} HELP`)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {serviceName} HELP
              </button>
              <button
                type="button"
                disabled={networkId == null}
                onClick={() =>
                  void handleRun(
                    `PRIVMSG ${serviceName} :${serviceCmd.trim() || 'HELP'}`,
                    `${serviceName}: ${serviceCmd.trim() || 'HELP'}`,
                  )
                }
                className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Send to {serviceName}
              </button>
            </div>
          </div>
        )}

        {/* SERVER TAB */}
        {activeTab === 'server' && (
          <div className="space-y-4">
            {quickServerCmds.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-[var(--text-muted)] mb-1.5">
                  Quick Diagnostics ({serverSummary.softwareLabel})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {quickServerCmds.map((c) => (
                    <button
                      key={c.cmd}
                      type="button"
                      disabled={networkId == null}
                      onClick={() => void handleRun(c.cmd)}
                      className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* REHASH */}
            {evaluateCommand(ctx, 'REHASH').allowed && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-xs">Rehash:</span>
                <input
                  type="text"
                  value={rehashArg}
                  onChange={(e) => setRehashArg(e.target.value)}
                  placeholder={rehashTlsSupported ? 'Optional server or flag (e.g. -tls)' : 'Optional argument'}
                  className="flex-1 min-w-[180px] rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleRun(rehashArg.trim() ? `REHASH ${rehashArg.trim()}` : 'REHASH')}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                >
                  Run REHASH
                </button>
                {rehashTlsSupported && (
                  <button
                    type="button"
                    onClick={() => void handleRun('REHASH -tls')}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--bg-hover)]"
                  >
                    REHASH -tls
                  </button>
                )}
              </div>
            )}

            {/* CONNECT / SQUIT */}
            {routingSupported && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                  <div className="font-semibold text-xs">Link Server (CONNECT)</div>
                  <input
                    type="text"
                    value={connectServer}
                    onChange={(e) => setConnectServer(e.target.value)}
                    placeholder="leaf2.example.org"
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={connectPort}
                      onChange={(e) => setConnectPort(e.target.value)}
                      placeholder="Port (optional)"
                      className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={!connectServer.trim()}
                      onClick={() =>
                        void handleRun(
                          `CONNECT ${connectServer.trim()}${connectPort.trim() ? ` ${connectPort.trim()}` : ''}`,
                        )
                      }
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-40"
                    >
                      Connect
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                  <div className="font-semibold text-xs">Unlink Server (SQUIT)</div>
                  <input
                    type="text"
                    value={squitServer}
                    onChange={(e) => setSquitServer(e.target.value)}
                    placeholder="leaf2.example.org"
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={squitReason}
                      onChange={(e) => setSquitReason(e.target.value)}
                      placeholder="Reason"
                      className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={!squitServer.trim()}
                      onClick={() =>
                        void handleRun(
                          squitReason.trim()
                            ? `SQUIT ${squitServer.trim()} ${formatTrailing([squitReason.trim()], 0)}`
                            : `SQUIT ${squitServer.trim()}`,
                        )
                      }
                      className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-400 hover:bg-red-500/15 disabled:opacity-40"
                    >
                      Squit
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Danger Zone */}
            {(evaluateCommand(ctx, 'CLOSE').allowed ||
              evaluateCommand(ctx, 'RESTART').allowed ||
              evaluateCommand(ctx, 'DIE').allowed) && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-red-400 font-semibold text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" /> Server Power / Danger Zone
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={dangerUnlocked}
                      onChange={(e) => setDangerUnlocked(e.target.checked)}
                    />
                    Unlock destructive buttons
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {evaluateCommand(ctx, 'CLOSE').allowed && (
                    <button
                      type="button"
                      disabled={!dangerUnlocked}
                      onClick={() => void handleRun('CLOSE')}
                      className="rounded border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/15 disabled:opacity-35"
                    >
                      CLOSE Unknown Conns
                    </button>
                  )}
                  {evaluateCommand(ctx, 'RESTART').allowed && (
                    <button
                      type="button"
                      disabled={!dangerUnlocked}
                      onClick={() => void handleRun('RESTART')}
                      className="rounded border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/15 disabled:opacity-35"
                    >
                      RESTART Server
                    </button>
                  )}
                  {evaluateCommand(ctx, 'DIE').allowed && (
                    <button
                      type="button"
                      disabled={!dangerUnlocked}
                      onClick={() => void handleRun('DIE')}
                      className="rounded border border-red-500/60 bg-red-600/20 px-2.5 py-1 text-xs text-red-300 hover:bg-red-600/35 disabled:opacity-35"
                    >
                      DIE (Shut Down Server)
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OPER AUTH & MODES TAB */}
        {activeTab === 'auth' && (
          <div className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!operName.trim() || networkId == null) return;
                const line = operPass
                  ? `OPER ${operName.trim()} ${operPass}`
                  : `OPER ${operName.trim()}`;
                void handleRun(line, `OPER ${operName.trim()}`).then((ok) => {
                  if (ok) {
                    setOperPass('');
                    useOperStore.getState().closeModal();
                  }
                });
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Oper Name
                  </label>
                  <input
                    type="text"
                    value={operName}
                    onChange={(e) => setOperName(e.target.value)}
                    placeholder={ownNick || 'oper'}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Password <span className="opacity-60">(optional if Ergo CertFP)</span>
                  </label>
                  <input
                    type="password"
                    value={operPass}
                    onChange={(e) => setOperPass(e.target.value)}
                    placeholder="Oper password"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                {isOper && ownNick ? (
                  <button
                    type="button"
                    onClick={() => void handleRun(`MODE ${ownNick} -o`, 'Dropped IRC Operator (-o)')}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/15"
                  >
                    De-Oper (MODE {ownNick} -o)
                  </button>
                ) : (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Oper toolbar and dropdowns appear automatically once +o/+O is granted.
                  </span>
                )}
                <button
                  type="submit"
                  disabled={!operName.trim() || networkId == null}
                  className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  Authenticate (/oper)
                </button>
              </div>
            </form>

            {/* User / Oper Mode Controls */}
            {ctx.connected && ownNick && userModeToggles.length > 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-[var(--text-primary)]">
                    User & Oper Modes ({serverSummary.modesLabel})
                  </span>
                  {ctx.profile.operClass && (
                    <span className="text-[10px] font-mono text-amber-300">
                      operclass: {ctx.profile.operClass}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {userModeToggles.map((um) => {
                    const active = ctx.userModes.includes(um.mode);
                    return (
                      <button
                        key={um.mode}
                        type="button"
                        onClick={() =>
                          void handleRun(
                            `MODE ${ownNick} ${active ? '-' : '+'}${um.mode}`,
                            `${active ? '-' : '+'}${um.mode}`,
                          )
                        }
                        className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text-primary)]'
                            : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {active ? '✓ ' : ''}{um.label}
                      </button>
                    );
                  })}
                </div>

                {snomaskEditable && (
                  <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-[var(--border)]">
                    <span className="text-[11px] text-[var(--text-muted)]">Snomask (+s):</span>
                    <input
                      type="text"
                      value={snomaskInput}
                      onChange={(e) => setSnomaskInput(e.target.value)}
                      placeholder={ctx.profile.ircd === 'unrealircd' ? '+cFfkejvGnNqsSo' : '+c'}
                      className="flex-1 min-w-[140px] rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-mono"
                    />
                    <button
                      type="button"
                      disabled={!snomaskInput.trim()}
                      onClick={() => {
                        const val = snomaskInput.trim();
                        const signed = val.startsWith('+') || val.startsWith('-') ? val : `+${val}`;
                        void handleRun(`MODE ${ownNick} +s ${signed}`, `Snomask ${signed}`);
                      }}
                      className="rounded border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    >
                      Apply Snomask
                    </button>
                  </div>
                )}

                {ctx.profile.operCapabilitiesKnown && ctx.profile.operCapabilities.length > 0 && (
                  <div className="pt-1.5 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
                    <strong>Oper capabilities:</strong>{' '}
                    <span className="font-mono">{ctx.profile.operCapabilities.join(', ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppModal>
  );
};
