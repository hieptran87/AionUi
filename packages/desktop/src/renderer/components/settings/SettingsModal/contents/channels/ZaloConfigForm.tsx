/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IChannelPairingRequest,
  IChannelPlatformSettings,
  IChannelPluginStatus,
  IChannelUser,
} from '@/common/types/channel/channel';
import { assistants, channel } from '@/common/adapter/ipcBridge';
import { isAionrsAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import { resolveLocaleKey } from '@/common/utils';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import GoogleModelSelector from '@/renderer/pages/conversation/platforms/gemini/GoogleModelSelector';
import type { GoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';
import { Alert, Button, Dropdown, Empty, Input, Menu, Message, Spin, Tabs } from '@arco-design/web-react';
import { CheckOne, CloseOne, Delete, Down, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import {
  buildChannelAssistantBinding,
  getDefaultChannelAssistant,
  resolveChannelAssistantSelection,
} from './assistantBinding';

const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, extra, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>{label}</span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-t-primary m-0'>{title}</h3>
    {action}
  </div>
);

interface ZaloConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GoogleModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
  onTokenChange?: (token: string) => void;
}

const getRemainingTime = (expiresAt: number) => {
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000 / 60));
  return `${remaining} min`;
};

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString();

const ZaloConfigForm: React.FC<ZaloConfigFormProps> = ({
  pluginStatus,
  modelSelection,
  onStatusChange,
  onTokenChange,
}) => {
  const { t, i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n?.language ?? 'en-US');

  const [authMode, setAuthMode] = useState<'token' | 'qr'>('token');
  const [zaloToken, setZaloToken] = useState('');
  const [zaloImei, setZaloImei] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [tokenTested, setTokenTested] = useState(false);
  const [testedBotUsername, setTestedBotUsername] = useState<string | null>(null);

  // QR Login state machine
  const [qrLoginState, setQrLoginState] = useState<
    'idle' | 'loading_qr' | 'showing_qr' | 'scanned' | 'connected' | 'error'
  >(pluginStatus?.hasToken && pluginStatus?.enabled ? 'connected' : 'idle');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Close EventSource on unmount to prevent connection leaks
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Pairing & Authorized Users state
  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);

  // Assistant Selection State
  const [availableAssistants, setAvailableAssistants] = useState<Assistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | null>(null);
  const [hasBrokenSavedAssistant, setHasBrokenSavedAssistant] = useState(false);

  // Load pending pairings
  const loadPendingPairings = useCallback(async () => {
    setPairingLoading(true);
    try {
      const pairings = await channel.getPendingPairings.invoke();
      if (pairings) {
        setPendingPairings(pairings.filter((p) => p.platformType === 'zalo'));
      }
    } catch (error) {
      console.error('[ZaloConfig] Failed to load pending pairings:', error);
    } finally {
      setPairingLoading(false);
    }
  }, []);

  // Load authorized users
  const loadAuthorizedUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const users = await channel.getAuthorizedUsers.invoke();
      if (users) {
        setAuthorizedUsers(users.filter((u) => u.platformType === 'zalo'));
      }
    } catch (error) {
      console.error('[ZaloConfig] Failed to load authorized users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPendingPairings();
    void loadAuthorizedUsers();
  }, [loadPendingPairings, loadAuthorizedUsers]);

  // Load available assistants + saved platform selection
  useEffect(() => {
    const loadAssistantsAndSelection = async () => {
      try {
        const assistantList = await assistants.list.invoke().catch((): Assistant[] => []);
        const saved: IChannelPlatformSettings = await channel.getPlatformSettings
          .invoke({ platform: 'zalo' })
          .catch((): IChannelPlatformSettings => ({ platform: 'zalo', assistant: null, default_model: null }));

        setAvailableAssistants(assistantList);

        const selection = resolveChannelAssistantSelection(saved.assistant ?? undefined, assistantList);
        const nextAssistant =
          assistantList.find((a) => a.id === selection.assistantId) ||
          (!selection.hasBrokenSavedAssistant ? getDefaultChannelAssistant(assistantList) : undefined) ||
          null;

        setHasBrokenSavedAssistant(selection.hasBrokenSavedAssistant);
        setSelectedAssistant(nextAssistant);
      } catch (error) {
        console.error('[ZaloConfig] Failed to load assistants:', error);
      }
    };

    void loadAssistantsAndSelection();
  }, []);

  const persistSelectedAssistant = async (assistant: Assistant) => {
    try {
      await channel.setAssistantSetting.invoke({
        platform: 'zalo',
        assistant: buildChannelAssistantBinding(assistant),
      });
      Message.success(t('settings.assistant.agentSwitched', 'Assistant switched successfully'));
    } catch (error) {
      console.warn('[ZaloConfig] Backend platform setting save skipped:', error);
      Message.success(t('settings.assistant.agentSwitched', 'Assistant switched successfully'));
    }
  };

  // Listen for pairing requests
  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
      if (request.platformType !== 'zalo') return;
      setPendingPairings((prev) => {
        if (prev.some((p) => p.code === request.code)) return prev;
        return [request, ...prev];
      });
    });
    return () => unsubscribe();
  }, []);

  // Listen for user authorization
  useEffect(() => {
    const unsubscribe = channel.userAuthorized.on((user) => {
      if (user.platformType !== 'zalo') return;
      setAuthorizedUsers((prev) => {
        if (prev.some((u) => u.id === user.id)) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, []);

  const handleAutoEnable = async (overrideToken?: string, overrideImei?: string) => {
    const tokenToUse = (overrideToken ?? zaloToken).trim();
    const imeiToUse = (overrideImei ?? zaloImei).trim();

    try {
      try {
        await channel.enablePlugin.invoke({
          plugin_id: 'zalo',
          config: { token: tokenToUse, imei: imeiToUse },
        });
      } catch (err: unknown) {
        console.warn('[ZaloConfig] Failed with plugin_id zalo, trying zalo_default:', err);
        await channel.enablePlugin.invoke({
          plugin_id: 'zalo_default',
          config: { token: tokenToUse, imei: imeiToUse },
        });
      }
      Message.success(t('settings.zalo.pluginEnabled', 'Zalo channel enabled'));
      onStatusChange({
        id: 'zalo',
        type: 'zalo',
        name: 'Zalo',
        enabled: true,
        connected: true,
        hasToken: true,
        activeUsers: authorizedUsers.length,
      });
    } catch (error) {
      console.error('[ZaloConfig] Failed to auto-enable plugin:', error);
    }
  };

  const handleTestConnection = async () => {
    if (!zaloToken.trim()) {
      Message.warning(t('settings.zalo.credentialsRequired', 'Please configure Zalo credentials or scan QR code'));
      return;
    }

    setTestLoading(true);
    setTokenTested(false);
    setTestedBotUsername(null);
    try {
      let result;
      try {
        result = await channel.testPlugin.invoke({
          plugin_id: 'zalo',
          token: zaloToken.trim(),
          extra_config: { imei: zaloImei.trim() },
        });
      } catch {
        result = await channel.testPlugin.invoke({
          plugin_id: 'zalo_default',
          token: zaloToken.trim(),
          extra_config: { imei: zaloImei.trim() },
        });
      }

      if (result.success) {
        setTokenTested(true);
        setTestedBotUsername(result.bot_username || null);
        Message.success(t('settings.zalo.connectionSuccess', 'Connected to Zalo!'));
        await handleAutoEnable();
      } else {
        setTokenTested(false);
        Message.error(result.error || t('settings.zalo.connectionFailed', 'Failed to connect to Zalo'));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(msg || t('settings.zalo.connectionFailed', 'Failed to connect to Zalo'));
    } finally {
      setTestLoading(false);
    }
  };

  const handleLoginQR = () => {
    setQrLoginState('loading_qr');
    setQrCodeData(null);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const loginUrl = `${getBaseUrl()}/api/channel/zalo/login`;
    const es = new EventSource(loginUrl);
    eventSourceRef.current = es;

    es.addEventListener('qr', (e: MessageEvent) => {
      try {
        const { qrcodeData } = JSON.parse(e.data) as { qrcodeData: string };
        if (qrcodeData) {
          setQrCodeData(qrcodeData);
          setQrLoginState('showing_qr');
        }
      } catch (err) {
        console.error('[ZaloConfig] Failed to parse QR event data:', err);
      }
    });

    es.addEventListener('scanned', () => {
      setQrLoginState('scanned');
    });

    es.addEventListener('done', (e: MessageEvent) => {
      es.close();
      try {
        const payload = JSON.parse(e.data) as {
          token?: string;
          imei?: string;
          cookie?: string;
          zaloCookies?: string;
          zaloImei?: string;
        };
        const token = (payload.token || payload.zaloCookies || payload.cookie || '').trim();
        const imei = (payload.imei || payload.zaloImei || '').trim();

        if (token) setZaloToken(token);
        if (imei) setZaloImei(imei);

        handleAutoEnable(token, imei).catch((err: unknown) => {
          console.error('[ZaloConfig] Failed to auto-enable plugin:', err);
        });
      } catch (err) {
        console.error('[ZaloConfig] Failed to parse done event data:', err);
      }
      setQrLoginState('connected');
    });

    es.addEventListener('error', () => {
      es.close();
      setQrLoginState((prevState) => {
        if (prevState === 'showing_qr' || prevState === 'scanned' || prevState === 'connected') {
          return prevState;
        }
        return 'error';
      });
    });

    es.onerror = () => {
      es.close();
      setQrLoginState((prevState) => {
        if (prevState === 'showing_qr' || prevState === 'scanned' || prevState === 'connected') {
          return prevState;
        }
        return 'error';
      });
    };
  };

  const handleApprovePairing = async (code: string) => {
    try {
      await channel.approvePairing.invoke({ code });
      Message.success(t('settings.assistant.pairingApproved', 'Pairing approved!'));
      void loadPendingPairings();
      void loadAuthorizedUsers();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(msg || t('common.actionFailed', 'Operation failed'));
    }
  };

  const handleRejectPairing = async (code: string) => {
    try {
      await channel.rejectPairing.invoke({ code });
      Message.info(t('settings.assistant.pairingRejected', 'Pairing rejected'));
      setPendingPairings((prev) => prev.filter((p) => p.code !== code));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(msg || t('common.actionFailed', 'Operation failed'));
    }
  };

  const handleRevokeUser = async (userId: string) => {
    try {
      await channel.revokeUser.invoke({ user_id: userId });
      Message.success(t('settings.assistant.userRevoked', 'User access revoked'));
      setAuthorizedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(msg || t('common.actionFailed', 'Operation failed'));
    }
  };

  const tokenLocked = authorizedUsers.length > 0;
  const isAionrsSelected = selectedAssistant ? isAionrsAssistant(selectedAssistant) : true;

  return (
    <div className='p-16px space-y-16px' data-testid='zalo-config-form'>
      <Tabs activeTab={authMode} onChange={(key) => setAuthMode(key as 'token' | 'qr')}>
        <Tabs.TabPane key='token' title={t('settings.zalo.cookieAuth', 'Cookie / Token')}>
          <div className='space-y-12px py-8px'>
            <div>
              <label className='text-12px font-500 text-t-primary mb-4px block'>
                {t('settings.zalo.sessionCookieLabel', 'Session Cookie / Token (zpw_enk)')}
              </label>
              <Input.Password
                value={zaloToken}
                onChange={(val) => {
                  setZaloToken(val);
                  setTokenTested(false);
                  onTokenChange?.(val);
                }}
                placeholder='zpw_enk=...'
                disabled={tokenLocked}
              />
            </div>
            <div>
              <label className='text-12px font-500 text-t-primary mb-4px block'>
                {t('settings.zalo.imeiLabel', 'Device IMEI (Optional)')}
              </label>
              <Input value={zaloImei} onChange={setZaloImei} placeholder='IMEI or Device ID' disabled={tokenLocked} />
            </div>
            <div className='flex items-center gap-12px pt-4px'>
              <Button type='primary' loading={testLoading} onClick={handleTestConnection} disabled={tokenLocked}>
                {t('settings.assistant.testConnect', 'Test & Connect')}
              </Button>
              {tokenTested && (
                <span className='text-12px text-success flex items-center gap-4px'>
                  <CheckOne theme='filled' />
                  {testedBotUsername ? `@${testedBotUsername}` : t('common.connected', 'Connected')}
                </span>
              )}
            </div>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane key='qr' title={t('settings.zalo.qrAuth', 'Scan QR Code')}>
          <div className='flex flex-col items-center justify-center p-16px text-center space-y-12px'>
            {qrLoginState === 'error' ? (
              <div className='flex flex-col items-center justify-center gap-12px max-w-360px mx-auto py-8px'>
                <Alert
                  type='warning'
                  content={t(
                    'settings.zalo.qrNotSupported',
                    'QR Code login endpoint is currently unavailable. Please use Cookie / Token login instead.'
                  )}
                />
                <Button type='primary' onClick={() => setAuthMode('token')}>
                  {t('settings.zalo.switchToCookie', 'Switch to Cookie / Token Login')}
                </Button>
              </div>
            ) : qrLoginState === 'connected' ? (
              <div className='text-success flex items-center gap-8px text-14px font-500'>
                <CheckOne theme='filled' className='text-18px' />
                {t('settings.zalo.qrConnected', 'Zalo QR session connected!')}
              </div>
            ) : qrLoginState === 'loading_qr' ? (
              <div className='w-160px h-160px bg-fill-2 flex flex-col items-center justify-center rounded-8px gap-8px text-12px text-t-tertiary'>
                <Spin size={20} />
                <span>{t('common.loading', 'Loading QR Code...')}</span>
              </div>
            ) : qrLoginState === 'showing_qr' || qrLoginState === 'scanned' ? (
              <>
                {qrCodeData ? (
                  qrCodeData.startsWith('data:') ? (
                    <img src={qrCodeData} className='w-160px h-160px object-contain' alt='Zalo QR Code' />
                  ) : (
                    <QRCodeSVG value={qrCodeData} size={160} />
                  )
                ) : (
                  <div className='w-160px h-160px bg-fill-2 flex items-center justify-center rounded-8px text-12px text-t-tertiary'>
                    {t('settings.zalo.qrPlaceholder', 'QR code will appear here')}
                  </div>
                )}
                {qrLoginState === 'scanned' ? (
                  <div className='flex items-center gap-6px text-13px text-t-secondary'>
                    <Spin size={14} />
                    <span>{t('settings.zalo.scanned', 'Scanned, waiting for confirmation...')}</span>
                  </div>
                ) : (
                  <div className='text-12px text-t-secondary'>
                    {t('settings.zalo.qrInstructions', 'Open Zalo mobile app and scan the QR code to log in.')}
                  </div>
                )}
                <Button size='small' icon={<Refresh />} onClick={handleLoginQR}>
                  {t('common.refresh', 'Refresh QR Code')}
                </Button>
              </>
            ) : (
              <>
                <div className='text-12px text-t-secondary mb-8px'>
                  {t('settings.zalo.qrInstructions', 'Open Zalo mobile app and scan the QR code to log in.')}
                </div>
                <Button type='primary' onClick={handleLoginQR}>
                  {t('settings.zalo.loginButton', 'Scan to Login')}
                </Button>
              </>
            )}
          </div>
        </Tabs.TabPane>
      </Tabs>

      {/* Assistant Selection Row */}
      <PreferenceRow
        label={t('settings.assistant.agentBinding', 'Assistant')}
        description={t('settings.assistant.agentBindingDesc', 'Select which assistant handles messages from Zalo')}
      >
        <Dropdown
          droplist={
            <Menu selectedKeys={selectedAssistant ? [selectedAssistant.id] : []}>
              {availableAssistants.map((ast) => (
                <Menu.Item
                  key={ast.id}
                  onClick={() => {
                    setSelectedAssistant(ast);
                    setHasBrokenSavedAssistant(false);
                    void persistSelectedAssistant(ast);
                  }}
                >
                  {resolveAssistantName(ast, localeKey)}
                </Menu.Item>
              ))}
            </Menu>
          }
          trigger='click'
        >
          <Button className='min-w-160px justify-between'>
            <span>
              {selectedAssistant
                ? resolveAssistantName(selectedAssistant, localeKey)
                : hasBrokenSavedAssistant
                  ? t('settings.assistant.unboundAgent', 'Unbound Assistant')
                  : t('settings.assistant.selectAgent', 'Select Assistant')}
            </span>
            <Down className='ml-8px' />
          </Button>
        </Dropdown>
      </PreferenceRow>

      {/* Default Model Row */}
      <PreferenceRow
        label={t('settings.assistant.defaultModel', 'Default Model')}
        description={
          isAionrsSelected
            ? t('settings.assistant.defaultModelDesc', 'Default AI model for Zalo conversations')
            : t('settings.assistant.followCliModel', 'Automatically follow the model when CLI is running')
        }
      >
        {isAionrsSelected ? (
          <GoogleModelSelector selection={modelSelection} />
        ) : (
          <Button disabled className='min-w-160px'>
            {t('settings.assistant.followCliModel', 'Follow CLI')}
          </Button>
        )}
      </PreferenceRow>

      {/* Pending Pairings */}
      <div className='pt-8px'>
        <SectionHeader
          title={t('settings.assistant.pendingPairings', 'Pending Pairings')}
          action={
            <Button icon={<Refresh />} size='small' loading={pairingLoading} onClick={loadPendingPairings}>
              {t('common.refresh', 'Refresh')}
            </Button>
          }
        />
        {pendingPairings.length === 0 ? (
          <Empty description={t('settings.assistant.noPendingPairings', 'No pending pairing requests')} />
        ) : (
          <div className='space-y-8px'>
            {pendingPairings.map((req) => (
              <div
                key={req.code}
                className='flex items-center justify-between p-12px bg-fill-2 rounded-8px border border-border-1'
              >
                <div>
                  <div className='text-14px font-500 text-t-primary'>{req.display_name || req.platformUserId}</div>
                  <div className='text-12px text-t-tertiary flex items-center gap-8px mt-2px'>
                    <span>
                      Code: <code className='font-mono font-600'>{req.code}</code>
                    </span>
                    <span>Expires in: {getRemainingTime(req.expiresAt)}</span>
                  </div>
                </div>
                <div className='flex items-center gap-8px'>
                  <Button
                    type='primary'
                    status='success'
                    size='small'
                    icon={<CheckOne />}
                    onClick={() => handleApprovePairing(req.code)}
                  >
                    {t('common.approve', 'Approve')}
                  </Button>
                  <Button
                    status='danger'
                    size='small'
                    icon={<CloseOne />}
                    onClick={() => handleRejectPairing(req.code)}
                  >
                    {t('common.reject', 'Reject')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Authorized Users */}
      <div className='pt-8px'>
        <SectionHeader
          title={t('settings.assistant.authorizedUsers', 'Authorized Users')}
          action={
            <Button icon={<Refresh />} size='small' loading={usersLoading} onClick={loadAuthorizedUsers}>
              {t('common.refresh', 'Refresh')}
            </Button>
          }
        />
        {authorizedUsers.length === 0 ? (
          <Empty description={t('settings.assistant.noAuthorizedUsers', 'No authorized users yet')} />
        ) : (
          <div className='space-y-8px'>
            {authorizedUsers.map((user) => (
              <div
                key={user.id}
                className='flex items-center justify-between p-12px bg-fill-2 rounded-8px border border-border-1'
              >
                <div>
                  <div className='text-14px font-500 text-t-primary'>{user.display_name || user.platformUserId}</div>
                  <div className='text-12px text-t-tertiary mt-2px'>Authorized: {formatTime(user.authorizedAt)}</div>
                </div>
                <Button status='danger' size='small' icon={<Delete />} onClick={() => handleRevokeUser(user.id)}>
                  {t('settings.assistant.revokeAccess', 'Revoke')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ZaloConfigForm;
