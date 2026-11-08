import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, HardDrive, KeyRound, Lock, Palette, ShieldCheck, Type, Undo2, Info, Keyboard, TriangleAlert } from 'lucide-react';
import { db, refreshLibrary, toast, useStore } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { useRoute } from '../../app/router';
import { READER_FONTS, READER_THEMES, type AppTheme } from '../../app/prefs';
import { APP_VERSION, createBackup, inspectBackup, lastBackupAt, passphraseStrength, restoreBackup } from '../../app/backup';
import { disableLock, enableLock, lockNow, setAutoLock, useLock, validateCode, verifyCode } from '../../app/lock';
import { BACKUP_EXTENSION, type BackupHeader } from '../../lib/crypto';
import { formatDate, formatNumber, relativeTime } from '../../lib/text';
import { isTauri, pickFiles, platformName, saveFile } from '../../platform';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Segmented, SelectField, Stepper, Switch, TextField } from '../components/Fields';
import { PageHeader } from '../components/misc';
import { confirmAction } from '../components/confirm';
import { eraseLibrary } from '../../data/admin';
import { Wordmark } from '../components/Wordmark';

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { query } = useRoute();
  useEffect(() => {
    const s = query.get('s');
    if (s) document.getElementById(`settings-${s}`)?.scrollIntoView({ block: 'start' });
  }, [query]);
  return (
    <div className="page page--settings">
      <PageHeader title="Settings" />
      <div className="settings">
        <Appearance />
        <ReadingDefaults />
        <Backup />
        <Security />
        <Storage />
        <About />
      </div>
    </div>
  );
}

