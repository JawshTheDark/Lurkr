// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  FolderOpen,
  Globe,
  HardDrive,
  Settings,
  ShieldAlert,
  Ticket,
  Upload,
  Users,
} from 'lucide-react';
import { useAdminStore } from '../stores/admin';
import { useConfigStore } from '../stores/config';
import { DEFAULT_ADMIN_TAB, visibleAdminTabs } from '../utils/adminRegistry';
import { AdminUsersPane } from '../components/admin/AdminUsersPane';
import { AdminInvitesPane } from '../components/admin/AdminInvitesPane';
import { AdminUploadersPane } from '../components/admin/AdminUploadersPane';
import { AdminNetworksPane } from '../components/admin/AdminNetworksPane';
import { AdminNotificationsPane } from '../components/admin/AdminNotificationsPane';
import { AdminStoragePane } from '../components/admin/AdminStoragePane';
import { AdminLockoutsPane } from '../components/admin/AdminLockoutsPane';
import { AdminGeneralPane } from '../components/admin/AdminGeneralPane';
import { AdminDccPane } from '../components/admin/AdminDccPane';

const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  users: Users,
  invites: Ticket,
  uploaders: Upload,
  networks: Globe,
  notifications: Bell,
  storage: HardDrive,
  lockouts: ShieldAlert,
  general: Settings,
  dcc: FolderOpen,
};

export const AdminView: React.FC = () => {
  const navigate = useNavigate();
  const edition = useConfigStore((s) => s.edition);
  const isNode = edition === 'node';
  const tabs = visibleAdminTabs(isNode);

  const usersLoaded = useAdminStore((s) => s.usersLoaded);
  const usersCount = useAdminStore((s) => s.users.length);
  const invitesLoaded = useAdminStore((s) => s.invitesLoaded);
  const invitesCount = useAdminStore((s) => s.invites.length);
  const uploadersLoaded = useAdminStore((s) => s.uploadersLoaded);
  const uploadersCount = useAdminStore((s) => s.uploaders.length);
  const networksLoaded = useAdminStore((s) => s.networksLoaded);
  const networksCount = useAdminStore((s) => s.networks.length);
  const lockoutsLoaded = useAdminStore((s) => s.lockoutsLoaded);
  const lockoutsCount = useAdminStore((s) => s.lockouts.length);

  const [tab, setTab] = useState<string>(DEFAULT_ADMIN_TAB);

  useEffect(() => {
    void useConfigStore.getState().fetch();
  }, []);

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) {
      setTab(tabs[0]?.id || DEFAULT_ADMIN_TAB);
    }
  }, [tab, tabs]);

  const badgeCountFor = (id: string): number | null => {
    switch (id) {
      case 'users':
        return usersLoaded ? usersCount : null;
      case 'invites':
        return invitesLoaded ? invitesCount : null;
      case 'uploaders':
        return uploadersLoaded ? uploadersCount : null;
      case 'networks':
        return networksLoaded ? networksCount : null;
      case 'lockouts':
        return lockoutsLoaded ? lockoutsCount : null;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--bg-hover)]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Chat
          </button>
          <h1 className="text-base font-semibold">Server Administration</h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-region">
        <div className="max-w-5xl w-full mx-auto p-5 space-y-5">
          <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
            {tabs.map((t) => {
              const Icon = TAB_ICONS[t.id] || Settings;
              const count = badgeCountFor(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                    tab === t.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{count !== null ? `${t.label} (${count})` : t.label}</span>
                </button>
              );
            })}
          </div>

          {tab === 'users' && <AdminUsersPane />}
          {tab === 'invites' && <AdminInvitesPane />}
          {tab === 'uploaders' && <AdminUploadersPane />}
          {tab === 'networks' && <AdminNetworksPane />}
          {tab === 'notifications' && <AdminNotificationsPane />}
          {tab === 'storage' && <AdminStoragePane />}
          {tab === 'lockouts' && <AdminLockoutsPane />}
          {tab === 'general' && <AdminGeneralPane />}
          {tab === 'dcc' && !isNode && <AdminDccPane />}
        </div>
      </div>
    </div>
  );
};
