import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdatePrompt } from './components/update-prompt';
import { ThemeProvider } from './app/theme-provider';
import { ErrorBoundary } from './app/error-boundary';
import { installGlobalErrorHandlers } from './lib/error-reporter';
import { applyBrand } from './lib/brand-config';
import './i18n';
import './index.css';

// Install once, before render. Pulls every uncaught error / unhandled
// promise rejection into the same reporter funnel that the React
// error boundary uses.
installGlobalErrorHandlers();

// 白标：document.title + 品牌 CSS 变量（构建期 env 固化）。
applyBrand();

const rootEl = document.getElementById('root');
if (rootEl === null) throw new Error('#root element not found in index.html');

// `VITE_PRIVCHAT_TEST_MODE === 'mock'` is set by the Playwright test
// build only. Production / local-dev builds: the import is statically
// false so Vite tree-shakes `TestApp` + the harness adapter out of
// the bundle, and we never ship a "log in as anyone" entry.
const TEST_MODE = import.meta.env.VITE_PRIVCHAT_TEST_MODE === 'mock';

async function bootstrap() {
  let Root: ComponentType;
  if (TEST_MODE) {
    const { TestApp } = await import('./test-harness/TestApp');
    Root = TestApp;
  } else {
    Root = App;
  }
  createRoot(rootEl!).render(
    <StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <Root />
          <UpdatePrompt />
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
