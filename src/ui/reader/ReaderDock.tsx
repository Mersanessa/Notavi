import { Gauge, Minus, Pause, Play, Plus, SkipBack, SkipForward, X } from 'lucide-react';
import { IconButton } from '../components/Button';

const RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Floating controls for read aloud. */
export function SpeechDock({
  playing,
  index,
  total,
  rate,
  onToggle,
  onSkip,
  onRate,
  onClose,
}: {
  playing: boolean;
  index: number;
  total: number;
  rate: number;
  onToggle: () => void;
  onSkip: (d: number) => void;
  onRate: (r: number) => void;
  onClose: () => void;
}) {
  const nextRate = () => {
    const i = RATES.findIndex((r) => r >= rate - 0.001);
    onRate(RATES[(i + 1) % RATES.length] ?? 1);
  };
  return (
    <div className="reader-dock" role="toolbar" aria-label="Read aloud" data-notap data-testid="speech-dock">
      <div className="reader-dock__wave" aria-hidden data-playing={playing || undefined}>
        <i />
        <i />
        <i />
        <i />
      </div>
      <IconButton icon={SkipBack} size="sm" label="Previous sentence" onClick={() => onSkip(-1)} />
      <button type="button" className="reader-dock__main" onClick={onToggle} aria-label={playing ? 'Pause reading aloud' : 'Resume reading aloud'}>
        {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
      </button>
      <IconButton icon={SkipForward} size="sm" label="Next sentence" onClick={() => onSkip(1)} />
      <button type="button" className="reader-dock__chip" onClick={nextRate} aria-label={`Speed ${rate}×. Change speed`}>
        {rate.toFixed(rate % 1 ? (Math.round(rate * 100) % 10 ? 2 : 1) : 0)}×
      </button>
      <span className="reader-dock__meta">{total ? `${Math.min(index + 1, total)}/${total}` : ''}</span>
      <IconButton icon={X} size="sm" label="Stop reading aloud" onClick={onClose} />
    </div>
  );
}

/** Floating controls for auto-scroll. */
export function ScrollDock({ running, speed, onToggle, onSpeed, onClose }: { running: boolean; speed: number; onToggle: () => void; onSpeed: (s: number) => void; onClose: () => void }) {
  return (
    <div className="reader-dock" role="toolbar" aria-label="Auto-scroll" data-notap data-testid="scroll-dock">
      <Gauge size={18} aria-hidden className="reader-dock__icon" />
      <button type="button" className="reader-dock__main" onClick={onToggle} aria-label={running ? 'Pause auto-scroll' : 'Resume auto-scroll'}>
        {running ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
      </button>
      <IconButton icon={Minus} size="sm" label="Slower" onClick={() => onSpeed(Math.max(1, speed - 1))} disabled={speed <= 1} />
      <span className="reader-dock__speed" aria-live="polite">
        {speed}
      </span>
      <IconButton icon={Plus} size="sm" label="Faster" onClick={() => onSpeed(Math.min(40, speed + 1))} disabled={speed >= 40} />
      <IconButton icon={X} size="sm" label="Stop auto-scroll" onClick={onClose} />
    </div>
  );
}
