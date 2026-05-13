// Country dial-code catalog for the login phone-number picker.
//
// Kept small and curated rather than complete — the goal is Telegram-
// style "common countries first" not an exhaustive directory. Add
// entries as needed; the rendering layer (CountrySelect) doesn't
// require a particular ordering, but groups stay where listed.
//
// `code` is ISO 3166-1 alpha-2. `dial` is the international dialing
// prefix WITHOUT the leading "+". `flag` is the regional-indicator
// flag emoji built from the alpha-2 — useful as a fallback if a UI
// library doesn't render flags consistently across platforms.

export interface CountryEntry {
  /** ISO 3166-1 alpha-2 (e.g. "CN", "US"). Stable identifier. */
  code: string;
  /** International dial code without leading "+". e.g. "86", "1". */
  dial: string;
  /** English display name. UI shows this verbatim; i18n via translation
   *  is overkill — Telegram / WhatsApp render English names too. */
  name: string;
  /** Flag emoji derived from the ISO alpha-2. Renders natively in
   *  almost all browsers + OSes that support emoji. */
  flag: string;
}

/** Build the regional-indicator flag emoji from an ISO 3166-1 alpha-2. */
function flagFromCode(code: string): string {
  const BASE = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + BASE))
    .join('');
}

const RAW: Array<Omit<CountryEntry, 'flag'>> = [
  // Greater China + nearby — surfaced first since the app's primary
  // user base is here. Order within group is by user volume.
  { code: 'CN', dial: '86', name: 'China' },
  { code: 'HK', dial: '852', name: 'Hong Kong' },
  { code: 'TW', dial: '886', name: 'Taiwan' },
  { code: 'MO', dial: '853', name: 'Macau' },
  { code: 'SG', dial: '65', name: 'Singapore' },

  // SE Asia
  { code: 'VN', dial: '84', name: 'Vietnam' },
  { code: 'TH', dial: '66', name: 'Thailand' },
  { code: 'ID', dial: '62', name: 'Indonesia' },
  { code: 'PH', dial: '63', name: 'Philippines' },
  { code: 'MY', dial: '60', name: 'Malaysia' },
  { code: 'IN', dial: '91', name: 'India' },

  // East Asia
  { code: 'JP', dial: '81', name: 'Japan' },
  { code: 'KR', dial: '82', name: 'South Korea' },

  // English-speaking
  { code: 'US', dial: '1', name: 'United States' },
  { code: 'CA', dial: '1', name: 'Canada' },
  { code: 'GB', dial: '44', name: 'United Kingdom' },
  { code: 'AU', dial: '61', name: 'Australia' },
  { code: 'NZ', dial: '64', name: 'New Zealand' },

  // Europe
  { code: 'FR', dial: '33', name: 'France' },
  { code: 'DE', dial: '49', name: 'Germany' },
  { code: 'IT', dial: '39', name: 'Italy' },
  { code: 'ES', dial: '34', name: 'Spain' },
  { code: 'NL', dial: '31', name: 'Netherlands' },
  { code: 'PT', dial: '351', name: 'Portugal' },
  { code: 'RU', dial: '7', name: 'Russia' },
  { code: 'UA', dial: '380', name: 'Ukraine' },
  { code: 'PL', dial: '48', name: 'Poland' },
  { code: 'TR', dial: '90', name: 'Turkey' },

  // Latin America
  { code: 'BR', dial: '55', name: 'Brazil' },
  { code: 'MX', dial: '52', name: 'Mexico' },
  { code: 'AR', dial: '54', name: 'Argentina' },

  // Middle East
  { code: 'AE', dial: '971', name: 'United Arab Emirates' },
  { code: 'SA', dial: '966', name: 'Saudi Arabia' },
  { code: 'IL', dial: '972', name: 'Israel' },
];

export const COUNTRIES: ReadonlyArray<CountryEntry> = RAW.map((c) => ({
  ...c,
  flag: flagFromCode(c.code),
}));

/** Default country (China). Picked because the app's primary locale
 *  is zh-CN and the localPlatform dev server is China-based. */
export const DEFAULT_COUNTRY: CountryEntry = COUNTRIES[0]!;

/** Lookup by ISO alpha-2. Returns `undefined` for unknown codes
 *  rather than throwing — the consumer typically falls back to
 *  [DEFAULT_COUNTRY]. */
export function findCountry(code: string): CountryEntry | undefined {
  const upper = code.toUpperCase();
  return COUNTRIES.find((c) => c.code === upper);
}
