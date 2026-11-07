import { create } from 'zustand';
import { Dialog } from './Dialog';
import { Button } from './Button';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

const useConfirmStore = create<{ opts: ConfirmOptions | null; resolve: ((v: boolean) => void) | null }>(() => ({ opts: null, resolve: null }));

/** Ask the user to confirm an action. Resolves true when confirmed. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ opts, resolve }));
}

export function ConfirmHost() {
  const { opts, resolve } = useConfirmStore();
  const close = (v: boolean) => {
    resolve?.(v);
    useConfirmStore.setState({ opts: null, resolve: null });
  };
  if (!opts) return null;
  return (
    <Dialog
      open
      size="sm"
      sheet={false}
      title={opts.title}
      onClose={() => close(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} data-autofocus={opts.danger ? true : undefined}>
            {opts.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={opts.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus={opts.danger ? undefined : true}>
            {opts.confirmLabel}
          </Button>
        </>
      }
    >
      {opts.body && <p className="confirm__body">{opts.body}</p>}
    </Dialog>
  );
}
