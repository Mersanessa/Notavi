import { Download, X } from 'lucide-react';
import { dismissUpdate, installUpdate, useUpdate } from '../../app/appUpdate';

/** Progress for the Android in-app update: downloading, then Android's install screen takes over. */
export function UpdateBar() {
  const s = useUpdate((x) => x.s);
  if (s.phase === 'idle') return null;
  return (
    <div className="update-bar" role="status" aria-live="polite" data-testid="update-bar">
      <Download size={18} aria-hidden className="update-bar__icon" />
      <div className="update-bar__body">
        {s.phase === 'downloading' && (
          <>
            <span>
              Downloading Notavi {s.version}… {s.pct}%
            </span>
            <span className="update-bar__track">
              <span className="update-bar__fill" style={{ width: `${s.pct}%` }} />
            </span>
          </>
        )}
        {s.phase === 'installing' && <span>Tap Install to finish. Your library stays as it is.</span>}
        {s.phase === 'error' && <span>{s.message}</span>}
      </div>
      {s.phase === 'error' && (
        <button type="button" className="btn btn--sm" onClick={() => installUpdate(s.version)}>
          Try again
        </button>
      )}
      {s.phase !== 'downloading' && (
        <button type="button" className="icon-btn icon-btn--sm" aria-label="Close" onClick={dismissUpdate}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
