// Structured system gray-bar (content type 5, SYSTEM_MESSAGE_SPEC):
// content = {"template":"{0} claimed {1}'s {2}","refs":[{type,target_id,text}]}
// - `{i}` placeholders → refs[i].text; `{n+}` expands refs[n..] joined by '、'
// - red_packet refs are clickable → red-packet detail dialog
// - non-JSON / missing template renders as plain text (legacy rows); never
//   throws, never leaks raw JSON structure.
import type { ReactNode } from 'react';
import type { MessageContent, SystemMessageRef } from '@privchat/sdk';
import { useTranslation } from 'react-i18next';
import { useMoneyUi } from './money-ui';

const PLACEHOLDER = /\{(\d+)(\+)?\}/g;

// template 既可能是字面模板("{0} 领取了 {1} 的{2}"),也可能是 i18n key
// ("system.member_invited")。key 形态先查表映射成本地化模板再渲染;
// 未知 key 原样透出(fail-open,新 server 老客户端时至少可读)。
function resolveTemplate(
  template: string,
  t: (k: string, o?: { defaultValue?: string }) => string,
): string {
  if (!template.startsWith('system.')) return template;
  return t(`system_template.${template.slice('system.'.length)}`, {
    defaultValue: template,
  });
}

function RenderedTemplate({ template: rawTemplate, refs }: { template: string; refs: readonly SystemMessageRef[] }) {
  const money = useMoneyUi();
  const { t } = useTranslation();
  const template = resolveTemplate(rawTemplate, t as (k: string, o?: { defaultValue?: string }) => string);
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<span key={key++}>{template.slice(last, idx)}</span>);
    const n = Number(m[1]);
    const expand = m[2] === '+';
    const slice = expand ? refs.slice(n) : refs[n] !== undefined ? [refs[n]!] : [];
    if (slice.length === 0) {
      out.push(<span key={key++}>{m[0]}</span>); // out-of-range → literal
    } else {
      slice.forEach((ref, i) => {
        if (i > 0) out.push(<span key={key++}>、</span>);
        const label = ref.text ?? ref.target_id ?? '';
        if (ref.type === 'red_packet' && ref.target_id !== undefined) {
          const id = ref.target_id;
          out.push(
            <span
              key={key++}
              className="cursor-pointer text-[#e5433d] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                money.open({ type: 'rp-detail', id });
              }}
            >
              {label}
            </span>,
          );
        } else {
          out.push(
            <span key={key++} className="font-semibold">
              {label}
            </span>,
          );
        }
      });
    }
    last = idx + m[0].length;
  }
  if (last < template.length) out.push(<span key={key++}>{template.slice(last)}</span>);
  return <>{out}</>;
}

/** Centered gray pill; structured template when parseable, else raw text. */
export function SystemMessageBar({ body }: { body: Extract<MessageContent, { kind: 'system' }> }) {
  return (
    <div className="flex justify-center py-1">
      <span className="max-w-[80%] rounded-md bg-muted px-2.5 py-1 text-center text-xs text-muted-foreground">
        {body.template !== undefined ? (
          <RenderedTemplate template={body.template} refs={body.refs} />
        ) : (
          body.text
        )}
      </span>
    </div>
  );
}
