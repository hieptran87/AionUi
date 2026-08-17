/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import ZaloConfigForm from '@/renderer/components/settings/SettingsModal/contents/channels/ZaloConfigForm';

vi.mock('@/common/adapter/ipcBridge', () => ({
  assistants: {
    list: { invoke: vi.fn().mockResolvedValue([]) },
  },
  channel: {
    getPlatformSettings: { invoke: vi.fn().mockResolvedValue({ platform: 'zalo', assistant: null, default_model: null }) },
    getPendingPairings: { invoke: vi.fn().mockResolvedValue([]) },
    getAuthorizedUsers: { invoke: vi.fn().mockResolvedValue([]) },
    setAssistantSetting: { invoke: vi.fn().mockResolvedValue(undefined) },
    testPlugin: { invoke: vi.fn().mockResolvedValue({ success: true, bot_username: 'zalo_bot' }) },
    enablePlugin: { invoke: vi.fn().mockResolvedValue(undefined) },
    pairingRequested: { on: vi.fn().mockReturnValue(() => {}) },
    userAuthorized: { on: vi.fn().mockReturnValue(() => {}) },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (typeof fallback === 'object' && fallback?.defaultValue) return String(fallback.defaultValue);
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/GoogleModelSelector', () => ({
  default: () => <div data-testid='google-model-selector'>GoogleModelSelector</div>,
}));

describe('ZaloConfigForm', () => {
  const dummyModelSelection = {
    current_model: { id: 'p1', use_model: 'gemini-2.5-flash' },
    selectModel: vi.fn(),
  } as any;

  it('renders Zalo configuration fields and controls', () => {
    render(
      <ZaloConfigForm
        pluginStatus={null}
        modelSelection={dummyModelSelection}
        onStatusChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('zalo-config-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('zpw_enk=...')).toBeInTheDocument();
    expect(screen.getByText('Test & Connect')).toBeInTheDocument();
  });
});
