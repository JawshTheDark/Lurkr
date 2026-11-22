// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import { AppModal } from './AppModal';
import { IgnoreRulesPanel } from './IgnoreRulesPanel';

interface IgnoreModalProps {
  open: boolean;
  networkId: number | null;
  onClose: () => void;
}

export const IgnoreModal: React.FC<IgnoreModalProps> = ({ open, networkId, onClose }) => {
  return (
    <AppModal open={open} onClose={onClose} title="Ignore Rules" maxWidth="max-w-lg">
      <IgnoreRulesPanel defaultNetworkId={networkId} />
    </AppModal>
  );
};
