// SidebarTabs — three-way tab strip for the left rail (Chats / Contacts /
// Groups). Stateless: parent owns the active tab. Stays inside <aside> so
// on H5 it disappears together with the list pane when a panel is open.

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type SidebarTab = 'chats' | 'contacts' | 'groups';

const TABS: SidebarTab[] = ['chats', 'contacts', 'groups'];

export function SidebarTabs({
  active,
  onChange,
}: {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 border-b bg-card">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            'flex-1 px-2 py-2 text-sm font-medium transition-colors',
            'hover:bg-accent/50',
            active === tab
              ? 'border-b-2 border-primary text-foreground'
              : 'border-b-2 border-transparent text-muted-foreground',
          )}
        >
          {t(`tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
}
