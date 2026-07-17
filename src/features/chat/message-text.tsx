import type { MessageContent } from '@privchat/sdk';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export function MessageText({ body, isSelf }: { body: MessageContent; isSelf: boolean }) {
  if (body.entities.length === 0) {
    return <span className="break-words whitespace-pre-wrap">{body.text}</span>;
  }

  let cursor = 0;
  return (
    <span className="break-words whitespace-pre-wrap">
      {body.entities.map((entity, index) => {
        const prefix = body.text.slice(cursor, entity.start);
        cursor = entity.end;
        const className = cn(
          'underline decoration-current/40 underline-offset-2 hover:decoration-current',
          isSelf ? 'text-primary-foreground' : 'text-primary',
        );
        return (
          <Fragment key={`${entity.start}:${entity.end}:${entity.type}:${index}`}>
            {prefix}
            {entity.type === 'url' ? (
              <a className={className} href={entity.value} target="_blank" rel="noreferrer">
                {entity.text}
              </a>
            ) : entity.type === 'phone' ? (
              <a className={className} href={`tel:${entity.value}`}>{entity.text}</a>
            ) : (
              <span className={cn(className, 'font-medium')} data-user-id={entity.user_id}>
                {entity.text}
              </span>
            )}
          </Fragment>
        );
      })}
      {body.text.slice(cursor)}
    </span>
  );
}