function Section({ id, icon: Icon, title, children, lead }: { id: string; icon: typeof Palette; title: string; children: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <section className="settings-section" id={`settings-${id}`} aria-labelledby={`h-${id}`}>
      <header className="settings-section__head">
        <Icon size={20} aria-hidden />
        <h2 id={`h-${id}`}>{title}</h2>
      </header>
      {lead && <p className="settings-section__lead">{lead}</p>}
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ appearance */

function Appearance() {
  const app = useStore((s) => s.app);
  const setApp = useStore((s) => s.setApp);
  return (
    <Section id="appearance" icon={Palette} title="Appearance">
      <div className="rs-row">
        <span className="rs-row__label">App theme</span>
        <Segmented<AppTheme>
          label="App theme"
          value={app.theme}
          onChange={(v) => void setApp({ theme: v })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Match device' },
          ]}
        />
      </div>
      <Switch label="Reduce motion" hint="Turns off the opening sequence, transitions and smooth scrolling." checked={app.reduceMotion} onChange={(v) => void setApp({ reduceMotion: v })} />
      <Switch label="Haptic feedback" hint="A light tap when you press buttons and turn pages. On iPhone this needs iOS 18 or later." checked={app.haptics} onChange={(v) => void setApp({ haptics: v })} />
    </Section>
  );
}

function ReadingDefaults() {
  const r = useStore((s) => s.reader);
  const set = useStore((s) => s.setReader);
  const goal = useStore((s) => s.app.dailyGoal);
  const setApp = useStore((s) => s.setApp);
  return (
    <Section id="reading" icon={Type} title="Reading" lead="These are the same settings as the Aa menu in the reader. Changes apply to every novel.">
      <div className="settings-grid">
        <SelectField label="Font" value={r.font} options={READER_FONTS.map((f) => ({ value: f.value, label: f.label }))} onChange={(v) => void set({ font: v })} />
        <SelectField label="Reader theme" value={r.theme} options={READER_THEMES} onChange={(v) => void set({ theme: v })} />
      </div>
      <Stepper label="Text size" value={r.fontSize} min={12} max={40} step={1} format={(v) => `${v}px`} onChange={(v) => void set({ fontSize: v })} />
      <Stepper label="Line spacing" value={r.lineHeight} min={1.2} max={2.6} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => void set({ lineHeight: Number(v.toFixed(2)) })} />
      <div className="reading-sample" data-reader-theme={r.theme} style={{ fontFamily: READER_FONTS.find((f) => f.value === r.font)?.stack, fontSize: r.fontSize, lineHeight: r.lineHeight, fontWeight: r.fontWeight }}>
        It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.
      </div>
      <Stepper
        label="Daily reading goal"
        value={goal}
        min={0}
        max={240}
        step={5}
        format={(v) => (v ? `${v} min` : 'Off')}
        onChange={(v) => void setApp({ dailyGoal: v })}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ backup */

function Backup() {
  const last = useAsync(() => lastBackupAt(db()), []);
  const [exporting, setExporting] = useState(false);
  const [restoreFile, setRestoreFile] = useState<{ name: string; bytes: Uint8Array; header: BackupHeader } | null>(null);
  const days = last.data ? Math.floor((Date.now() - last.data) / 86400000) : null;

  const pickBackup = async () => {
    const [f] = await pickFiles(`.${BACKUP_EXTENSION},application/octet-stream`, false);
    if (!f) return;
    try {
      setRestoreFile({ ...f, header: inspectBackup(f.bytes) });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  return (
    <Section
      id="backup"
      icon={Archive}
      title="Backup and restore"
      lead={
        <>
          A backup is one encrypted file containing your whole library: novels, covers, progress, bookmarks, notes, collections, stats and settings. Use it to
          move to another device: export here, put the file somewhere the other device can reach (a cloud folder, a USB cable), then restore it there.
        </>
      }
    >
      <p className={`backup-status ${days !== null && days > 14 ? 'is-stale' : ''}`}>
        {last.data ? `Last backup ${relativeTime(last.data)} (${formatDate(last.data)}).` : 'You haven’t made a backup on this device yet.'}
        {days !== null && days > 14 && ' Consider making a fresh one.'}
      </p>
      <div className="button-row">
        <Button variant="primary" icon={Archive} onClick={() => setExporting(true)} data-testid="backup-export">
          Export backup
        </Button>
        <Button icon={ArchiveRestore} onClick={pickBackup} data-testid="backup-restore">
          Restore from backup
        </Button>
        <Button
          variant="ghost"
          icon={Undo2}
          onClick={async () => {
            if (!(await confirmAction({ title: 'Undo the last restore?', body: 'This brings back the library as it was just before the most recent restore on this device.', confirmLabel: 'Undo restore' }))) return;
            const ok = await db().undoReplace();
            await refreshLibrary();
            toast(ok ? { message: 'Restore undone', tone: 'success' } : 'There’s no restore to undo.');
          }}
        >
          Undo last restore
        </Button>
      </div>
      {exporting && <ExportDialog onClose={() => (setExporting(false), last.reload())} />}
      {restoreFile && <RestoreDialog file={restoreFile} onClose={() => setRestoreFile(null)} />}
    </Section>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const strength = passphraseStrength(p1);
  const mismatch = p2.length > 0 && p1 !== p2;
  const go = async () => {
    setBusy(true);
    try {
      const { bytes, fileName, header } = await createBackup(db(), p1);
      const res = await saveFile(fileName, bytes);
      if (res !== 'cancelled') {
        toast({ message: `Backup ${res === 'saved' ? 'saved' : 'downloaded'}: ${header.novels} novels, ${formatNumber(header.chapters)} chapters.`, tone: 'success' });
        onClose();
      }
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Export an encrypted backup"
      description="Choose a passphrase. You'll need it to restore. If you forget it, the backup can't be opened by anyone, including you."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={strength.score === 0 || p1 !== p2} onClick={go} data-testid="backup-confirm">
            Export backup
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void go())}>
        <TextField label="Passphrase" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} hint={p1 ? strength.label : 'At least 8 characters. A few random words work well.'} data-autofocus data-testid="backup-pass1" />
        <div className={`strength strength--${strength.score}`} aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <TextField label="Repeat passphrase" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} error={mismatch ? 'The passphrases don’t match.' : null} data-testid="backup-pass2" />
        <button type="submit" hidden />
      </form>
      {platformName() === 'android' && <p className="field__hint">Android will ask where to save the file. A cloud folder you can reach from your PC is a good choice.</p>}
    </Dialog>
  );
}

function RestoreDialog({ file, onClose }: { file: { name: string; bytes: Uint8Array; header: BackupHeader }; onClose: () => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const novels = useStore((s) => s.novels.length);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const { novels: n } = await restoreBackup(db(), file.bytes, pass);
      await refreshLibrary();
      toast({ message: `Restored ${n} ${n === 1 ? 'novel' : 'novels'}.`, tone: 'success', action: { label: 'Undo', run: () => void db().undoReplace().then(refreshLibrary) } });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Restore from backup"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} disabled={!pass} onClick={go} data-testid="restore-confirm">
            Replace my library
          </Button>
        </>
      }
    >
      <dl className="details details--compact">
        <div className="details__row">
          <dt>File</dt>
          <dd>{file.name}</dd>
        </div>
        <div className="details__row">
          <dt>Made</dt>
          <dd>{new Date(file.header.createdAt).toLocaleString()}</dd>
        </div>
        <div className="details__row">
          <dt>Contains</dt>
          <dd>
            {file.header.novels} novels, {formatNumber(file.header.chapters)} chapters
          </dd>
        </div>
      </dl>
      <p className="callout callout--warn">
        <TriangleAlert size={18} aria-hidden />
        <span>
          Restoring replaces everything currently on this device{novels ? ` (${novels} novels)` : ''} with the backup. You can undo it straight afterwards from this page.
        </span>
      </p>
      <form onSubmit={(e) => (e.preventDefault(), void go())}>
        <TextField label="Backup passphrase" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} error={error} data-autofocus data-testid="restore-pass" />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ security */

const AUTO_LOCK = [
  { value: '0', label: 'Immediately when I leave the app' },
  { value: '1', label: 'After 1 minute away' },
  { value: '5', label: 'After 5 minutes away' },
  { value: '15', label: 'After 15 minutes away' },
  { value: '60', label: 'After 1 hour away' },
];

function Security() {
  const config = useLock((s) => s.config);
  const [setup, setSetup] = useState(false);
  const [disabling, setDisabling] = useState(false);
  return (
    <Section
      id="security"
      icon={ShieldCheck}
      title="App lock"
      lead="Ask for a PIN or passcode when Notavi opens. This keeps your library private from anyone who picks up the device. It doesn’t encrypt the library on disk; backups are encrypted separately."
    >
      {config?.enabled ? (
        <>
          <p className="lock-state">
            <Lock size={16} aria-hidden /> On, using a {config.kind === 'pin' ? 'PIN' : 'passcode'}.
          </p>
          <SelectField label="Lock again" value={String(config.autoLockMinutes)} options={AUTO_LOCK} onChange={(v) => setAutoLock(Number(v))} />
          <div className="button-row">
            <Button icon={Lock} onClick={lockNow}>
              Lock now
            </Button>
            <Button icon={KeyRound} onClick={() => setSetup(true)}>
              Change {config.kind === 'pin' ? 'PIN' : 'passcode'}
            </Button>
            <Button variant="ghost" onClick={() => setDisabling(true)}>
              Turn off app lock
            </Button>
          </div>
        </>
      ) : (
        <Button variant="primary" icon={Lock} onClick={() => setSetup(true)} data-testid="lock-setup">
          Set up app lock
        </Button>
      )}
      {setup && <LockSetup onClose={() => setSetup(false)} requireCurrent={!!config?.enabled} />}
      {disabling && <LockDisable onClose={() => setDisabling(false)} />}
    </Section>
  );
}

function LockSetup({ onClose, requireCurrent }: { onClose: () => void; requireCurrent: boolean }) {
  const [kind, setKind] = useState<'pin' | 'passcode'>('pin');
  const [current, setCurrent] = useState('');
  const [c1, setC1] = useState('');
  const [c2, setC2] = useState('');
  const [auto, setAuto] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    if (requireCurrent && !(await verifyCode(current, { unlock: false }))) return setError('The current code is wrong.');
    const v = validateCode(kind, c1);
    if (v) return setError(v);
    if (c1 !== c2) return setError('The codes don’t match.');
    await enableLock(kind, c1, Number(auto));
    toast({ message: 'App lock is on', tone: 'success' });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={requireCurrent ? 'Change code' : 'Set up app lock'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={go} data-testid="lock-save">
            Turn on
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void go())}>
        {requireCurrent && <TextField label="Current code" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} data-autofocus />}
        <Segmented
          label="Type of code"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'pin', label: 'PIN (4–8 digits)' },
            { value: 'passcode', label: 'Passcode' },
          ]}
        />
        <TextField label={kind === 'pin' ? 'New PIN' : 'New passcode'} type="password" inputMode={kind === 'pin' ? 'numeric' : 'text'} autoComplete="new-password" value={c1} onChange={(e) => setC1(e.target.value)} data-testid="lock-code1" />
        <TextField label="Repeat it" type="password" inputMode={kind === 'pin' ? 'numeric' : 'text'} autoComplete="new-password" value={c2} onChange={(e) => setC2(e.target.value)} error={error} data-testid="lock-code2" />
        {!requireCurrent && <SelectField label="Lock again" value={auto} options={AUTO_LOCK} onChange={setAuto} />}
        <p className="field__hint">If you forget the code, you can still get in by restoring a backup or erasing the library from the lock screen.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function LockDisable({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!(await verifyCode(code, { unlock: false }))) return setError('That code is wrong.');
    disableLock();
    toast('App lock turned off');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Turn off app lock"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={go}>
            Turn off
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void go())}>
        <TextField label="Current code" type="password" value={code} onChange={(e) => setCode(e.target.value)} error={error} data-autofocus />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ storage */

