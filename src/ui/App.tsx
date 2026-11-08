import { lazy, Suspense, useEffect } from 'react';
import { useRoute, navigate, routes } from '../app/router';
import { useStore } from '../app/store';
import { useLock } from '../app/lock';
import { Shell } from './Shell';
import { Wordmark } from './components/Wordmark';
import { Toasts, Spinner } from './components/misc';
import { ConfirmHost } from './components/confirm';
import { LockScreen } from './pages/LockScreen';
import { HomePage } from './pages/Home';
import { LibraryPage } from './pages/Library';
import { NovelPage } from './pages/Novel';
import { EditNovelPage } from './pages/EditNovel';
import { ImportPage, queueDroppedFiles } from './pages/Import';
import { SearchPage } from './pages/Search';
import { CollectionsPage, CollectionPage } from './pages/Collections';
import { SettingsPage } from './pages/Settings';
import { ChapterEditorPage } from './pages/ChapterEditor';
import { Reader } from './reader/Reader';
import { readFiles } from '../platform';
import { dismissSplash } from '../app/splash';

const StatsPage = lazy(() => import('./pages/Stats'));

function Page() {
  const { segments } = useRoute();
  const [a, b, c, d] = segments;
  switch (a) {
    case undefined:
      return <HomePage />;
    case 'library':
      return <LibraryPage />;
    case 'novel':
      if (c === 'edit') return <EditNovelPage novelId={b} />;
      if (c === 'chapter') return <ChapterEditorPage novelId={b} chapterId={d === 'new' ? null : d} />;
      return <NovelPage novelId={b} />;
    case 'new':
      return <EditNovelPage novelId={null} />;
    case 'import':
      return <ImportPage />;
    case 'search':
      return <SearchPage />;
    case 'collections':
      return b ? <CollectionPage id={b} /> : <CollectionsPage />;
    case 'stats':
      return (
        <Suspense fallback={<Spinner />}>
          <StatsPage />
        </Suspense>
      );
    case 'settings':
      return <SettingsPage />;
    default:
      return <NotFound />;
  }
}

function NotFound() {
  return (
    <div className="page">
      <h1 className="page-head__title">Page not found</h1>
      <p className="muted">This link doesn't lead anywhere in your library.</p>
      <p>
        <a className="link" href="#/">
          Go to Home
        </a>
      </p>
    </div>
  );
}

/** Drop files anywhere (desktop) to import them. */
function useGlobalDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        document.body.classList.add('is-dropping');
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) document.body.classList.remove('is-dropping');
    };
    const drop = async (e: DragEvent) => {
      document.body.classList.remove('is-dropping');
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      queueDroppedFiles(await readFiles(Array.from(e.dataTransfer.files)));
      navigate(routes.importFiles());
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

export function App() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const locked = useLock((s) => s.locked);
  const { segments } = useRoute();
  useGlobalDrop();
  useEffect(() => {
    if (status !== 'booting') dismissSplash();
  }, [status]);

  if (status === 'booting') {
    return (
      <div className="boot" aria-busy="true" />
    );
  }
  if (status === 'locked-elsewhere' || status === 'error') {
    return (
      <div className="boot boot--error" role="alert">
        <Wordmark height={40} />
        <p className="boot__msg">{error}</p>
        {status === 'locked-elsewhere' ? (
          <p className="boot__hint">Close the other tab or window, then reload this one.</p>
        ) : (
          <p className="boot__hint">Your library hasn't been changed. Try reloading. If this keeps happening, restore from a backup in Settings.</p>
        )}
        <button className="btn btn--primary btn--md" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  if (locked) return <LockScreen />;

  const reading = segments[0] === 'read';
  return (
    <>
      {reading ? <Reader novelId={segments[1]} chapterId={segments[2] ?? null} /> : (
        <Shell>
          <Page />
        </Shell>
      )}
      <Toasts />
      <ConfirmHost />
      <div className="drop-hint" aria-hidden>
        <span>Drop files to import them</span>
      </div>
    </>
  );
}
