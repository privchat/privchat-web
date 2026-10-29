import { useEffect, useRef, useState } from 'react';
import { usePrivchatClient } from '@privchat/react';
import type { LocationMetadataVM } from '@privchat/react';
import { encodeMessagePayloadEnvelope } from '@privchat/sdk';
import { openLocationDialog, providerFactories, MapError } from '@privchat/location-web';
import type { Crs, Preference, Selection, ComponentConfig } from '@privchat/location-web';
import { loadSession } from '../../lib/session-storage';
import { locationComponents } from './location-components';

const labels = {
  title: '位置', close: '关闭', search: '搜索地点', locate: '我的位置', send: '发送位置',
  consent: '同意将地图浏览和搜索请求发送给所选地图服务商', load: '加载地图',
  name: '位置名称（可选）', external: '外部地图', manual: '使用输入的 WGS-84 坐标',
  latitude: '纬度', longitude: '经度', loading: '正在加载…', noResults: '没有找到地点',
};
const errors: Record<string, string> = {
  CONFIGURATION: '地图配置不完整，请检查已构建的服务商、Key 和域名限制。',
  CONSENT: '尚未授权。你仍可手动输入位置，定位失败不会关闭页面。',
  UNSUPPORTED: '当前地图不支持此坐标系，未自动转换或切换地图。',
  CONTENT_RESTRICTED: '此地图返回的内容尚未获准长期保存到聊天记录，不能发送。',
  NETWORK: '地图服务请求失败，请稍后重试。', CANCELLED: '操作已取消。', RESOURCE_LIMIT: '打开的地图过多，请先关闭其他地图。',
};

export function useLocationDialog(channelId?: string, channelType?: number) {
  const adapter = usePrivchatClient();
  const [available, setAvailable] = useState(false);
  const operation = useRef(0);
  const close = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    let revision: string | undefined;
    const refresh = async () => {
      try {
        const config = await locationComponents.load();
        if (disposed) return;
        const maps = config.components.maps;
        const enabled = maps.enabled && Object.keys(providerFactories).length > 0;
        setAvailable(enabled);
        if (!enabled || (revision !== undefined && revision !== config.revision)) close.current?.();
        revision = config.revision;
      } catch { if (!disposed) { setAvailable(false); close.current?.(); } }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { disposed = true; operation.current++; clearInterval(timer); close.current?.(); };
  }, [adapter, channelId]);
  const open = async (metadata?: LocationMetadataVM) => {
    close.current?.();
    const session = loadSession();
    if (!session) return;
    const ticket = ++operation.current;
    const identity = JSON.stringify([session.url, session.user_id, session.saved_at]);
    let componentConfig: ComponentConfig;
    try { componentConfig = await locationComponents.load(); }
    catch { setAvailable(false); return; }
    const active = loadSession();
    if (ticket !== operation.current || !active || JSON.stringify([active.url, active.user_id, active.saved_at]) !== identity) return;
    const maps = componentConfig.components.maps;
    if (!maps.enabled) { setAvailable(false); return; }
    const preferenceKey = `privchat.location.preference:${JSON.stringify([session.url, session.user_id])}`;
    let preference: Preference = 'AUTO';
    try {
      const value = localStorage.getItem(preferenceKey);
      if (value === 'AUTO' || value === 'GOOGLE' || value === 'AMAP') preference = value;
    } catch { /* Storage denied: preference remains session-only. */ }
    const securityProxy = (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_AMAP_SECURITY_PROXY;
    const initial: Selection | undefined = metadata && {
      point: { latitude: metadata.latitude, longitude: metadata.longitude, crs: (metadata.coordinate_system || 'wgs84') as Crs },
      pointSource: 'unknown', name: metadata.name, nameSource: 'unknown', address: metadata.address, addressSource: 'unknown',
    };
    close.current = openLocationDialog({
      factories: Object.fromEntries(Object.entries(providerFactories).filter(([id]) => id in maps.providers)),
      config: Object.fromEntries(Object.entries(maps.providers).map(([id, config]) =>
        [id, { key: config!.sdkKey, consent: false, ...(id === 'AMAP' ? { securityProxy } : {}) }])),
      preference, defaultPreference: maps.defaultProvider,
      region: navigator.language.toLowerCase() === 'zh-cn' ? 'mainland' : 'other', initial, labels,
      onPreference(value) { try { localStorage.setItem(preferenceKey, value); } catch { /* no persistence available */ } },
      error: code => errors[code] ?? errors.NETWORK!,
      onSend: metadata || channelId === undefined || channelType === undefined ? undefined : async message => {
        const active = loadSession();
        if (!active || JSON.stringify([active.url, active.user_id, active.saved_at]) !== identity) throw new MapError('CANCELLED');
        const content = message.name ?? `${message.latitude}, ${message.longitude}`;
        await adapter.sendTextMessage({ channel_id: channelId, channel_type: channelType, from_uid: session.user_id,
          message_type: 8, content, payload_encoding: 'message_envelope',
          payload: encodeMessagePayloadEnvelope({ content, metadata: { type: 'location', ...message }, mentioned_user_ids: [] }),
        });
      },
    });
  };
  return { open, enabled: available };
}
