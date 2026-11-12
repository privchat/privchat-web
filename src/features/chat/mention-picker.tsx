// MentionPicker — 群成员 @选择下拉（MENTION_SPEC P0「客户端 @选择 UI」）。
// 由 ConversationPanel 在检测到 `@query` 时渲染于输入框上方；键盘上下/Enter
// 导航在 panel 侧处理，这里只负责呈现 + 鼠标选择/悬停。
import { useTranslation } from 'react-i18next';
import type { GroupMember } from '@privchat/sdk';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';

export function MentionPicker({
  members,
  activeIndex,
  onSelect,
  onHover,
}: {
  members: GroupMember[];
  activeIndex: number;
  onSelect: (member: GroupMember) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="shrink-0 border-t bg-popover px-2 py-1"
      data-testid="mention-picker"
      role="listbox"
      aria-label={t('mention.picker_label')}
    >
      {members.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground">
          {t('mention.empty')}
        </div>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {members.map((m, index) => {
            const uid = String(m.user_id);
            const display = m.display_name || m.nickname || m.username || `#${uid}`;
            return (
              <li key={uid} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  data-testid="mention-option"
                  data-uid={uid}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    index === activeIndex ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                  // mousedown 先于 textarea blur，避免点击瞬间输入框失焦。
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(m);
                  }}
                  onMouseEnter={() => onHover(index)}
                >
                  <Avatar seed={`u:${uid}`} label={display} size="sm" userId={uid} remoteUrl={m.avatar_url} />
                  <span className="min-w-0 flex-1 truncate font-medium">{display}</span>
                  {m.username !== '' && (
                    <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}