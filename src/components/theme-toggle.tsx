// Theme menu — three explicit choices in a dropdown so the picker shows
// what the options ARE (cycling-on-click made the current state hard to
// predict). Current preference is checkmarked.

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/app/theme-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ThemePreference } from '@/lib/theme';

const OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

const Icon = ({ pref }: { pref: ThemePreference }) => {
  if (pref === 'light') return <Sun className="h-4 w-4" />;
  if (pref === 'dark') return <Moon className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
};

export function ThemeToggle() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t(`theme.${preference}`)}
          title={t(`theme.${preference}`)}
        >
          <Icon pref={preference} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(v) => setPreference(v as ThemePreference)}
        >
          {OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt} value={opt}>
              <Icon pref={opt} />
              <span className="ml-2">{t(`theme.${opt}`)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
