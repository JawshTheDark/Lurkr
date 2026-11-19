// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { initDesktopServerUrl, onAuthFailure, getServerUrl } from './api';
import { registerAllSessionResets } from './stores/registerResets';
import { useAuthStore } from './stores/auth';
import { useConfigStore } from './stores/config';
import { useSettingsStore } from './stores/settings';
import { useNetworksStore } from './stores/networks';
import { useTheme } from './hooks/useTheme';
import { connectSocket, resetSocket } from './services/socket';
import { ToastsOverlay } from './components/ToastsOverlay';
import { MediaViewerModal } from './components/MediaViewerModal';
import { AboutModal } from './components/AboutModal';
import { IrcCommandsModal } from './components/IrcCommandsModal';
import { IrcCommandPromptModal } from './components/IrcCommandPromptModal';
import { KeyboardHelpModal } from './components/KeyboardHelpModal';
import { useDesktopUiStore } from './stores/desktopUi';
import { useDesktopMenuBridge } from './hooks/useDesktopMenuBridge';
import { ChatView } from './views/ChatView';
import { LoginView } from './views/LoginView';
import { SettingsView } from './views/SettingsView';
import { AdminView } from './views/AdminView';
import { InviteAcceptView } from './views/InviteAcceptView';
import { AccountRecoveryView } from './views/AccountRecoveryView';
import { OAuthAuthorizeView } from './views/OAuthAuthorizeView';

registerAllSessionResets();

const AppRoutes: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const [bootstrapped, setBootstrapped] = useState(false);

  useTheme();
  useDesktopMenuBridge();
  const shortcutsOpen = useDesktopUiStore((s) => s.shortcutsOpen);
  const closeShortcuts = useDesktopUiStore((s) => s.closeShortcuts);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        await initDesktopServerUrl();
        if (getServerUrl() || typeof window.lurkerDesktop === 'undefined') {
          await useConfigStore.getState().fetch().catch(() => {});
          await useAuthStore.getState().fetchMe().catch(() => {});
        } else {
          useAuthStore.setState({ checked: true, user: null, error: null });
        }
      } finally {
        if (!useAuthStore.getState().checked) {
          useAuthStore.setState({ checked: true, user: null });
        }
        if (!cancelled) setBootstrapped(true);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onAuthFailure(() => {
      navigate('/login');
    });
  }, [navigate]);

  useEffect(() => {
    if (!window.lurkerDesktop?.onNavigate) return;
    return window.lurkerDesktop.onNavigate((route: string) => {
      navigate(route);
    });
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      resetSocket();
      return;
    }
    useSettingsStore.getState().fetchAll().catch(() => {});
    useNetworksStore.getState().fetchAll().catch(() => {});
    connectSocket();
  }, [user]);

  if (!bootstrapped || !checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] gap-2 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
        <span>Loading Lurkr...</span>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route path="/invite/:token" element={<InviteAcceptView />} />
        <Route path="/recover/:token" element={<AccountRecoveryView />} />
        <Route path="/oauth/authorize" element={<OAuthAuthorizeView />} />
        <Route
          path="/settings"
          element={user ? <SettingsView /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/admin"
          element={
            user ? (
              user.role === 'admin' ? (
                <AdminView />
              ) : (
                <Navigate to="/" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/"
          element={user ? <ChatView /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastsOverlay />
      <MediaViewerModal />
      <AboutModal />
      <IrcCommandsModal />
      <IrcCommandPromptModal />
      <KeyboardHelpModal open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  );
};

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[lurkr] render error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-6">
          <div className="max-w-md w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
            <h1 className="text-base font-semibold text-red-400">Something went wrong</h1>
            <p className="text-xs text-[var(--text-secondary)] break-words">
              {this.state.error.message || 'An unexpected UI error occurred.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.hash = '#/';
                  window.location.reload();
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.hash = '#/login';
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                Back to Login
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const App: React.FC = () => {
  return (
    <HashRouter>
      <AppErrorBoundary>
        <AppRoutes />
      </AppErrorBoundary>
    </HashRouter>
  );
};

export default App;
