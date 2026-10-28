import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { WorkspaceApi, WorkspaceInboxEntry } from './api';
import { permissionDetails } from './permission-details';

const en = {
  title: 'Waiting for you', empty: 'Nothing is waiting.', error: 'Could not load or submit. Retry the same action.', reload: 'Reload',
  decision: 'Decision', review_cycle: 'Review cycle stopped', approval: 'Approval', failure: 'Execution failed',
  failed: 'Failed', unknown: 'Result not confirmed', approve: 'Allow once', deny: 'Deny',
  noDetails: 'Details unavailable; approve from this device only.', notYours: 'Only the person who started it can act on this.',
  recommended: 'Recommended', confirm: 'Submit this answer? It cannot be changed.',
};
type Labels = typeof en;
const zh: Labels = {
  title: '待你处理', empty: '暂无待处理事项。', error: '读取或提交失败，请重试同一操作。', reload: '重新读取',
  decision: '待决策', review_cycle: '评审循环已停下', approval: '待审批', failure: '执行失败',
  failed: '失败', unknown: '结果未确认', approve: '允许一次', deny: '拒绝',
  noDetails: '详情不可读，只能在本机审批。', notYours: '只有发起人可以处理。',
  recommended: '推荐', confirm: '确认提交？提交后不能修改。',
};
const zhTW: Labels = {
  title: '待你處理', empty: '暫無待處理事項。', error: '讀取或提交失敗，請重試同一操作。', reload: '重新讀取',
  decision: '待決策', review_cycle: '評審循環已停下', approval: '待審批', failure: '執行失敗',
  failed: '失敗', unknown: '結果未確認', approve: '允許一次', deny: '拒絕',
  noDetails: '詳情不可讀，只能在本機審批。', notYours: '只有發起人可以處理。',
  recommended: '推薦', confirm: '確認提交？提交後不能修改。',
};
const vi: Labels = {
  title: 'Đang chờ bạn', empty: 'Không có việc nào đang chờ.', error: 'Không thể tải hoặc gửi. Hãy thử lại cùng thao tác.', reload: 'Tải lại',
  decision: 'Cần quyết định', review_cycle: 'Vòng đánh giá đã dừng', approval: 'Cần phê duyệt', failure: 'Thực thi thất bại',
  failed: 'Thất bại', unknown: 'Chưa xác nhận kết quả', approve: 'Cho phép một lần', deny: 'Từ chối',
  noDetails: 'Không đọc được chi tiết; chỉ có thể duyệt trên thiết bị này.', notYours: 'Chỉ người khởi tạo mới xử lý được.',
  recommended: 'Đề xuất', confirm: 'Gửi câu trả lời này? Không thể thay đổi sau đó.',
};

function useLabels() {
  const {i18n} = useTranslation();
  const language = i18n.language;
  const labels = /zh-(TW|HK|Hant)/i.test(language) ? zhTW : language.startsWith('zh') ? zh : language.startsWith('vi') ? vi : en;
  return (key: keyof Labels) => labels[key];
}

/** One list of everything waiting for a person; answers go through each record's own API. */
export function WorkspaceInbox({api, workspaceId, onCount}: {api: WorkspaceApi; workspaceId: string; onCount?: (count: number) => void}) {
  const l = useLabels();
  const [entries, setEntries] = useState<WorkspaceInboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const live = useRef(false);
  // A retry of the same entry reuses its request id, so a lost response never answers twice.
  const requestIds = useRef(new Map<string, string>());
  async function load() {
    setBusy(true);
    try {
      const result = await api.inbox(workspaceId);
      if (!Array.isArray(result?.entries)) throw new Error('Invalid inbox');
      if (!live.current) return;
      setEntries(result.entries); setError(false); onCount?.(result.entries.length);
    } catch {if (live.current) setError(true);}
    finally {if (live.current) setBusy(false);}
  }
  useEffect(() => {live.current = true; void load(); return () => {live.current = false;};}, [api, workspaceId]);
  function requestId(key: string) {
    let id = requestIds.current.get(key);
    if (!id) {id = crypto.randomUUID(); requestIds.current.set(key, id);}
    return id;
  }
  async function act(entry: WorkspaceInboxEntry, run: (id: string) => Promise<unknown>) {
    if (busy || !window.confirm(l('confirm'))) return;
    setBusy(true); setError(false);
    try {await run(requestId(entry.key)); requestIds.current.delete(entry.key);}
    catch {if (live.current) {setError(true); setBusy(false);} return;}
    await load();
  }
  return <section className="space-y-2 rounded border p-3" data-testid="workspace-inbox" aria-label={l('title')}>
    <header className="flex items-center justify-between"><h3 className="font-semibold">{l('title')} ({entries.length})</h3><Button variant="ghost" disabled={busy} onClick={() => void load()}>{l('reload')}</Button></header>
    {error && <p role="alert">{l('error')}</p>}
    {!entries.length && !busy && <p role="status">{l('empty')}</p>}
    {entries.map(entry => <article key={entry.key} data-testid="inbox-entry" data-kind={entry.kind} className="space-y-2 rounded border p-2">
      <p className="text-sm"><span className="font-medium">{l(entry.kind as keyof Labels) ?? entry.kind}</span> · {entry.workItemTitle}</p>
      {entry.kind === 'approval'
        ? <pre className="whitespace-pre-wrap break-all text-xs">{permissionDetails(entry.summary) ?? entry.summary}</pre>
        : <p className="whitespace-pre-wrap break-words">{entry.kind === 'failure' ? l(entry.state === 'unknown' ? 'unknown' : 'failed') : entry.summary}</p>}
      {!entry.actionable && entry.kind !== 'failure' && <p className="text-xs text-muted-foreground">{l('notYours')}</p>}
      {entry.actionable && (entry.kind === 'decision' || entry.kind === 'review_cycle') && <div className="flex flex-wrap gap-2">
        {entry.options.map(option => <Button key={option.id} variant={option.id === entry.recommendedOptionId ? 'default' : 'outline'} disabled={busy} title={option.description}
          onClick={() => void act(entry, id => api.answerDecision(entry.decisionId!, id, option.id))}>{option.label}{option.id === entry.recommendedOptionId ? ` · ${l('recommended')}` : ''}</Button>)}
      </div>}
      {entry.actionable && entry.kind === 'approval' && <div className="flex flex-wrap gap-2">
        {(['allow_once', 'deny'] as const).map(decision => <Button key={decision} variant="outline" disabled={busy || (decision === 'allow_once' && !permissionDetails(entry.summary))}
          onClick={() => void act(entry, id => api.resolvePermission(entry.executionId!, id, entry.permissionId!, entry.requestDigest!, decision))}>{l(decision === 'allow_once' ? 'approve' : 'deny')}</Button>)}
        {!permissionDetails(entry.summary) && <p className="text-xs text-muted-foreground">{l('noDetails')}</p>}
      </div>}
    </article>)}
  </section>;
}
