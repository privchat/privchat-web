import type { LocaleSchema } from './en';
import { zhCN } from './zh-CN';
import { zhTWWorkspace } from '../workspace';

// Existing screens retain the established Chinese fallback; WF-05 copy is localized.
export const zhTW: LocaleSchema = { ...zhCN, agentWorkspace: zhTWWorkspace };
