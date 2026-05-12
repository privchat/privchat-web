// Create-group dialog. The new group's record will appear in the
// in-memory cache once entity sync catches up; we don't update the
// store ourselves. The dialog closes after a successful create.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useCreateGroup } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { captureException } from '@/lib/error-reporter';
import { errorText } from './error-text';

export function GroupCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const createGroup = useCreateGroup();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setSubmitting(false);
    setError(null);
  }, [open]);

  const canSubmit = name.trim() !== '' && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createGroup(
        name.trim(),
        description.trim() === '' ? undefined : description.trim(),
      );
      onOpenChange(false);
    } catch (err) {
      captureException(err, { source: 'group-create.submit' });
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('groups.create_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="group-create-name" className="text-xs">
              {t('groups.create_name')}
            </Label>
            <Input
              id="group-create-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="group-create-description" className="text-xs">
              {t('groups.create_description')}
            </Label>
            <Input
              id="group-create-description"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          </div>
          {error !== null && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('groups.create_submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