function Storage() {
  const storage = useStore((s) => s.storage);
  const novels = useStore((s) => s.novels);
  const chapters = novels.reduce((s, n) => s + n.chapterCount, 0);
  const [erase, setErase] = useState(false);
  const label = storage?.backend === 'opfs' ? 'Private app storage (SQLite)' : storage?.backend === 'indexeddb' ? 'Browser storage (SQLite in IndexedDB)' : 'Memory only — nothing is saved';
  return (
    <Section id="storage" icon={HardDrive} title="Storage">
      <dl className="details details--compact">
        <div className="details__row">
          <dt>Stored in</dt>
          <dd>{label}</dd>
        </div>
        <div className="details__row">
          <dt>Library size</dt>
          <dd>{storage?.sizeBytes ? `${(storage.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '—'}</dd>
        </div>
        <div className="details__row">
          <dt>Contents</dt>
          <dd>
            {novels.length} novels, {formatNumber(chapters)} chapters
          </dd>
        </div>
        <div className="details__row">
          <dt>Running as</dt>
          <dd>{isTauri() ? (platformName() === 'android' ? 'Android app' : 'Windows app') : 'Web app'}</dd>
        </div>
      </dl>
      {storage?.backend === 'memory' && <p className="callout callout--warn">This browser can’t store data, so your library will be lost when the page closes.</p>}
      <div className="danger-zone">
        <h3>Erase library</h3>
        <p>Deletes every novel, chapter, note, collection and stat on this device. Make a backup first if you might want them back.</p>
        <Button variant="danger" onClick={() => setErase(true)}>
          Erase library…
        </Button>
      </div>
      {erase && <EraseDialog onClose={() => setErase(false)} />}
    </Section>
  );
}

export function EraseDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [text, setText] = useState('');
  const go = async () => {
    const snapshot = await eraseLibrary(db());
    await refreshLibrary();
    toast({ message: 'Library erased', action: { label: 'Undo', run: () => void db().replaceWith(snapshot).then(refreshLibrary) }, duration: 15000 });
    onDone?.();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Erase the whole library?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={text.trim().toUpperCase() !== 'ERASE'} onClick={go}>
            Erase everything
          </Button>
        </>
      }
    >
      <p>Type ERASE to confirm.</p>
      <TextField label="Confirmation" value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ about */

function About() {
  const storage = useStore((s) => s.storage);
  return (
    <Section id="about" icon={Info} title="About Notavi">
      <Wordmark height={36} className="about-mark" />
      <p>
        Notavi {APP_VERSION}. A private reader for one person. No accounts, no analytics, no tracking, and no network requests: your library never leaves
        this device unless you export a backup.
      </p>
      <p className="muted">
        Fonts: Nunito Sans, Literata, Source Serif 4, Lora, Fraunces, Hanken Grotesk and Atkinson Hyperlegible, all under the SIL Open Font License. SQLite {storage?.sqliteVersion}.
      </p>
      <details className="shortcuts">
        <summary>
          <Keyboard size={16} aria-hidden /> Reader keyboard shortcuts
        </summary>
        <dl className="details details--compact">
          {[
            ['Space, ↓, Page Down, J', 'Next screen'],
            ['Shift+Space, ↑, Page Up, K', 'Previous screen'],
            ['→, ], N', 'Next chapter'],
            ['←, [, P', 'Previous chapter'],
            ['T or C', 'Chapter list'],
            ['S', 'Reading settings'],
            ['B', 'Bookmark chapter'],
            ['F', 'Full screen'],
            ['Esc', 'Close panel, leave full screen, then leave the reader'],
          ].map(([k, v]) => (
            <div className="details__row" key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Section>
  );
}
