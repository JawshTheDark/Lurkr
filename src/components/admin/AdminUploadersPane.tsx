// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAdminStore } from '../../stores/admin';
import { useToastsStore } from '../../stores/toasts';
import {
  emptyValues,
  missingRequired,
  valuesFrom,
  type AdminUploader,
  type UploaderDriver,
} from '../../utils/uploaders';

export const AdminUploadersPane: React.FC = () => {
  const uploaders = useAdminStore((s) => s.uploaders);
  const drivers = useAdminStore((s) => s.uploaderDrivers);
  const allowUserDefined = useAdminStore((s) => s.allowUserDefinedUploaders);
  const managed = useAdminStore((s) => s.uploadersManaged);
  const uploadCeilingMb = useAdminStore((s) => s.uploadCeilingMb);
  const loaded = useAdminStore((s) => s.uploadersLoaded);

  const [error, setError] = useState('');
  const [ceilingDraft, setCeilingDraft] = useState('');
  const [ceilingError, setCeilingError] = useState('');
  const [busy, setBusy] = useState(false);

  const [formMode, setFormMode] = useState<{ kind: 'add' } | { kind: 'edit'; row: AdminUploader } | null>(
    null,
  );
  const [selectedDriver, setSelectedDriver] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [valuesDraft, setValuesDraft] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setError('');
    useAdminStore
      .getState()
      .fetchUploaders()
      .catch((err: any) => setError(err?.message || 'Failed to load uploaders'));
  }, []);

  useEffect(() => {
    setCeilingDraft(uploadCeilingMb != null ? String(uploadCeilingMb) : '');
  }, [uploadCeilingMb]);

  const driverById = (id: string): UploaderDriver | undefined =>
    drivers.find((d) => d.driver === id);
  const addableDrivers = drivers.filter((d) => d.creatable);

  const openAdd = () => {
    const first = addableDrivers[0];
    if (!first) return;
    setSelectedDriver(first.driver);
    setLabelDraft(first.label);
    setValuesDraft(emptyValues(first));
    setFormError('');
    setFormMode({ kind: 'add' });
  };

  const openEdit = (row: AdminUploader) => {
    const drv = driverById(row.driver);
    if (!drv) return;
    setSelectedDriver(drv.driver);
    setLabelDraft(row.label);
    setValuesDraft(valuesFrom(drv, row.config));
    setFormError('');
    setFormMode({ kind: 'edit', row });
  };

  const runAction = async (fn: () => Promise<void>, fallbackErr: string) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || fallbackErr);
    } finally {
      setBusy(false);
    }
  };

  const activeDriver = driverById(selectedDriver);
  const isEditing = formMode?.kind === 'edit';
  const existingSecrets = isEditing ? formMode.row.secretsSet : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Uploaders</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Where uploaded files are stored. The default is used automatically when a user has not chosen their own.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {managed ? (
        <p className="text-xs text-[var(--text-muted)]">
          This instance&apos;s uploader is managed by the control plane.
          {uploadCeilingMb != null ? ` Uploads are capped at ${uploadCeilingMb.toLocaleString()} MB.` : ''}
        </p>
      ) : (
        loaded && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-[var(--text-primary)]">Upload ceiling (MB)</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Maximum size any user may upload per file.
                </div>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const mb = Number(ceilingDraft);
                  setCeilingError('');
                  if (!Number.isInteger(mb) || mb < 1) {
                    setCeilingError('Enter a whole number of MB (at least 1)');
                    return;
                  }
                  setBusy(true);
                  try {
                    await useAdminStore.getState().setUploadCeilingMb(mb);
                    useToastsStore.getState().push('Upload ceiling saved', 'success');
                  } catch (err: any) {
                    setCeilingError(err?.message || 'Failed to update upload ceiling');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={ceilingDraft}
                  disabled={busy || uploadCeilingMb == null}
                  onChange={(e) => setCeilingDraft(e.target.value)}
                  className="w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs"
                />
                <span className="text-[var(--text-muted)]">MB</span>
                <button
                  type="submit"
                  disabled={busy || uploadCeilingMb == null}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                >
                  Save
                </button>
              </form>
            </div>
            {ceilingError && <div className="text-[11px] text-red-400">{ceilingError}</div>}

            <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-[var(--border)]">
              <input
                type="checkbox"
                checked={allowUserDefined}
                disabled={busy}
                onChange={(e) =>
                  void runAction(
                    () => useAdminStore.getState().setAllowUserDefinedUploaders(e.target.checked),
                    'Failed to update uploader policy',
                  )
                }
                className="mt-0.5"
              />
              <span>
                Let users configure their own uploaders (Catbox, Zipline, S3, etc.). Turning this off hides adding personal uploaders without breaking existing ones.
              </span>
            </label>
          </div>
        )
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Instance Uploaders
        </h3>
        {!managed && addableDrivers.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={openAdd}
            className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
          >
            <Plus className="w-3.5 h-3.5" /> Add Uploader
          </button>
        )}
      </div>

      {!loaded && !error && (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">Loading uploaders...</div>
      )}

      {loaded && uploaders.length === 0 && !error && (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">
          No instance uploaders configured.
        </div>
      )}

      {formMode && activeDriver && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (missingRequired(activeDriver, valuesDraft, existingSecrets)) {
              setFormError('Fill in all required fields');
              return;
            }
            setFormError('');
            setBusy(true);
            try {
              if (formMode.kind === 'add') {
                await useAdminStore.getState().createUploader({
                  driver: activeDriver.driver,
                  label: labelDraft.trim() || activeDriver.label,
                  values: valuesDraft,
                });
              } else {
                await useAdminStore.getState().updateUploader(formMode.row.id, {
                  label: labelDraft.trim() || activeDriver.label,
                  values: valuesDraft,
                });
              }
              setFormMode(null);
            } catch (err: any) {
              setFormError(err?.message || 'Failed to save uploader');
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3 text-xs"
        >
          <div className="font-semibold text-sm">
            {isEditing ? `Edit ${formMode.row.label}` : 'Add Instance Uploader'}
          </div>
          {formError && <div className="text-red-400">{formError}</div>}

          {!isEditing && (
            <label className="block space-y-1">
              <span className="text-[var(--text-secondary)]">Provider</span>
              <select
                value={selectedDriver}
                onChange={(e) => {
                  const drv = driverById(e.target.value);
                  setSelectedDriver(e.target.value);
                  if (drv) {
                    setLabelDraft(drv.label);
                    setValuesDraft(emptyValues(drv));
                  }
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
              >
                {addableDrivers.map((d) => (
                  <option key={d.driver} value={d.driver}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Label</span>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>

          {activeDriver.configSchema.map((f) => {
            const secretAlreadySet = Boolean(f.type === 'secret' && existingSecrets?.[f.key]);
            return (
              <label key={f.key} className="block space-y-1">
                <span className="text-[var(--text-secondary)]">
                  {f.label}
                  {f.required && !secretAlreadySet ? ' *' : ''}
                </span>
                <input
                  type={f.type === 'secret' ? 'password' : 'text'}
                  value={valuesDraft[f.key] ?? ''}
                  placeholder={secretAlreadySet ? 'Already set (leave blank to keep)' : f.default || ''}
                  onChange={(e) =>
                    setValuesDraft((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
                />
                {f.description && (
                  <span className="block text-[11px] text-[var(--text-muted)]">{f.description}</span>
                )}
              </label>
            );
          })}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-white font-medium"
            >
              {busy ? 'Saving...' : 'Save Uploader'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setFormMode(null)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {uploaders.map((u) => {
          const drv = driverById(u.driver);
          const hasFields = (drv?.configSchema.length ?? 0) > 0;
          const deletable = !u.builtIn && !u.isDefault;
          return (
            <div
              key={u.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm text-[var(--text-primary)]">{u.label}</span>
                <span className="text-[var(--text-muted)]">{u.driver}</span>
                {u.isDefault && (
                  <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                    default
                  </span>
                )}
                {!u.enabled && (
                  <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    disabled
                  </span>
                )}
                {u.enabled && !u.offeredToUsers && (
                  <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    admin only
                  </span>
                )}
                {u.locked && (
                  <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    managed
                  </span>
                )}
              </div>

              {!managed && !u.locked && (
                <div className="flex flex-wrap items-center gap-2">
                  {!u.isDefault && (
                    <button
                      type="button"
                      disabled={busy || !u.enabled}
                      title={u.enabled ? undefined : 'Enable this uploader first'}
                      onClick={() =>
                        void runAction(
                          () => useAdminStore.getState().setDefaultUploader(u.id),
                          'Failed to set default uploader',
                        )
                      }
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-45"
                    >
                      Make Default
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () => useAdminStore.getState().updateUploader(u.id, { enabled: !u.enabled }),
                        'Failed to update uploader',
                      )
                    }
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    {u.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () =>
                          useAdminStore
                            .getState()
                            .updateUploader(u.id, { offeredToUsers: !u.offeredToUsers }),
                        'Failed to update uploader',
                      )
                    }
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    {u.offeredToUsers ? 'Hide from Users' : 'Offer to Users'}
                  </button>
                  {u.config && hasFields && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openEdit(u)}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                    >
                      Edit
                    </button>
                  )}
                  {deletable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          typeof window.confirm === 'function' &&
                          !window.confirm(`Delete uploader "${u.label}"?`)
                        ) {
                          return;
                        }
                        void runAction(
                          () => useAdminStore.getState().deleteUploader(u.id),
                          'Failed to delete uploader',
                        );
                      }}
                      className="ml-auto rounded border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10"
                      title="Delete uploader"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
