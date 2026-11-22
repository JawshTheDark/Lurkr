// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import {
  Menu,
  Users,
  Search,
  MessageSquare,
  Settings,
  HelpCircle,
  Hash,
  User,
  Server,
  Shield,
  ShieldOff,
  KeyRound,
  PanelLeftOpen,
  Lock,
} from 'lucide-react';
import { useBuffersStore, type BufferMessage } from '../stores/buffers';
import { useE2eChannelsStore } from '../stores/e2eChannels';
import { activeBufferFrom, isNetworkOper, useNetworksStore, type Network } from '../stores/networks';
import { useOperStore } from '../stores/oper';
import { useThreadsStore } from '../stores/threads';
import { useSearchStore } from '../stores/search';
import { useReactionsStore } from '../stores/reactions';
import { useNicklistCollapseStore } from '../stores/nicklistCollapse';
import { useSettingsStore } from '../stores/settings';
import { useDesktopUiStore } from '../stores/desktopUi';
import { isChannelTarget } from '../shared/channels';
import { cycleActiveBuffer } from '../utils/cycleBuffers';
import { buildCapabilityContext, formatServerSummary } from '../lib/networkCapabilities';
import { useViewport } from '../hooks/useViewport';
import { BufferList } from '../components/BufferList';
import { ScrollingTopic } from '../components/ScrollingTopic';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { MemberList } from '../components/MemberList';
import { StatusBar } from '../components/StatusBar';
import { ThreadPanel } from '../components/ThreadPanel';
import { UploadsModal } from '../components/UploadsModal';
import { ReactionPickerModal } from '../components/ReactionPickerModal';
import { NetworkModal } from '../components/NetworkModal';
import { JoinChannelModal } from '../components/JoinChannelModal';
import { ChannelListModal } from '../components/ChannelListModal';
import { ChannelModal } from '../components/ChannelModal';
import { SearchModal } from '../components/SearchModal';
import { HighlightsModal } from '../components/HighlightsModal';
import { BookmarksModal } from '../components/BookmarksModal';
import { IgnoreModal } from '../components/IgnoreModal';
import { WhoisModal } from '../components/WhoisModal';
import { DccModal } from '../components/DccModal';
import { OperToolbar } from '../components/OperToolbar';
import { OperConsoleModal } from '../components/OperConsoleModal';
import { AppModal } from '../components/AppModal';

