// 白标品牌配置（构建期固化，来源 scripts/gen-web-env.mjs 生成的 .env.<brand>）。
// 品牌名/标语/主色统一从这里读 —— 禁止在页面里硬编码品牌名。

export interface BrandConfig {
  brandId: string;
  appName: string;
  tagline: string;
  themePrimary: string;
  themeAccent: string;
  gatewayUrl: string;
}

const env = import.meta.env;

export const brandConfig: BrandConfig = {
  brandId: (env.VITE_PRIVCHAT_BRAND_ID ?? '').trim() || 'privchat',
  appName: (env.VITE_PRIVCHAT_APP_NAME ?? '').trim() || 'PrivChat',
  tagline: (env.VITE_PRIVCHAT_TAGLINE ?? '').trim(),
  themePrimary: (env.VITE_PRIVCHAT_THEME_PRIMARY ?? '').trim(),
  themeAccent: (env.VITE_PRIVCHAT_THEME_ACCENT ?? '').trim(),
  gatewayUrl: (env.VITE_PRIVCHAT_GATEWAY_URL ?? '').trim(),
};

/** 注入品牌 CSS 变量 + document.title。App 启动时调用一次。
 *  业务语义色（红包红/转账橙等）不随品牌走（G1 规则）。 */
export function applyBrand(): void {
  document.title = brandConfig.appName;
  const root = document.documentElement;
  if (brandConfig.themePrimary !== '') {
    root.style.setProperty('--brand-primary', brandConfig.themePrimary);
  }
  if (brandConfig.themeAccent !== '') {
    root.style.setProperty('--brand-accent', brandConfig.themeAccent);
  }
}
