import {test, expect} from '@playwright/test';
import {taskStageLabel} from '../../src/features/workspace/task-stage';
import {enWorkspace, zhWorkspace, zhTWWorkspace, viWorkspace} from '../../src/i18n/workspace';

const stages = [
  'development', 'reviewing', 'unassigned', 'development_pending',
  'development_blocked', 'waiting_user', 'awaiting_review', 'awaiting_acceptance',
  'review_pending', 'review_blocked', 'awaiting_review_record',
  'changes_requested', 'review_passed',
];

for (const [locale, copy] of Object.entries({en: enWorkspace, 'zh-CN': zhWorkspace, 'zh-TW': zhTWWorkspace, vi: viWorkspace})) {
  const translate = (key: string) => (copy as Record<string, string>)[key.replace('agentWorkspace.', '')] ?? key;
  for (const stage of stages) test(`${locale}: ${stage} is localized without exposing codes or falling back to an unrelated stage`, () => {
    const label = taskStageLabel({stage, item: {status: 'in_progress'}}, translate);
    expect(label).toBe((copy as Record<string, string>)[`stage_${stage}`]);
    expect(label).toBeTruthy();
    expect(label).not.toBe(stage);
    expect(label).not.toContain('agentWorkspace.');
    expect(label).not.toBe(copy.stage_unknown);
    if (stage !== 'development') expect(label).not.toBe(copy.stage_development);
  });

  for (const status of ['done', 'cancelled'] as const) test(`${locale}: closed ${status} uses the business status translation`, () => {
    expect(taskStageLabel({stage: 'closed', item: {status}}, translate)).toBe(copy[`status_${status}`]);
    expect(taskStageLabel({stage: 'development', item: {status}}, translate)).toBe(copy[`status_${status}`]);
  });

  for (const stage of [undefined, null, '', 'future_stage', 'accepted', 'failed', 'closed']) test(`${locale}: unknown or inconsistent ${stage} does not invent progress or closure`, () => {
    expect(taskStageLabel({stage, item: {status: 'open'}}, translate)).toBe(copy.stage_unknown);
  });
}
