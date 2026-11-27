// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AppModal } from './AppModal';
import { ChannelModeRow } from './ChannelModeRow';
import { LinkedText } from './LinkedText';
import { useBuffersStore } from '../stores/buffers';
import { useNetworksStore } from '../stores/networks';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useIgnoresStore } from '../stores/ignores';
import { onIrcEvent, onSocketOpen } from '../services/socket';
import { socketSendWithAck } from '../services/socketBus';
import { getChannelNotifyRung, setChannelNotifyRung, type ChannelNotifyRung } from '../lib/channelNotifyRung';
import {
  buildCapabilityContext,
  DEFAULT_MODE_SPEC,
  formatServerSummary,
  getAvailableServices,
  type IrcdFamily,
} from '../lib/networkCapabilities';
import {
  DEFAULT_PREFIX,
  hasRankAtLeast,
  type OutgoingModeChange,
  type PrefixMode,
} from '../shared/channelModes';
import {
  describeListMode,
  describeModeMeta,
  LIST_NAMES,
  liveRow,
  modeChanges,
  modeRows,
  topicBytes,
  type DraftRow,
  type LiveModes,
  type ModeRow,
} from '../utils/channelModeForm';
import { patchModeList, type ListEntry, type ModeRowLike } from '../utils/modeListPatch';
import { formatDate, formatDateTime } from '../utils/timestamp';

interface ChannelModalProps {
  open: boolean;
  networkId: number | null;
  target: string;
  onClose: () => void;
}

interface ListState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries: ListEntry[];
  error: string;
  fromRow: number;
}

const LIST_ACK_TIMEOUT_MS = 35_000;
const ERROR_WINDOW_MS = 10_000;
const FORM_ID = 'channel-settings-form';

const SOFTWARE_LABELS: Record<IrcdFamily, string> = {
  solanum: 'Solanum',
  charybdis: 'Charybdis',
  unrealircd: 'UnrealIRCd',
  inspircd: 'InspIRCd',
  ergo: 'Ergo',
  hybrid: 'Hybrid',
  ngircd: 'ngIRCd',
  ircu: 'ircu',
  unknown: 'Extended',
};

const ROLE_LABELS: Record<string, string> = {
  q: 'Owner',
  a: 'Admin',
  o: 'Operator',
  h: 'Half-Op',
  v: 'Voiced',
};

function describeSelfRole(selfModes: string[], prefix: readonly PrefixMode[]): string {
  for (const p of prefix) {
    if (selfModes.includes(p.mode)) {
      const name = ROLE_LABELS[p.mode] ?? `+${p.mode}`;
      return `${name} (${p.symbol})`;
    }
  }
  return 'Member';
}

const NOTIFY_RUNGS: Array<{ id: ChannelNotifyRung; label: string; hint: string }> = [
  { id: 'all', label: 'All Messages', hint: 'Notify on every message in this channel.' },
  { id: 'highlights', label: 'Highlights Only', hint: 'Notify only on highlights & mentions (default).' },
  { id: 'nothing', label: 'Nothing', hint: 'Keep unread badge, silence alert notifications.' },
  { id: 'muted', label: 'Muted', hint: 'Hide unread badge and silence all notifications.' },
];

function rowKey(row: DraftRow): string {
  return `${row.on}:${row.value}`;
}

function lastKeyChange(seenRows: readonly ModeRowLike[]): string | null | undefined {
  for (let i = seenRows.length - 1; i >= 0; i--) {
    const changes = seenRows[i].modes ?? [];
    for (let j = changes.length - 1; j >= 0; j--) {
      const change = changes[j];
      if (change.mode === '-k') return null;
      if (change.mode === '+k' && change.param && change.param !== '*') return change.param;
    }
  }
  return undefined;
}

function listErrorText(data: { error?: string; numeric?: string; text?: string } | undefined): string {
  if (data?.error === 'refused') {
    return data.numeric === '482'
      ? 'Only channel operators can see this list.'
      : `The server refused: ${data.text || data.numeric || 'permission denied'}`;
  }
  if (data?.error === 'not-connected') return 'Not connected.';
  return "The server didn't answer.";
}

async function sendAck(
  payload: Record<string, unknown>,
): Promise<string> {
  const result = await socketSendWithAck(payload);
  if (result.ok) return '';
  return result.error === 'not-connected'
    ? 'Not connected.'
    : `Couldn't save (${result.error || 'error'}).`;
}

