// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import { useConfigStore } from '../stores/config';
import { useSettingsStore } from '../stores/settings';
import { previewableUrls } from '../utils/previewUrls';
import { MessageAttachment } from './MessageAttachment';

interface MessageAttachmentsProps {
  text: string;
}

export const MessageAttachments: React.FC<MessageAttachmentsProps> = ({ text }) => {
  const linkPreviewsEnabled = useConfigStore((s) => s.features.linkPreviews);
  const values = useSettingsStore((s) => s.values);

  if (!linkPreviewsEnabled || !text) return null;
  const settings = useSettingsStore.getState();
  const inlineMedia = settings.effective('chat.inline_media.enabled') === true;
  const linkPreviews = settings.effective('chat.link_previews.enabled') === true;
  void values;

  if (!inlineMedia && !linkPreviews) return null;
  const urls = previewableUrls(text, { inlineMedia, linkPreviews });
  if (!urls.length) return null;

  return (
    <div className="msg-attachments">
      {urls.map((u) => (
        <MessageAttachment
          key={u}
          url={u}
          inlineMedia={inlineMedia}
          linkPreviews={linkPreviews}
        />
      ))}
    </div>
  );
};
