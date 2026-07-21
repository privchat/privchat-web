// PrivacySettingsDialog — 「添加我的方式」+ 可搜索性个人隐私开关
// (PROFILE_VISIBILITY_SPEC §2.5)。服务端权威:开关即时 PATCH 到
// account/privacy/update,detail/apply 的裁决在服务端读取这些值,
// 本对话框只是设置入口,不做任何本地判定。
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrivchatClient } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { errorText } from '../chat/error-text';

interface PrivacyToggles {
  allow_add_by_group: boolean;
  allow_add_by_card: boolean;
  allow_search_by_username: boolean;
  allow_search_by_phone: boolean;
  allow_search_by_qrcode: boolean;
  allow_receive_message_from_non_friend: boolean;
}

const TOGGLE_KEYS: Array<keyof PrivacyToggles> = [
  'allow_add_by_group',
  'allow_add_by_card',
  'allow_search_by_username',
  'allow_search_by_phone',
  'allow_search_by_qrcode',
  'allow_receive_message_from_non_friend',
];

export function PrivacySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const adapter = usePrivchatClient();
  const [values, setValues] = useState<PrivacyToggles | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    adapter
      .privacyGet()
      .then((raw) => {
        setValues({
          allow_add_by_group: raw.allow_add_by_group !== false,
          allow_add_by_card: raw.allow_add_by_card !== false,
          allow_search_by_username: raw.allow_search_by_username !== false,
          allow_search_by_phone: raw.allow_search_by_phone !== false,
          allow_search_by_qrcode: raw.allow_search_by_qrcode !== false,
          allow_receive_message_from_non_friend:
            raw.allow_receive_message_from_non_friend !== false,
        });
      })
      .catch((e) => setError(errorText(e)));
  }, [open, adapter]);

  const toggle = useCallback(
    async (key: keyof PrivacyToggles, next: boolean) => {
      if (values === null) return;
      const prev = values;
      setValues({ ...values, [key]: next });
      try {
        await adapter.privacyUpdate({ [key]: next });
      } catch (e) {
        setValues(prev); // 回滚,服务端才是真源
        setError(errorText(e));
      }
    },
    [adapter, values],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('privacy.title')}</DialogTitle>
        </DialogHeader>
        {error !== null && (
          <div className="text-xs text-destructive">{error}</div>
        )}
        {values === null && error === null ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t('app.loading')}
          </div>
        ) : values !== null ? (
          <div className="space-y-1">
            <div className="pb-1 text-xs font-medium text-muted-foreground">
              {t('privacy.section_add_me')}
            </div>
            {TOGGLE_KEYS.map((key) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-md px-1 py-2"
              >
                <span className="text-sm">{t(`privacy.${key}`)}</span>
                <Switch
                  checked={values[key]}
                  onCheckedChange={(next) => void toggle(key, next)}
                />
              </label>
            ))}
            <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t('privacy.hint')}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