export const ChatView: React.FC = () => {
  const { isMobile } = useViewport();
  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const profiles = useNetworksStore((s) => s.profiles);
  const activeBuffer = useMemo(
    () => activeBufferFrom(activeKey, networks),
    [activeKey, networks],
  );
  const activeNetState = activeBuffer ? states[activeBuffer.networkId] : null;
  const activeProfile = activeBuffer ? profiles[activeBuffer.networkId] : undefined;
  const operSoftwareLabel = useMemo(() => {
    if (!activeNetState) return '';
    return formatServerSummary(buildCapabilityContext(activeNetState, activeProfile)).softwareLabel;
  }, [activeNetState, activeProfile]);
  const isOper = isNetworkOper(activeNetState);
  const operToolbarVisible = useOperStore((s) => s.toolbarVisible);
  const buffers = useBuffersStore((s) => s.buffers);
  const e2eChannelsByNet = useE2eChannelsStore((s) => s.byNetwork);
  void e2eChannelsByNet;
  const isE2eChannel = activeBuffer
    ? useE2eChannelsStore.getState().isEnabled(activeBuffer.networkId, activeBuffer.target)
    : false;
  const activeBufferObj = activeBuffer
    ? buffers[`${activeBuffer.networkId}::${activeBuffer.target}`]
    : undefined;
  const nicklistCollapsed = useNicklistCollapseStore((s) =>
    activeBuffer ? s.isCollapsed(activeBuffer.networkId, activeBuffer.target) : false,
  );

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false);

  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [networkModal, setNetworkModal] = useState<{ open: boolean; network?: Network | null }>({
    open: false,
    network: null,
  });
  const [joinModalNetId, setJoinModalNetId] = useState<number | null>(null);
  const [chanlistNetId, setChanlistNetId] = useState<number | null>(null);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<BufferMessage | null>(null);

  const settingsValues = useSettingsStore((s) => s.values);
  const showChannelList = useMemo(() => {
    void settingsValues;
    return useSettingsStore.getState().effective('look.layout.show_channel_list') !== false;
  }, [settingsValues]);
  const pendingChatAction = useDesktopUiStore((s) => s.pendingChatAction);

  // Quick Switcher (Ctrl/Cmd+K)
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');

  useEffect(() => {
    if (!pendingChatAction) return;
    const { action, nonce } = pendingChatAction;
    useDesktopUiStore.getState().consumeChatAction(nonce);
    switch (action) {
      case 'network:new':
        setNetworkModal({ open: true, network: null });
        break;
      case 'network:edit':
        if (activeBuffer?.network) {
          setNetworkModal({ open: true, network: activeBuffer.network });
        }
        break;
      case 'channel:join':
        if (activeBuffer) setJoinModalNetId(activeBuffer.networkId);
        else if (networks[0]) setJoinModalNetId(networks[0].id);
        break;
      case 'channel:list':
        if (activeBuffer) setChanlistNetId(activeBuffer.networkId);
        else if (networks[0]) setChanlistNetId(networks[0].id);
        break;
      case 'switcher:open':
        setSwitcherQuery('');
        setSwitcherOpen(true);
        break;
      case 'uploads:open':
        setUploadsOpen(true);
        break;
      case 'highlights:open':
        setHighlightsOpen(true);
        break;
      case 'bookmarks:open':
        setBookmarksOpen(true);
        break;
      case 'ignores:open':
        setIgnoreOpen(true);
        break;
      case 'irc:channel-settings':
        if (activeBuffer && isChannelTarget(activeBuffer.target)) {
          setChannelModalOpen(true);
        }
        break;
      case 'composer:paste-image':
        useDesktopUiStore.getState().triggerPasteImage();
        break;
    }
  }, [pendingChatAction, activeBuffer, networks]);

  useEffect(() => {
    if (window.lurkerDesktop?.onMenuAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && lower === 'k') {
        e.preventDefault();
        setSwitcherQuery('');
        setSwitcherOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && lower === 'f') {
        e.preventDefault();
        useSearchStore.getState().openSearch({
          networkId: activeBuffer?.networkId ?? null,
          target: activeBuffer?.target ?? null,
        });
      } else if ((e.ctrlKey || e.metaKey) && lower === 'j') {
        const nid = activeBuffer?.networkId ?? networks[0]?.id ?? null;
        if (nid !== null) {
          e.preventDefault();
          setJoinModalNetId(nid);
        }
      } else if ((e.ctrlKey || e.metaKey) && lower === 'l') {
        const nid = activeBuffer?.networkId ?? networks[0]?.id ?? null;
        if (nid !== null) {
          e.preventDefault();
          setChanlistNetId(nid);
        }
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') {
        e.preventDefault();
        cycleActiveBuffer(-1);
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') {
        e.preventDefault();
        cycleActiveBuffer(1);
      } else if (e.key === 'F1') {
        e.preventDefault();
        useDesktopUiStore.getState().openCommands();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeBuffer?.networkId, activeBuffer?.target, networks]);

  const switcherItems = useMemo(() => {
    const q = switcherQuery.trim().toLowerCase();
    return Object.values(buffers)
      .filter((b) => {
        if (!q) return true;
        return b.target.toLowerCase().includes(q);
      })
      .slice(0, 30);
  }, [buffers, switcherQuery]);

  const isChannel = activeBuffer ? isChannelTarget(activeBuffer.target) : false;
  const showMembersDesktop = !isMobile && isChannel && !nicklistCollapsed;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Desktop Sidebar */}
        {!isMobile && (
          showChannelList ? (
            <aside className="w-[268px] shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col min-h-0">
              <BufferList
                onOpenNetworkModal={(net) => setNetworkModal({ open: true, network: net || null })}
                onOpenJoinChannel={(nid) => setJoinModalNetId(nid)}
                onOpenChannelList={(nid) => setChanlistNetId(nid)}
                onOpenSearch={() =>
                  useSearchStore.getState().openSearch({
                    networkId: activeBuffer?.networkId ?? null,
                    target: activeBuffer?.target ?? null,
                  })
                }
                onOpenUploads={() => setUploadsOpen(true)}
                onOpenHighlights={() => setHighlightsOpen(true)}
                onOpenBookmarks={() => setBookmarksOpen(true)}
              />
            </aside>
          ) : (
            <div className="w-9 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col items-center pt-2">
              <button
                type="button"
                onClick={() =>
                  void useSettingsStore.getState().setValue('look.layout.show_channel_list', true)
                }
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                title="Show Channel List Sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </div>
          )
        )}

        {/* Mobile Sidebar Drawer */}
        {isMobile && mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 flex">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative z-10 w-72 max-w-[85vw] bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col h-full">
              <BufferList
                onOpenNetworkModal={(net) => {
                  setMobileSidebarOpen(false);
                  setNetworkModal({ open: true, network: net || null });
                }}
                onOpenJoinChannel={(nid) => {
                  setMobileSidebarOpen(false);
                  setJoinModalNetId(nid);
                }}
                onOpenChannelList={(nid) => {
                  setMobileSidebarOpen(false);
                  setChanlistNetId(nid);
                }}
                onOpenSearch={() => {
                  setMobileSidebarOpen(false);
                  useSearchStore.getState().openSearch({
                    networkId: activeBuffer?.networkId ?? null,
                    target: activeBuffer?.target ?? null,
                  });
                }}
                onOpenUploads={() => {
                  setMobileSidebarOpen(false);
                  setUploadsOpen(true);
                }}
                onOpenHighlights={() => {
                  setMobileSidebarOpen(false);
                  setHighlightsOpen(true);
                }}
                onOpenBookmarks={() => {
                  setMobileSidebarOpen(false);
                  setBookmarksOpen(true);
                }}
                onSelectBuffer={() => setMobileSidebarOpen(false)}
              />
            </aside>
          </div>
        )}

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Header */}
          <header className="h-12 shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="rounded-lg p-1.5 shrink-0 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <Menu className="w-4 h-4" />
                </button>
              )}

              {activeBuffer ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {isChannel ? (
                    <Hash className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  ) : activeBuffer.target === '*status' ? (
                    <Server className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  ) : (
                    <User className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  )}
                  <span
                    data-testid="header-channel-name"
                    className={
                      activeBufferObj?.topic
                        ? 'font-semibold text-sm shrink-0 whitespace-nowrap'
                        : 'font-semibold text-sm truncate'
                    }
                  >
                    {activeBuffer.target}
                  </span>
                  {isE2eChannel && (
                    <span
                      title="End-to-end encryption enabled"
                      className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 shrink-0"
                    >
                      <Lock className="w-2.5 h-2.5" />
                      E2E
                    </span>
                  )}
                  {activeBufferObj?.topic && (
                    <ScrollingTopic
                      topic={activeBufferObj.topic}
                      networkId={activeBuffer.networkId}
                    />
                  )}
                </div>
              ) : (
                <span className="text-sm font-semibold text-[var(--text-secondary)]">
                  Lurkr
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {activeBuffer && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      useSearchStore.getState().openSearch({
                        networkId: activeBuffer.networkId,
                        target: activeBuffer.target,
                      })
                    }
                    className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    title="Search (Ctrl+F)"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                  {activeBufferObj?.id != null && (
                    <button
                      type="button"
                      onClick={() => useThreadsStore.getState().openList(activeBufferObj.id!)}
                      className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      title="Threads"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  )}
                  {isChannel && (
                    <>
                      <button
                        type="button"
                        onClick={() => setChannelModalOpen(true)}
                        className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        title="Channel Settings"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isMobile) {
                            setMobileMembersOpen((v) => !v);
                          } else {
                            useNicklistCollapseStore
                              .getState()
                              .toggle(activeBuffer.networkId, activeBuffer.target);
                          }
                        }}
                        className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        title="Toggle Member List"
                      >
                        <Users className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </>
              )}
              {activeBuffer && activeNetState?.state === 'connected' && (
                isOper ? (
                  <button
                    type="button"
                    data-testid="header-oper-toggle"
                    onClick={() => useOperStore.getState().toggleToolbar()}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors ${
                      operToolbarVisible
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'text-amber-400 hover:bg-[var(--bg-hover)]'
                    }`}
                    title={operSoftwareLabel ? `Toggle Oper Toolbar — ${operSoftwareLabel}` : 'Toggle Oper Toolbar'}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>OPER</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="header-oper-login"
                    onClick={() =>
                      useOperStore.getState().openModal({
                        tab: 'auth',
                        networkId: activeBuffer.networkId,
                      })
                    }
                    className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    title="Oper Login (/oper)"
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setIgnoreOpen(true)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                title="Ignore Rules"
              >
                <ShieldOff className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => useDesktopUiStore.getState().openShortcuts()}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                title="Keyboard Shortcuts"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </header>

          <OperToolbar
            networkId={activeBuffer?.networkId ?? null}
            target={activeBuffer?.target ?? ''}
            netState={activeNetState}
          />

          {/* Message Area */}
          {activeBuffer && activeBufferObj ? (
            <>
              <div className="flex-1 min-h-0 flex flex-col">
                <MessageList
                  buffer={activeBufferObj}
                  onOpenReactionPicker={(msg) => setReactionTarget(msg)}
                />
              </div>
              <MessageInput
                networkId={activeBuffer.networkId}
                target={activeBuffer.target}
                onOpenUploadsModal={() => setUploadsOpen(true)}
                autoFocus
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <Server className="w-10 h-10 text-[var(--accent)] opacity-60" />
              <h2 className="text-lg font-semibold">
                {networks.length === 0 ? 'Welcome to Lurkr' : 'Select a channel or conversation'}
              </h2>
              <p className="text-xs text-[var(--text-muted)] max-w-sm">
                {networks.length === 0
                  ? 'Add an IRC network to start chatting, or press Ctrl+K to switch buffers.'
                  : 'Pick a buffer from the sidebar or press Ctrl+K to jump anywhere.'}
              </p>
              {networks.length === 0 && (
                <button
                  type="button"
                  onClick={() => setNetworkModal({ open: true, network: null })}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90"
                >
                  Add IRC Network
                </button>
              )}
            </div>
          )}
        </main>

        {/* Thread Drawer */}
        <ThreadPanel onOpenUploadsModal={() => setUploadsOpen(true)} />

        {/* Desktop Member List */}
        {showMembersDesktop && activeBuffer && (
          <div className="w-[210px] shrink-0 bg-[var(--bg-secondary)] flex flex-col min-h-0">
            <MemberList networkId={activeBuffer.networkId} target={activeBuffer.target} />
          </div>
        )}

        {/* Mobile Member List Drawer */}
        {isMobile && mobileMembersOpen && activeBuffer && isChannel && (
          <div className="fixed inset-0 z-40 flex justify-end">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileMembersOpen(false)}
            />
            <div className="relative z-10 w-64 max-w-[80vw] bg-[var(--bg-secondary)] flex flex-col h-full">
              <MemberList networkId={activeBuffer.networkId} target={activeBuffer.target} />
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar onOpenUploads={() => setUploadsOpen(true)} />

      {/* Modals */}
      <UploadsModal open={uploadsOpen} onClose={() => setUploadsOpen(false)} />

      <ReactionPickerModal
        open={!!reactionTarget}
        onClose={() => setReactionTarget(null)}
        onSelect={(emoji) => {
          if (reactionTarget && activeBuffer) {
            useReactionsStore
              .getState()
              .toggle(
                activeBuffer.networkId,
                activeBuffer.target,
                Number(reactionTarget.id),
                emoji,
              );
          }
        }}
      />

      <NetworkModal
        open={networkModal.open}
        editingNetwork={networkModal.network}
        onClose={() => setNetworkModal({ open: false, network: null })}
      />

      <JoinChannelModal
        open={joinModalNetId !== null}
        networkId={joinModalNetId}
        onClose={() => setJoinModalNetId(null)}
      />

      <ChannelListModal
        open={chanlistNetId !== null}
        networkId={chanlistNetId}
        onClose={() => setChanlistNetId(null)}
      />

      <ChannelModal
        open={channelModalOpen}
        networkId={activeBuffer?.networkId ?? null}
        target={activeBuffer?.target ?? ''}
        onClose={() => setChannelModalOpen(false)}
      />

      <SearchModal />
      <HighlightsModal open={highlightsOpen} onClose={() => setHighlightsOpen(false)} />
      <BookmarksModal open={bookmarksOpen} onClose={() => setBookmarksOpen(false)} />
      <IgnoreModal
        open={ignoreOpen}
        networkId={activeBuffer?.networkId ?? null}
        onClose={() => setIgnoreOpen(false)}
      />
      <WhoisModal />
      <OperConsoleModal />
      <DccModal />

      {/* Quick Switcher (Ctrl/Cmd+K) */}
      <AppModal
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        title="Quick Buffer Switcher"
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={switcherQuery}
            onChange={(e) => setSwitcherQuery(e.target.value)}
            placeholder="Jump to channel or DM..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {switcherItems.map((b) => (
              <button
                key={`${b.networkId}::${b.target}`}
                type="button"
                onClick={() => {
                  useBuffersStore.getState().activate(b.networkId, b.target);
                  setSwitcherOpen(false);
                }}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--bg-hover)]"
              >
                <span className="font-medium text-[var(--text-primary)]">{b.target}</span>
                <span className="text-[var(--text-muted)]">
                  {networks.find((n) => n.id === b.networkId)?.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </AppModal>
    </div>
  );
};
