// i18next bootstrap. Registers the three resource bundles, configures
// detection (localStorage > navigator), and exports a typed `t` helper
// via the `useTranslation()` re-export.

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import { vi } from './locales/vi';
import { brandConfig } from '@/lib/brand-config';

export type SupportedLanguage = 'en' | 'zh-CN' | 'vi';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['zh-CN', 'en', 'vi'];

const STORAGE_KEY = 'privchat.web.lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      vi: { translation: vi },
    },
    supportedLngs: SUPPORTED_LANGUAGES,
    fallbackLng: 'en',
    interpolation: {
      // 品牌名插值:文案里用 {{brand}},白标包自动替换(brandConfig 单一真源)
      defaultVariables: { brand: brandConfig.appName },
      escapeValue: false, // React handles XSS escaping
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export default i18n;
