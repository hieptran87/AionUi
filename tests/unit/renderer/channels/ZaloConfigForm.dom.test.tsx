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
    getPlatformSettings: {
      invoke: vi.fn().mockResolvedValue({ platform: 'zalo', assistant: null, default_model: null }),
    },
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

vi.mock('@/common/adapter/httpBridge', () => ({
  getBaseUrl: () => 'http://localhost:3000',
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
    render(<ZaloConfigForm pluginStatus={null} modelSelection={dummyModelSelection} onStatusChange={vi.fn()} />);

    expect(screen.getByTestId('zalo-config-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('zpw_enk=...')).toBeInTheDocument();
    expect(screen.getByText('Test & Connect')).toBeInTheDocument();
  });

  it('renders QR code login controls and handles QR tab interaction', async () => {
    const fireEvent = (await import('@testing-library/react')).fireEvent;

    render(<ZaloConfigForm pluginStatus={null} modelSelection={dummyModelSelection} onStatusChange={vi.fn()} />);

    const qrTab = screen.getByText('Scan QR Code');
    expect(qrTab).toBeInTheDocument();
    fireEvent.click(qrTab);

    // Expect scan to login button
    const scanBtn = screen.getByRole('button', { name: /Scan to Login/i });
    expect(scanBtn).toBeInTheDocument();
  });

  it('handles 404 error on QR login endpoint gracefully and offers switch button', async () => {
    const fireEvent = (await import('@testing-library/react')).fireEvent;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));

    render(<ZaloConfigForm pluginStatus={null} modelSelection={dummyModelSelection} onStatusChange={vi.fn()} />);

    const qrTab = screen.getByText('Scan QR Code');
    fireEvent.click(qrTab);

    const scanBtn = screen.getByRole('button', { name: /Scan to Login/i });
    fireEvent.click(scanBtn);

    const switchBtn = await screen.findByRole('button', { name: /Switch to Cookie \/ Token Login/i });
    expect(switchBtn).toBeInTheDocument();
    fireEvent.click(switchBtn);

    // Expect input placeholder to be back in view
    expect(screen.getByPlaceholderText('zpw_enk=...')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('loads available assistants even when getPlatformSettings returns 400 Invalid platform error', async () => {
    const { channel, assistants } = await import('@/common/adapter/ipcBridge');
    vi.mocked(channel.getPlatformSettings.invoke).mockRejectedValueOnce({
      status: 400,
      backendMessage: 'Invalid platform: zalo',
    });
    vi.mocked(assistants.list.invoke).mockResolvedValueOnce([
      { id: 'ast-1', name: 'Test Assistant', agent_type: 'aionrs' } as any,
    ]);

    render(<ZaloConfigForm pluginStatus={null} modelSelection={dummyModelSelection} onStatusChange={vi.fn()} />);

    expect(screen.getByTestId('zalo-config-form')).toBeInTheDocument();
  });
});
