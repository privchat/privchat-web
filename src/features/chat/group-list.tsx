// GroupList — groups tab in the sidebar. Headless data from useGroupList.
//
// Group VM exposes `channel_id === group_id` (server invariant), so click
// can dispatch directly into ChatWorkspace's setActive without going
// through any "get-or-create" call. Empty state is normal: server-side
// eligibility may exclude the user from any visible group.
//
// Header carries a single Plus button that opens the create-group dialog.

import { lazy, Suspense, useState } from 'react';
import { Plus } from 'lucide-react';
import { CHANNEL_TYPE_GROUP, useGroupList } from '@privchat/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { Avatar } from './avatar';

// Create-group dialog only fires when the user taps "+". Pull it out
// of the main bundle so it lazy-loads on first open.
const GroupCreateDialog = lazy(() =>
  import('./group-create-dialog').then((m) => ({
    default: m.GroupCreateDialog,
  })),
);

export interface GroupListProps {
  onOpen: (channelId: string, channelType: number) => void;
  className?: string;
}

export function GroupList({ onOpen, className }: GroupListProps) {
  const { t } = useTranslation();
  const groups = useGroupList();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <header className="flex shrink-0 items-center justify-end gap-1 border-b px-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCreateOpen(true)}
          aria-label={t('groups.create_title')}
          title={t('groups.create_title')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {groups.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('groups.empty')}
          </div>
        )}
        <ul className="divide-y">
          {groups.map((group) => (
            <li key={group.group_id}>
              <button
                type="button"
                onClick={() => onOpen(group.channel_id, CHANNEL_TYPE_GROUP)}
                className="w-full text-left transition-colors hover:bg-accent flex items-center gap-3 px-3 py-3"
              >
                <Avatar
                  seed={`g:${group.group_id}`}
                  label={group.title}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {group.title}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <LazyGroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function LazyGroupCreateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mounted = useLazyMount(props.open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <GroupCreateDialog {...props} />
    </Suspense>
  );
}
