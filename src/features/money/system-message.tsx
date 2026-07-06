// Structured system gray-bar (content type 5, SYSTEM_MESSAGE_SPEC):
// content = {"template":"{0} claimed {1}'s {2}","refs":[{type,target_id,text}]}
// - `{i}` placeholders → refs[i].text; `{n+}` expands refs[n..] joined by '、'
// - red_packet refs are clickable → red-packet detail dialog
// - non-JSON / missing template renders as plain text (legacy rows); never
//   throws, never leaks raw JSON structure.
import type { ReactNode } from 'react';
import { useMoneyUi } from './money-ui';

export interface SystemRef {
  type: string;
  target_id?: string;
  text?: string;
}

export interface ParsedSystemContent {
  template?: string;
  refs: SystemRef[];
}

export function parseSystemContent(content: string): ParsedSystemContent | null {
  if (!content.startsWith('{')) return null;
  try {
    const obj = JSON.parse(content) as { template?: unknown; refs?: unknown };
    if (typeof obj.template !== 'string') return null;
    const refs: SystemRef[] = Array.isArray(obj.refs)
      ? (obj.refs as Record<string, unknown>[]).map((r) => ({
          type: typeof r.type === 'string' ? r.type : '',
          target_id:
            typeof r.target_id === 'string'
              ? r.target_id
              : typeof r.target_id === 'number'
                ? String(r.target_id)
                : undefined,
          text: typeof r.text === 'string' ? r.text : undefined,
        }))
      : [];
    return { template: obj.template, refs };
  } catch {
    return null;
  }
}

const PLACEHOLDER = /\{(\d+)(\+)?\}/g;

function RenderedTemplate({ template, refs }: { template: string; refs: SystemRef[] }) {
  const money = useMoneyUi();
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
export function SystemMessageBar({ content }: { content: string }) {
  const parsed = parseSystemContent(content);
  return (
    <div className="flex justify-center py-1">
      <span className="max-w-[80%] rounded-md bg-muted px-2.5 py-1 text-center text-xs text-muted-foreground">
        {parsed?.template !== undefined ? (
          <RenderedTemplate template={parsed.template} refs={parsed.refs} />
        ) : (
          content
        )}
      </span>
    </div>
  );
}
