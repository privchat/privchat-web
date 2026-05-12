// Language menu — explicit picker. Same UX rationale as ThemeToggle:
// click cycling hides what the alternatives are. Replaces the previous
// rotating button.

import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';

const LABEL: Record<SupportedLanguage, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  vi: 'Tiếng Việt',
};

export function LangSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language) as SupportedLanguage;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Language: ${LABEL[current] ?? current}`}
          title={LABEL[current] ?? current}
        >
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(v) => void i18n.changeLanguage(v)}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang} value={lang}>
              {LABEL[lang] ?? lang}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