export const ChannelModal: React.FC<ChannelModalProps> = ({
  open,
  networkId,
  target,
  onClose,
}) => {
  const buffer = useBuffersStore((s) =>
    networkId != null && target ? s.findByTarget(networkId, target) : null,
  );
  const netState = useNetworksStore((s) => (networkId != null ? s.states[networkId] : undefined));
  const profile = useNetworksStore((s) => (networkId != null ? s.profiles[networkId] : undefined));
  const networks = useNetworksStore((s) => s.networks);
  const notifyByNet = useChannelNotifyStore((s) => s.byNetwork);
  const ignoresGlobal = useIgnoresStore((s) => s.global);
  const ignoresByNet = useIgnoresStore((s) => s.byNetwork);
  void notifyByNet;
  void ignoresGlobal;
  void ignoresByNet;

  const [activeTab, setActiveTab] = useState<string>('settings');
  const [topicDraft, setTopicDraft] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [hoveredActiveMode, setHoveredActiveMode] = useState<string | null>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const [modeRowsSeen, setModeRowsSeen] = useState<ModeRowLike[]>([]);
  const [errorsSeen, setErrorsSeen] = useState<Array<{ text: string; at: number }>>([]);
  const [armed, setArmed] = useState<{ from: number; at: number; tab: string } | null>(null);

  const [lists, setLists] = useState<Record<string, ListState>>({});
  const [newMask, setNewMask] = useState('');
  const [listActionErrors, setListActionErrors] = useState<Record<string, string>>({});
  const [listBusy, setListBusy] = useState(false);

  const savedFromRef = useRef(new Map<string, { live: string; sent: string }>());
  const topicSavedRef = useRef<{ live: string; sent: string } | null>(null);
  const listLoadsRef = useRef<Record<string, number>>({});
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const modeRowsLenRef = useRef(0);
  modeRowsLenRef.current = modeRowsSeen.length;
  const errorsLenRef = useRef(0);
  errorsLenRef.current = errorsSeen.length;

  const canonicalTarget = buffer?.target || target;

  // Reset modal session state whenever closed or switching channels
  useEffect(() => {
    setActiveTab('settings');
    setTopicDraft(null);
    setDraft({});
    setKeyRevealed(false);
    setSaving(false);
    setSaveError('');
    setModeRowsSeen([]);
    setErrorsSeen([]);
    setArmed(null);
    setLists({});
    setNewMask('');
    setListActionErrors({});
    setListBusy(false);
    savedFromRef.current.clear();
    topicSavedRef.current = null;
    listLoadsRef.current = {};

    if (open && networkId != null && canonicalTarget) {
      useBuffersStore.getState().ensureMembers(networkId, canonicalTarget);
      const curBuf = useBuffersStore.getState().findByTarget(networkId, canonicalTarget);
      if ((curBuf?.modes ?? '').includes('k')) {
        void useNetworksStore.getState().fetchAll().catch(() => {});
      }
    }
  }, [open, networkId, target]);

  const loadList = useCallback(
    async (letter: string) => {
      if (networkId == null || !LIST_NAMES[letter]) return;
      const load = (listLoadsRef.current[letter] ?? 0) + 1;
      listLoadsRef.current[letter] = load;
      const fromRow = modeRowsLenRef.current;
      const baseState: ListState = { status: 'loading', entries: [], error: '', fromRow };
      setLists((prev) => ({ ...prev, [letter]: baseState }));

      const result = await socketSendWithAck(
        { type: 'get-mode-list', networkId, channel: canonicalTarget, letter },
        { timeoutMs: LIST_ACK_TIMEOUT_MS },
      );
      if (listLoadsRef.current[letter] !== load) return;
      const data = (
        result as {
          data?: { entries?: ListEntry[]; error?: string; numeric?: string; text?: string };
        }
      ).data;
      if (result.ok && data?.entries) {
        setLists((prev) => ({
          ...prev,
          [letter]: { status: 'ready', entries: data.entries!, error: '', fromRow },
        }));
      } else {
        setLists((prev) => ({
          ...prev,
          [letter]: {
            status: 'error',
            entries: [],
            error: listErrorText(data ?? result),
            fromRow,
          },
        }));
      }
    },
    [networkId, canonicalTarget],
  );

  // Track live channel MODE & error rows while the modal is open
  useEffect(() => {
    if (!open || networkId == null || !canonicalTarget) return;
    const stopIrc = onIrcEvent((event) => {
      if (Number(event.networkId) !== Number(networkId)) return;
      if (String(event.target ?? '').toLowerCase() !== canonicalTarget.toLowerCase()) return;
      if (event.type === 'mode') {
        setModeRowsSeen((prev) => [
          ...prev,
          { nick: event.nick ?? null, time: event.time ?? null, modes: event.modes },
        ]);
      } else if (event.type === 'error') {
        setErrorsSeen((prev) => [
          ...prev,
          { text: String(event.text || event.message || 'Server error'), at: Date.now() },
        ]);
      }
    });
    const stopOpen = onSocketOpen(() => {
      const curTab = activeTabRef.current;
      setLists((prev) => {
        const next: Record<string, ListState> = {};
        if (curTab !== 'settings' && prev[curTab]) {
          next[curTab] = prev[curTab];
        }
        return next;
      });
      if (curTab !== 'settings') {
        void loadList(curTab);
      }
    });
    return () => {
      stopIrc();
      stopOpen();
    };
  }, [open, networkId, canonicalTarget, loadList]);

  // Fetch a list tab on first switch to it
  useEffect(() => {
    if (!open || activeTab === 'settings') return;
    if (!lists[activeTab]) {
      void loadList(activeTab);
    }
  }, [open, activeTab, lists, loadList]);

  const spec = useMemo(
    () =>
      netState?.modeSpec ?? (netState?.state === 'connected' ? DEFAULT_MODE_SPEC : null),
    [netState?.modeSpec, netState?.state],
  );
  const prefix = netState?.modeSpec?.prefix ?? DEFAULT_PREFIX;
  const selfModes = useMemo(() => {
    const nickLower = netState?.nick?.toLowerCase();
    if (!nickLower || !buffer) return [] as string[];
    return buffer.members.find((m) => m.nick.toLowerCase() === nickLower)?.modes ?? [];
  }, [netState?.nick, buffer]);

  const joined = !!buffer && buffer.joined !== false;
  const canEditModes = joined && hasRankAtLeast(selfModes, prefix, 'o');
  const canSetTopic =
    joined &&
    (!(buffer?.modes ?? '').includes('t') || hasRankAtLeast(selfModes, prefix, 'h'));

  const tabs = useMemo(
    () => [
      { id: 'settings', label: 'Settings' },
      ...Object.keys(LIST_NAMES)
        .filter((letter) => spec?.list.includes(letter))
        .map((letter) => ({ id: letter, label: LIST_NAMES[letter] })),
    ],
    [spec],
  );

  // If network modeSpec changes while on a list tab no longer present, fall back to settings
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) {
      setActiveTab('settings');
    }
  }, [tabs, activeTab]);

  // Topic derived state
  const topic = buffer?.topic ?? '';
  const topicShown = topicDraft ?? topic;
  const topicToSend = topicShown.replace(/[\r\n]+/g, ' ');
  const topicChanged = topicDraft !== null && topicToSend !== topic;
  const topicDraftRef = useRef(topicDraft);
  topicDraftRef.current = topicDraft;
  const topicToSendRef = useRef(topicToSend);
  topicToSendRef.current = topicToSend;
  const topicLen = spec?.topicLen ?? null;
  const topicSize = useMemo(() => topicBytes(topicToSend), [topicToSend]);
  const topicOver = topicLen != null && topicSize > topicLen;
  const topicCounter =
    canSetTopic && topicLen != null ? `${topicSize} / ${topicLen}` : '';
  const topicMeta = useMemo(() => {
    const by = buffer?.topicSetBy;
    const at = buffer?.topicSetAt;
    if (!topic || (!by && !at)) return '';
    return [by ? `Set by ${by}` : 'Set', at ? formatDateTime(at) : '']
      .filter(Boolean)
      .join(' · ');
  }, [topic, buffer?.topicSetBy, buffer?.topicSetAt]);

  const createdLabel = buffer?.createdAt ? `Created ${formatDate(buffer.createdAt)}` : undefined;

  // Channel key & live modes state
  const configKey = useMemo(() => {
    if (networkId == null) return null;
    const net = networks.find((n) => n.id === networkId);
    const channels = (net?.channels ?? []) as Array<{ name: string; key?: string | null }>;
    return channels.find((c) => c.name.toLowerCase() === canonicalTarget.toLowerCase())?.key ?? null;
  }, [networks, networkId, canonicalTarget]);

  const storedKey = useMemo(() => {
    const fromLive = lastKeyChange(modeRowsSeen);
    return fromLive !== undefined ? fromLive : configKey;
  }, [modeRowsSeen, configKey]);

  const live = useMemo<LiveModes>(() => {
    const modes = buffer?.modes ?? '';
    return {
      modes,
      params: {
        ...buffer?.modeParams,
        ...(storedKey && modes.includes('k') ? { k: storedKey } : {}),
      },
    };
  }, [buffer?.modes, buffer?.modeParams, storedKey]);

  // Reconcile draft rows once server state updates
  useEffect(() => {
    setDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [letter, want] of Object.entries(prev)) {
        const was = liveRow(live, letter);
        const matches = want.on === was.on && (!want.on || want.value.trim() === was.value);
        const saved = savedFromRef.current.get(letter);
        const moved = !!saved && saved.live !== rowKey(was);
        if (moved) savedFromRef.current.delete(letter);
        if (matches || (moved && saved.sent === rowKey(want))) {
          delete next[letter];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [live]);

  // Clear topic draft once server topic updates cleanly
  useEffect(() => {
    if (topicDraftRef.current === null) return;
    const curToSend = topicToSendRef.current;
    const saved = topicSavedRef.current;
    const moved = saved !== null && topic !== saved.live;
    if (curToSend === topic || (moved && curToSend === saved!.sent)) {
      setTopicDraft(null);
    }
    if (moved) topicSavedRef.current = null;
  }, [topic]);

  const shown = useCallback(
    (letter: string): DraftRow => draft[letter] ?? liveRow(live, letter),
    [draft, live],
  );

  const setOn = (letter: string, on: boolean) => {
    setDraft((prev) => ({
      ...prev,
      [letter]: { on, value: (prev[letter] ?? liveRow(live, letter)).value },
    }));
  };

  const setValue = (letter: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [letter]: { on: (prev[letter] ?? liveRow(live, letter)).on, value },
    }));
  };

  const ircd: IrcdFamily = profile?.ircd ?? 'unknown';
  const capCtx = useMemo(
    () =>
      buildCapabilityContext(netState, profile, {
        target: canonicalTarget,
        selfChannelModes: selfModes,
        channelModes: buffer?.modes ?? '',
      }),
    [netState, profile, canonicalTarget, selfModes, buffer?.modes],
  );
  const serverSummary = useMemo(() => formatServerSummary(capCtx), [capCtx]);
  const availableServices = useMemo(() => getAvailableServices(capCtx), [capCtx]);
  const selfRoleLabel = useMemo(() => describeSelfRole(selfModes, prefix), [selfModes, prefix]);
  const networkName = useMemo(
    () => networks.find((n) => n.id === networkId)?.name ?? '',
    [networks, networkId],
  );

  const activeModeItems = useMemo(() => {
    const raw = (buffer?.modes ?? '').replace(/^[+-]+/, '');
    const seen = new Set<string>();
    const items: Array<{ letter: string; name: string; description: string; value?: string }> = [];
    for (const letter of raw) {
      if (!letter || seen.has(letter)) continue;
      seen.add(letter);
      const meta = describeModeMeta(letter, ircd);
      const value =
        letter === 'k'
          ? storedKey || (buffer?.modeParams?.k && buffer.modeParams.k !== '*')
            ? 'key set'
            : undefined
          : buffer?.modeParams?.[letter];
      items.push({
        letter,
        name: meta.name ?? `Mode +${letter}`,
        description: meta.description,
        value,
      });
    }
    return items;
  }, [buffer?.modes, buffer?.modeParams, ircd, storedKey]);

  const hoveredActiveItem = useMemo(
    () => activeModeItems.find((item) => item.letter === hoveredActiveMode) ?? null,
    [activeModeItems, hoveredActiveMode],
  );

  const activeListMeta = useMemo(
    () => describeListMode(activeTab, ircd, profile?.isupport),
    [activeTab, ircd, profile?.isupport],
  );

  const rows = useMemo(() => (spec ? modeRows(spec, ircd) : []), [spec, ircd]);
  const visibleRows = useMemo(
    () => (canEditModes ? rows : rows.filter((r) => shown(r.letter).on)),
    [canEditModes, rows, shown],
  );
  const coreRows = useMemo(
    () => visibleRows.filter((r) => r.category === 'core'),
    [visibleRows],
  );
  const extendedRows = useMemo(
    () => visibleRows.filter((r) => r.category === 'extended'),
    [visibleRows],
  );
  const otherRows = useMemo(
    () => visibleRows.filter((r) => r.category === 'unknown'),
    [visibleRows],
  );
  const otherParams = useMemo(() => otherRows.filter((r) => r.kind !== 'flag'), [otherRows]);
  const otherFlags = useMemo(() => otherRows.filter((r) => r.kind === 'flag'), [otherRows]);
  const otherSetLetters = useMemo(
    () =>
      otherRows
        .filter((r) => shown(r.letter).on)
        .map((r) => r.letter)
        .join(''),
    [otherRows, shown],
  );

  const pending = useMemo(
    () => (spec ? modeChanges(spec, live, draft) : { changes: [] as OutgoingModeChange[] }),
    [spec, live, draft],
  );

  const dirty =
    topicChanged || 'error' in pending || pending.changes.length > 0;

  const armServerErrors = () => {
    setArmed({ from: errorsLenRef.current, at: Date.now(), tab: activeTab });
  };

  const serverErrors = useMemo(() => {
    if (!armed || armed.tab !== activeTab) return [] as string[];
    return errorsSeen
      .slice(armed.from)
      .filter((e) => e.at - armed.at < ERROR_WINDOW_MS)
      .map((e) => e.text);
  }, [armed, activeTab, errorsSeen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || saving || networkId == null) return;
    setSaveError('');
    if ('error' in pending) {
      setSaveError(pending.error);
      return;
    }
    if (topicChanged && topicOver) {
      setSaveError(`The topic is over the network's ${topicLen}-byte limit.`);
      return;
    }

    const topicToSave = topicChanged ? topicToSend : null;
    const changes = pending.changes;
    if (topicToSave !== null) {
      topicSavedRef.current = { live: topic, sent: topicToSave };
    }
    for (const change of changes) {
      savedFromRef.current.set(change.letter, {
        live: rowKey(liveRow(live, change.letter)),
        sent: rowKey(draft[change.letter] ?? liveRow(live, change.letter)),
      });
    }

    armServerErrors();
    setSaving(true);
    try {
      if (topicToSave !== null) {
        const err = await sendAck({
          type: 'set-topic',
          networkId,
          channel: canonicalTarget,
          topic: topicToSave,
        });
        if (err) {
          setSaveError(err);
          return;
        }
      }
      if (changes.length) {
        const err = await sendAck({
          type: 'set-channel-modes',
          networkId,
          channel: canonicalTarget,
          changes,
        });
        if (err) setSaveError(err);
      }
    } finally {
      setSaving(false);
    }
  };

  // List tab state & actions
  const activeListState: ListState = lists[activeTab] ?? {
    status: 'idle',
    entries: [],
    error: '',
    fromRow: 0,
  };
  const entries = useMemo(
    () =>
      patchModeList(
        activeListState.entries,
        modeRowsSeen.slice(activeListState.fromRow),
        activeTab,
      ),
    [activeListState, modeRowsSeen, activeTab],
  );
  const listActionError = listActionErrors[activeTab] ?? '';

  const listChange = async (sign: '+' | '-', mask: string): Promise<boolean> => {
    if (listBusy || networkId == null) return false;
    const letter = activeTab;
    setListBusy(true);
    armServerErrors();
    try {
      const err = await sendAck({
        type: 'set-channel-modes',
        networkId,
        channel: canonicalTarget,
        changes: [{ sign, letter, param: mask }],
      });
      setListActionErrors((prev) => ({ ...prev, [letter]: err }));
      return !err;
    } finally {
      setListBusy(false);
    }
  };

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const mask = newMask.trim();
    if (!mask) return;
    if (await listChange('+', mask)) setNewMask('');
  };

  if (!open || networkId == null) return null;

  const activeRung = getChannelNotifyRung(networkId, canonicalTarget);
  const activeRungMeta = NOTIFY_RUNGS.find((r) => r.id === activeRung);
  const activeTabInfo = tabs.find((t) => t.id === activeTab);

  const footer =
    activeTab === 'settings' ? (
      <>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        {(canSetTopic || canEditModes) && (
          <button
            type="submit"
            form={FORM_ID}
            className="btn-primary"
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </>
    ) : (
      <>
        <button
          type="button"
          className="btn-secondary"
          disabled={activeListState.status === 'loading'}
          onClick={() => void loadList(activeTab)}
        >
          Refresh
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </>
    );

  const renderModeRows = (list: ModeRow[]) => (
    <ul className="channel-modes">
      {list.map((row: ModeRow) => {
        const rowState = shown(row.letter);
        return (
          <li
            key={row.letter}
            className="channel-mode-row"
            data-active={rowState.on ? 'true' : 'false'}
          >
            <ChannelModeRow
              row={row}
              state={rowState}
              disabled={!canEditModes}
              revealed={keyRevealed}
              canReveal={!!storedKey && live.modes.includes('k')}
              onToggle={(on) => setOn(row.letter, on)}
              onValue={(val) => setValue(row.letter, val)}
              onReveal={() => setKeyRevealed((v) => !v)}
            />
          </li>
        );
      })}
    </ul>
  );

  const softwareHeading =
    ircd === 'unknown' ? 'Extended Modes' : `${SOFTWARE_LABELS[ircd]} Modes`;
  const hasKnownServices = serverSummary.servicesLabel !== 'Services Unknown';

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={canonicalTarget}
      subtitle={[networkName, createdLabel].filter(Boolean).join(' · ') || undefined}
      width="640px"
      footer={footer}
    >
      <div className="channel-control-banner" aria-label="Network and channel context">
        <div className="channel-control-chips">
          <span
            className="channel-info-pill software"
            title={`Detected server software: ${serverSummary.softwareLabel}`}
          >
            {serverSummary.softwareLabel}
          </span>
          {hasKnownServices && (
            <span
              className="channel-info-pill"
              title={`Detected services: ${serverSummary.servicesLabel}`}
            >
              Services: {serverSummary.servicesLabel}
            </span>
          )}
          {!hasKnownServices && availableServices.includes('ChanServ') && (
            <span className="channel-info-pill" title="ChanServ observed on this network">
              ChanServ
            </span>
          )}
          {joined && (
            <span className="channel-info-pill" title="Your permission level in this channel">
              Role: {selfRoleLabel}
            </span>
          )}
          {joined && buffer && buffer.members.length > 0 && (
            <span className="channel-info-pill">
              {buffer.members.length} {buffer.members.length === 1 ? 'member' : 'members'}
            </span>
          )}
        </div>

        {joined && (
          <div className="channel-active-summary">
            {activeModeItems.length > 0 ? (
              <>
                <div className="channel-active-pills" role="list" aria-label="Active channel modes">
                  {activeModeItems.map((item) => (
                    <button
                      key={item.letter}
                      type="button"
                      role="listitem"
                      className={`channel-active-pill${
                        hoveredActiveMode === item.letter ? ' hovered' : ''
                      }`}
                      title={`+${item.letter} ${item.name}: ${item.description}`}
                      onMouseEnter={() => setHoveredActiveMode(item.letter)}
                      onMouseLeave={() =>
                        setHoveredActiveMode((cur) => (cur === item.letter ? null : cur))
                      }
                      onFocus={() => setHoveredActiveMode(item.letter)}
                      onBlur={() =>
                        setHoveredActiveMode((cur) => (cur === item.letter ? null : cur))
                      }
                    >
                      <span className="channel-active-letter">+{item.letter}</span>
                      <span className="channel-active-name">{item.name}</span>
                      {item.value && <code className="channel-active-val">{item.value}</code>}
                    </button>
                  ))}
                </div>
                {hoveredActiveItem && (
                  <p className="channel-active-preview" role="status">
                    <strong>
                      +{hoveredActiveItem.letter} {hoveredActiveItem.name}
                    </strong>
                    <span> — {hoveredActiveItem.description}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="m-0 text-xs text-[var(--fg-muted)]">No channel modes currently set.</p>
            )}
          </div>
        )}
      </div>

      <div className="channel-tabs" role="tablist" aria-label="Channel settings">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className="channel-tab"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'settings' ? (
        <form id={FORM_ID} onSubmit={(e) => void handleSave(e)} className="space-y-4">
          {/* Topic */}
          <section className="channel-section">
            <span className="channel-section-label">Topic</span>
            {canSetTopic ? (
              <textarea
                rows={3}
                value={topicShown}
                spellCheck
                placeholder="Set a channel topic…"
                onChange={(e) => setTopicDraft(e.target.value)}
              />
            ) : topic ? (
              <p className="m-0 whitespace-pre-wrap break-words text-sm">
                <LinkedText text={topic} networkId={networkId} />
              </p>
            ) : !joined ? (
              <p className="m-0 text-xs text-[var(--fg-muted)]">
                Join the channel to see its topic.
              </p>
            ) : (
              <p className="m-0 text-xs text-[var(--fg-muted)]">No topic set.</p>
            )}
            {(topicMeta || topicCounter) && (
              <div className="channel-meta">
                <span>{topicMeta}</span>
                {topicCounter && <span className={topicOver ? 'over' : ''}>{topicCounter}</span>}
              </div>
            )}
          </section>

          <hr className="channel-divider" />

          {/* Modes */}
          <section className="channel-section">
            <div className="channel-section-header">
              <span className="channel-section-label">Modes</span>
              {spec && (
                <span className="text-[11px] text-[var(--fg-muted)]">
                  {ircd === 'unknown'
                    ? 'Generic IRCd rules'
                    : `${SOFTWARE_LABELS[ircd]} mode semantics`}
                </span>
              )}
            </div>
            {!spec ? (
              <p className="m-0 text-xs text-[var(--fg-muted)]">
                Modes show once the network is connected.
              </p>
            ) : !joined ? (
              <p className="m-0 text-xs text-[var(--fg-muted)]">
                Join the channel to see its modes.
              </p>
            ) : (
              <>
                {!canEditModes && (
                  <p className="m-0 text-xs text-[var(--fg-muted)]">
                    Only channel operators can change modes.
                  </p>
                )}
                {!canEditModes && visibleRows.length === 0 && (
                  <p className="m-0 text-xs text-[var(--fg-muted)]">No modes set.</p>
                )}
                {coreRows.length > 0 && (
                  <div className="channel-mode-group">
                    <div className="channel-mode-group-header">
                      <span>Core Modes</span>
                      <span className="channel-mode-group-count">
                        {coreRows.filter((r) => shown(r.letter).on).length} / {coreRows.length} active
                      </span>
                    </div>
                    {renderModeRows(coreRows)}
                  </div>
                )}
                {extendedRows.length > 0 && (
                  <div className="channel-mode-group">
                    <div className="channel-mode-group-header">
                      <span>{softwareHeading}</span>
                      <span className="channel-mode-group-count">
                        {extendedRows.filter((r) => shown(r.letter).on).length} /{' '}
                        {extendedRows.length} active
                      </span>
                    </div>
                    {renderModeRows(extendedRows)}
                  </div>
                )}
                {otherRows.length > 0 && (
                  <details className="channel-other-modes" open={!canEditModes}>
                    <summary>
                      Other modes
                      {otherSetLetters && (
                        <span className="ml-2 text-[var(--fg-muted)]">+{otherSetLetters}</span>
                      )}
                    </summary>
                    {otherParams.length > 0 && renderModeRows(otherParams)}
                    {otherFlags.length > 0 && (
                      <ul className="channel-modes bare">
                        {otherFlags.map((row: ModeRow) => {
                          const rowState = shown(row.letter);
                          return (
                            <li
                              key={row.letter}
                              className="channel-flag-chip"
                              data-active={rowState.on ? 'true' : 'false'}
                              title={`+${row.letter}: ${row.description}`}
                            >
                              <label className="channel-mode-toggle">
                                <input
                                  type="checkbox"
                                  checked={rowState.on}
                                  disabled={!canEditModes}
                                  onChange={(e) => setOn(row.letter, e.target.checked)}
                                />
                                <span className="channel-mode-tag">+{row.letter}</span>
                                <span className="channel-flag-desc">Unrecognized mode</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </details>
                )}
              </>
            )}
          </section>

          <hr className="channel-divider" />

          {/* Per-channel Notification Ladder (immediate user preference) */}
          <section className="channel-section">
            <div className="channel-section-header">
              <span className="channel-section-label">Notifications</span>
              <span className="text-[11px] text-[var(--fg-muted)]">Applies immediately</span>
            </div>
            <div className="btn-bar flex-wrap" role="group" aria-label="Channel notifications">
              {NOTIFY_RUNGS.map((rung) => (
                <button
                  key={rung.id}
                  type="button"
                  aria-pressed={activeRung === rung.id}
                  title={rung.hint}
                  onClick={() => setChannelNotifyRung(networkId, canonicalTarget, rung.id)}
                >
                  {rung.label}
                </button>
              ))}
            </div>
            {activeRungMeta && (
              <p className="m-0 text-xs text-[var(--fg-muted)]">{activeRungMeta.hint}</p>
            )}
          </section>

          {saveError && (
            <p role="alert" className="m-0 text-xs text-[var(--bad)]">
              {saveError}
            </p>
          )}
          {serverErrors.map((err, idx) => (
            <p key={idx} role="alert" className="m-0 text-xs text-[var(--bad)]">
              {err}
            </p>
          ))}
        </form>
      ) : (
        <div className="space-y-3">
          <div className="channel-list-banner">
            <div className="channel-list-banner-head">
              <div className="flex items-center gap-2">
                <span className="channel-mode-tag">+{activeListMeta.letter}</span>
                <strong className="text-xs">{activeListMeta.label}</strong>
              </div>
              {activeListMeta.maxEntries != null && (
                <span className="channel-info-pill">
                  Max {activeListMeta.maxEntries} entries
                </span>
              )}
            </div>
            <p className="m-0 text-xs text-[var(--fg-muted)]">{activeListMeta.description}</p>
            {activeListMeta.extbanHints.length > 0 && (
              <div className="channel-extban-hints">
                <span className="text-[11px] text-[var(--fg-muted)]">Extended masks:</span>
                {activeListMeta.extbanHints.map((hint) => (
                  <button
                    key={hint.prefix}
                    type="button"
                    className="channel-extban-chip"
                    disabled={!canEditModes}
                    title={`${hint.label} — e.g. ${hint.example}`}
                    onClick={() => {
                      if (!canEditModes) return;
                      setNewMask(hint.prefix);
                      maskInputRef.current?.focus();
                    }}
                  >
                    <code>{hint.prefix}</code>
                    <span>{hint.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {canEditModes && (
            <form onSubmit={(e) => void handleAddEntry(e)} className="flex gap-2">
              <input
                ref={maskInputRef}
                type="text"
                value={newMask}
                onChange={(e) => setNewMask(e.target.value)}
                placeholder={activeListMeta.maskPlaceholder}
                aria-label={`Add to ${activeTabInfo?.label || activeTab}`}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="flex-1 min-w-0"
              />
              <button
                type="submit"
                className="btn-secondary"
                disabled={!newMask.trim() || listBusy}
              >
                Add
              </button>
            </form>
          )}

          {listActionError && (
            <p role="alert" className="m-0 text-xs text-[var(--bad)]">
              {listActionError}
            </p>
          )}
          {serverErrors.map((err, idx) => (
            <p key={idx} role="alert" className="m-0 text-xs text-[var(--bad)]">
              {err}
            </p>
          ))}

          {activeListState.status === 'loading' && (
            <p className="m-0 text-xs text-[var(--fg-muted)]">Loading…</p>
          )}
          {activeListState.status === 'error' && (
            <p role="alert" className="m-0 text-xs text-[var(--bad)]">
              {activeListState.error}
            </p>
          )}
          {activeListState.status === 'ready' && entries.length === 0 && (
            <p className="m-0 text-xs text-[var(--fg-muted)]">Nothing here.</p>
          )}
          {activeListState.status === 'ready' && entries.length > 0 && (
            <ul className="channel-entries">
              {entries.map((entry) => {
                const meta = [
                  entry.setBy ? `by ${entry.setBy}` : '',
                  entry.setAt ? formatDateTime(entry.setAt) : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={entry.mask} className="channel-entry">
                    <div className="channel-entry-text">
                      <code className="channel-entry-mask text-xs">{entry.mask}</code>
                      {meta && <span className="text-[11px] text-[var(--fg-muted)]">{meta}</span>}
                    </div>
                    {canEditModes && (
                      <button
                        type="button"
                        className="channel-icon-btn"
                        title={`Remove ${entry.mask}`}
                        aria-label={`Remove ${entry.mask}`}
                        onClick={() => void listChange('-', entry.mask)}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </AppModal>
  );
};
