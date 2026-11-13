import type { ReactNode } from 'react';
import { ContactRound, LayoutGrid, MessagesSquare, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const destinations = [
  { id: 'chats', icon: MessagesSquare },
  { id: 'contacts', icon: ContactRound },
  { id: 'groups', icon: UsersRound },
  { id: 'workspace', icon: LayoutGrid },
] as const;

export type AppSection = typeof destinations[number]['id'];

export function AppRail({ section, platform, unread, onNavigate, children }: {
  section: AppSection;
  platform: boolean;
  unread: number;
  onNavigate: (section: AppSection) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center justify-between gap-1 border-t bg-sidebar px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 md:w-[62px] md:flex-col md:border-r md:border-t-0 md:py-3">
      <nav data-testid="app-nav" aria-label={t('app.name')} className="flex min-w-0 flex-1 items-center justify-around md:flex-col md:justify-start md:gap-1.5">
        {destinations.filter(({ id }) => id !== 'workspace' || platform).map(({ id, icon: Icon }) => {
          const label = t(`tabs.${id}`);
          return (
            <button
              key={id}
              type="button"
              data-testid={`nav-${id}`}
              title={label}
              aria-label={label}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
              className={cn(
                'relative flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] leading-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring md:w-11 md:flex-none md:px-0',
                section === id ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
              <span className="max-w-full truncate md:sr-only">{label}</span>
              {id === 'chats' && unread > 0 && (
                <span aria-hidden className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-destructive px-0.5 text-center text-[9px] leading-[14px] text-destructive-foreground">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
