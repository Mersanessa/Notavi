import { useEffect, useRef, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { db, refreshLibrary, toast } from '../../app/store';
import { disableLock, lockoutRemaining, useLock, verifyCode } from '../../app/lock';
import { inspectBackup, restoreBackup } from '../../app/backup';
import { BACKUP_EXTENSION } from '../../lib/crypto';
import { pickFiles, vibrate } from '../../platform';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { TextField } from '../components/Fields';
import { EraseDialog } from './Settings';

export function LockScreen() {
  const config = useLock((s) => s.config);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(lockoutRemaining());
  const [checking, setChecking] = useState(false);
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pin = config?.kind === 'pin';

  useEffect(() => {
    if (!wait) return;
    const t = setInterval(() => setWait(lockoutRemaining()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  useEffect(() => input.current?.focus(), []);

  const submit = async (value = code) => {
    if (!value || checking || lockoutRemaining()) return;
    setChecking(true);
    const ok = await verifyCode(value);
    setChecking(false);
    if (!ok) {
      vibrate(60);
      setCode('');
      const w = lockoutRemaining();
      setWait(w);
      setError(w ? null : `Wrong ${pin ? 'PIN' : 'passcode'}.`);
    }
  };

  const press = (d: string) => {
    if (wait) return;
    const next = (code + d).slice(0, 8);
    setCode(next);
    setError(null);
  };

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="Notavi is locked">
      <div className="lock__panel">
        <Lock size={26} aria-hidden className="lock__icon" />
        <h1 className="lock__title">Notavi is locked</h1>
        <form
          className="lock__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="visually-hidden" htmlFor="lock-code">
            {pin ? 'PIN' : 'Passcode'}
          </label>
          <input
            ref={input}
            id="lock-code"
            className={`lock__input ${pin ? 'lock__input--pin' : ''}`}
            type="password"
            inputMode={pin ? 'numeric' : 'text'}
            autoComplete="current-password"
            value={code}
            disabled={!!wait}
            placeholder={pin ? 'Enter PIN' : 'Enter passcode'}
            onChange={(e) => {
              setCode(pin ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value);
              setError(null);
            }}
            data-testid="unlock-input"
          />
          <p className="lock__msg" role="alert">
            {wait ? `Too many attempts. Try again in ${wait} s.` : error}
          </p>
          {pin && (
            <div className="keypad" aria-hidden>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
                k === '' ? (
                  <span key={i} />
                ) : (
                  <button key={i} type="button" tabIndex={-1} className="keypad__key" onClick={() => (k === '⌫' ? setCode(code.slice(0, -1)) : press(k))} disabled={!!wait}>
                    {k === '⌫' ? <Delete size={20} /> : k}
                  </button>
                ),
              )}
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" busy={checking} disabled={!code || !!wait} data-testid="unlock-btn">
            Unlock
          </Button>
        </form>
        <button type="button" className="link link--quiet lock__help" onClick={() => setHelp(true)}>
          Forgot your {pin ? 'PIN' : 'passcode'}?
        </button>
      </div>
      {help && <ForgotDialog onClose={() => setHelp(false)} />}
    </div>
  );
}

/** Without the code, the only ways in replace the library: restore a backup, or erase it. */
function ForgotDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [erase, setErase] = useState(false);
  const restore = async () => {
    try {
      inspectBackup(file!.bytes);
      await restoreBackup(db(), file!.bytes, pass);
      disableLock();
      await refreshLibrary();
      toast({ message: 'Backup restored and app lock removed. You can set a new code in Settings.', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Forgot your code?" description="The code can’t be recovered. To get back in, replace the library on this device with a backup (and its passphrase), or erase it and start again. Either way the app lock is removed.">
      {!file ? (
        <div className="button-row">
          <Button
            variant="primary"
            onClick={async () => {
              const [f] = await pickFiles(`.${BACKUP_EXTENSION},application/octet-stream`, false);
              if (f) setFile(f);
            }}
          >
            Restore a backup…
          </Button>
          <Button variant="danger" onClick={() => setErase(true)}>
            Erase library…
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), void restore())}>
          <p>{file.name}</p>
          <TextField label="Backup passphrase" type="password" value={pass} onChange={(e) => setPass(e.target.value)} error={error} data-autofocus />
          <Button type="submit" variant="primary" disabled={!pass}>
            Restore and unlock
          </Button>
        </form>
      )}
      {erase && <EraseDialog onClose={() => setErase(false)} onDone={() => disableLock()} />}
    </Dialog>
  );
}
