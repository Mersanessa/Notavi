import { useMemo, useState } from 'react';
import { ChartNoAxesColumn, Flame } from 'lucide-react';
import { db } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { href, routes } from '../../app/router';
import { STATUSES } from '../../data/model';
import { getStats, type DayActivity, type MonthActivity } from '../../data/stats';
import { formatDuration, formatNumber } from '../../lib/text';
import { EmptyState, PageHeader, SectionHeader, Spinner } from '../components/misc';
import { Segmented } from '../components/Fields';
import { CountUp } from '../components/CountUp';

/** Stats come only from what was actually measured while reading; nothing is estimated or invented. */
export default function StatsPage() {
  useDocumentTitle('Stats');
  const stats = useAsync(() => getStats(db(), { days: 26 * 7 }), []);
  const [heatView, setHeatView] = useState<View>('chart');
  const [monthView, setMonthView] = useState<View>('chart');
  const s = stats.data;
  if (!s) return <div className="page"><Spinner /></div>;
  const hasActivity = s.readingMs > 0 || s.chaptersRead > 0;

  return (
    <div className="page page--stats">
      <PageHeader title="Stats" lead="Measured from your actual reading on this device: time counts only while a chapter is open and you're active." />
      <div className="stat-tiles">
        <Tile value={formatDuration(s.readingMs)} label="Total reading time" />
        <Tile value={<CountUp value={s.chaptersRead} format={(n) => formatNumber(Math.round(n))} />} label="Chapters read" />
        <Tile
          value={
            <>
              <Flame size={20} aria-hidden className="tile__flame" /> <CountUp value={s.currentStreak} />
            </>
          }
          label={`Day streak (longest ${s.longestStreak})`}
        />
        <Tile value={formatDuration(s.readingMsThisWeek)} label="This week" />
        <Tile value={<CountUp value={s.novels} />} label="Novels in library" />
        <Tile value={<CountUp value={s.byStatus.completed} />} label="Completed" />
        <Tile value={<CountUp value={s.byStatus.reading} />} label="Reading now" />
        <Tile value={<CountUp value={s.annotations} />} label="Bookmarks & notes" />
      </div>

      {!hasActivity ? (
        <EmptyState icon={ChartNoAxesColumn} title="No reading recorded yet">
          Open a chapter and read for a minute; your activity will appear here.
        </EmptyState>
      ) : (
        <>
          <section className="stats-section" aria-labelledby="h-activity">
            <SectionHeader id="h-activity" title="Activity, last 26 weeks" action={<ViewToggle value={heatView} onChange={setHeatView} />} />
            <Heatmap days={s.days} view={heatView} />
          </section>
          <section className="stats-section" aria-labelledby="h-months">
            <SectionHeader id="h-months" title="Reading per month" action={<ViewToggle value={monthView} onChange={setMonthView} />} />
            <MonthChart months={s.months} view={monthView} />
          </section>
        </>
      )}

      <div className="stats-split">
        <section className="stats-section" aria-labelledby="h-status">
          <SectionHeader id="h-status" title="Library by status" />
          <ul className="status-bars">
            {STATUSES.map((st) => {
              const n = s.byStatus[st.value];
              return (
                <li key={st.value}>
                  <span className="status-bars__label">{st.label}</span>
                  <span className="status-bars__track">
                    <span className="status-bars__fill" style={{ width: s.novels ? `${(n / s.novels) * 100}%` : 0 }} />
                  </span>
                  <span className="status-bars__n">{n}</span>
                </li>
              );
            })}
          </ul>
        </section>
        {s.topNovels.length > 0 && (
          <section className="stats-section" aria-labelledby="h-top">
            <SectionHeader id="h-top" title="Most time spent" />
            <ol className="top-novels">
              {s.topNovels.map((t) => (
                <li key={t.novelId}>
                  {t.title === 'Deleted novel' ? <span className="muted">{t.title}</span> : <a className="link link--quiet" href={href(routes.novel(t.novelId))}>{t.title}</a>}
                  <span>{formatDuration(t.ms)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

type View = 'chart' | 'table';
function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return <Segmented label="Show as" value={value} onChange={onChange} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />;
}

function Tile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="tile">
      <span className="tile__value">{value}</span>
      <span className="tile__label">{label}</span>
    </div>
  );
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const monthLabel = (m: string, style: 'short' | 'long' = 'short') => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: style, year: style === 'long' ? 'numeric' : undefined });

/** Calendar heatmap: one sequential hue (brass), five steps, empty days recessive. */
function Heatmap({ days, view }: { days: DayActivity[]; view: View }) {
  const [hover, setHover] = useState<{ d: DayActivity; x: number; y: number } | null>(null);
  const max = Math.max(...days.map((d) => d.ms), 1);
  const level = (ms: number) => (ms <= 0 ? 0 : Math.min(4, Math.ceil((ms / max) * 4)));
  // Columns are weeks starting Monday.
  const first = new Date(`${days[0].day}T12:00:00`);
  const pad = (first.getDay() + 6) % 7;
  const cells: (DayActivity | null)[] = [...Array(pad).fill(null), ...days];
  const weeks: (DayActivity | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const active = days.filter((d) => d.ms > 0 || d.chapters > 0);

  return (
    <div className="chart">
      {view === 'chart' ? (
        <div className="heatmap" onMouseLeave={() => setHover(null)}>
          <div className="heatmap__days" aria-hidden>
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
            <span>Sun</span>
          </div>
          <div className="heatmap__grid" role="img" aria-label={`Reading activity on ${active.length} of the last ${days.length} days`}>
            {weeks.map((w, i) => (
              <div key={i} className="heatmap__week">
                {w.map((d, j) =>
                  d ? (
                    <button
                      key={j}
                      type="button"
                      className={`heatmap__cell lvl-${level(d.ms)}`}
                      aria-label={`${dayLabel(d.day)}: ${formatDuration(d.ms)}, ${d.chapters} chapters`}
                      onMouseEnter={(e) => setHover({ d, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                      onFocus={(e) => setHover({ d, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                      onBlur={() => setHover(null)}
                    />
                  ) : (
                    <span key={j} className="heatmap__cell heatmap__cell--pad" />
                  ),
                )}
              </div>
            ))}
            {hover && (
              <div className="chart-tip" style={{ left: hover.x, top: hover.y }} role="tooltip">
                <strong>{dayLabel(hover.d.day)}</strong>
                <span>{formatDuration(hover.d.ms)} reading</span>
                <span>
                  {hover.d.chapters} {hover.d.chapters === 1 ? 'chapter' : 'chapters'} finished
                </span>
              </div>
            )}
          </div>
          <div className="heatmap__legend" aria-hidden>
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heatmap__cell lvl-${l}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      ) : (
        <DataTable rows={active.slice().reverse().map((d) => [dayLabel(d.day), formatDuration(d.ms), String(d.chapters)])} head={['Day', 'Reading time', 'Chapters finished']} empty="No reading in this period." />
      )}
    </div>
  );
}

/** Monthly reading time: single series, thin bars, value on hover, table alternative. */
function MonthChart({ months, view }: { months: MonthActivity[]; view: View }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...months.map((m) => m.ms), 1);
  const ticks = useMemo(() => {
    const maxMin = max / 60000;
    const step = maxMin > 600 ? 300 : maxMin > 240 ? 120 : maxMin > 120 ? 60 : maxMin > 60 ? 30 : maxMin > 20 ? 10 : 5;
    const top = Math.max(step, Math.ceil(maxMin / step) * step);
    return { top, values: Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step) };
  }, [max]);
  return (
    <div className="chart">
      {view === 'chart' ? (
        <div className="bars" role="img" aria-label="Reading time per month for the last 12 months" onMouseLeave={() => setHover(null)}>
          <div className="bars__axis" aria-hidden>
            {ticks.values
              .slice()
              .reverse()
              .map((v) => (
                <span key={v}>{v >= 60 ? `${v / 60} h` : `${v} min`}</span>
              ))}
          </div>
          <div className="bars__plot">
            {ticks.values.map((v) => (
              <span key={v} className="bars__grid" style={{ bottom: `${(v / ticks.top) * 100}%` }} />
            ))}
            {months.map((m, i) => (
              <button
                key={m.month}
                type="button"
                className={`bars__col ${hover === i ? 'is-hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${monthLabel(m.month, 'long')}: ${formatDuration(m.ms)}, ${m.chapters} chapters`}
              >
                <span className="bars__bar" style={{ height: `${(m.ms / 60000 / ticks.top) * 100}%` }} />
                <span className="bars__label">{monthLabel(m.month)}</span>
                {hover === i && (
                  <span className="chart-tip chart-tip--bar" role="tooltip">
                    <strong>{monthLabel(m.month, 'long')}</strong>
                    <span>{formatDuration(m.ms)} reading</span>
                    <span>{m.chapters} chapters finished</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <DataTable rows={months.slice().reverse().map((m) => [monthLabel(m.month, 'long'), formatDuration(m.ms), String(m.chapters)])} head={['Month', 'Reading time', 'Chapters finished']} empty="" />
      )}
    </div>
  );
}

function DataTable({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
