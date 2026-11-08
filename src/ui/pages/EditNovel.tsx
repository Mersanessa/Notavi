import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ImagePlus, X } from 'lucide-react';
import { db, mutate, toast, useStore } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { goBack, navigate, routes } from '../../app/router';
import { CONTENT_TYPES, STATUSES, type ContentType, type NovelInput, type ReadingStatus } from '../../data/model';
import { createNovel, getNovel, updateNovel } from '../../data/novels';
import { prepareCover } from '../../lib/image';
import { pickFiles } from '../../platform';
import { Button } from '../components/Button';
import { ChipInput, SelectField, Switch, TextArea, TextField } from '../components/Fields';
import { PageHeader, Spinner } from '../components/misc';

type Form = Required<Omit<NovelInput, 'favourite'>> & { favourite: boolean };

const EMPTY: Form = {
  title: '', altTitles: [], author: '', translator: '', description: '', genres: [], tags: [], contentType: 'original', source: '', licenceNotes: '',
  externalUrl: '', status: 'want_to_read', publicationStatus: '', favourite: false, personalNotes: '', language: '', rating: 0, readingMode: 'web',
};

function validUrl(u: string) {
  if (!u.trim()) return true;
  try {
    const x = new URL(u.trim());
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
}

export function EditNovelPage({ novelId }: { novelId: string | null }) {
  const creating = !novelId;
  useDocumentTitle(creating ? 'Add a novel' : 'Edit details');
  const existing = useAsync(() => (novelId ? getNovel(db(), novelId) : Promise.resolve(undefined)), [novelId]);
  const novels = useStore((s) => s.novels);
  const [form, setForm] = useState<Form>(EMPTY);
  const [cover, setCover] = useState<{ mime: string; data: Uint8Array; url: string } | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const n = existing.data;
    if (n) {
      const { id: _i, createdAt: _c, updatedAt: _u, contentUpdatedAt: _cu, lastReadAt: _l, coverId: _co, ...rest } = n;
      setForm({ ...EMPTY, ...(rest as Partial<Form>) });
    }
  }, [existing.data]);

  const suggestions = useMemo(() => {
    const g = new Set<string>();
    const t = new Set<string>();
    novels.forEach((n) => (n.genres.forEach((x) => g.add(x)), n.tags.forEach((x) => t.add(x))));
    return { genres: [...g].sort(), tags: [...t].sort() };
  }, [novels]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const titleError = touched && !form.title.trim() ? 'Give the novel a title.' : null;
  const urlError = !validUrl(form.externalUrl) ? 'Enter a full web address starting with https://' : null;
  const linkNeeded = form.contentType === 'external_link' && !form.externalUrl.trim() ? 'An external link needs a web address.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!form.title.trim() || urlError || linkNeeded) return;
    setSaving(true);
    const input: NovelInput = { ...form, externalUrl: form.externalUrl.trim() };
    if (creating) {
      const id = await mutate((d) => createNovel(d, input, { cover: cover ? { mime: cover.mime, data: cover.data } : null }), 'Novel added');
      setSaving(false);
      if (id) navigate(routes.novel(id), { replace: true });
    } else {
      const ok = await mutate((d) => updateNovel(d, novelId!, input).then(() => true), 'Details saved');
      setSaving(false);
      if (ok) goBack(routes.novel(novelId!));
    }
  };

  const chooseCover = async () => {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    try {
      const p = await prepareCover(f.bytes);
      if (cover) URL.revokeObjectURL(cover.url);
      setCover({ ...p, url: URL.createObjectURL(new Blob([p.data as unknown as ArrayBuffer], { type: p.mime })) });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  if (!creating && existing.loading && !existing.data) return <div className="page"><Spinner /></div>;

  return (
    <div className="page page--form">
      <button type="button" className="back-link" onClick={() => goBack(creating ? routes.library() : routes.novel(novelId!))}>
        <ArrowLeft size={18} aria-hidden /> {creating ? 'Library' : 'Back'}
      </button>
      <PageHeader title={creating ? 'Add a novel' : 'Edit details'} lead={creating ? 'Fill in what you know. Only the title is required; you can add chapters afterwards.' : undefined} />
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="form__section">
          <legend>The novel</legend>
          <TextField label="Title" required value={form.title} onChange={(e) => set('title', e.target.value)} onBlur={() => setTouched(true)} error={titleError} autoFocus={creating} />
          <ChipInput label="Alternative titles" values={form.altTitles} onChange={(v) => set('altTitles', v)} placeholder="Original-language or other titles" hint="Press Enter after each one." />
          <div className="form__row">
            <TextField label="Author" value={form.author} onChange={(e) => set('author', e.target.value)} />
            <TextField label="Translator" value={form.translator} onChange={(e) => set('translator', e.target.value)} />
          </div>
          <TextArea label="Description" rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
          <ChipInput label="Genres" values={form.genres} onChange={(v) => set('genres', v)} suggestions={suggestions.genres} placeholder="e.g. Fantasy, Mystery" />
          <ChipInput label="Tags" values={form.tags} onChange={(v) => set('tags', v)} suggestions={suggestions.tags} placeholder="e.g. Slow burn, Victorian" />
          <div className="form__row">
            <TextField label="Publication status" value={form.publicationStatus} onChange={(e) => set('publicationStatus', e.target.value)} placeholder="e.g. Ongoing, Completed" />
            <TextField label="Language" value={form.language} onChange={(e) => set('language', e.target.value)} placeholder="e.g. English" />
          </div>
          {creating && (
            <div className="field">
              <span className="field__label">Cover</span>
              <div className="cover-pick">
                {cover ? (
                  <>
                    <img src={cover.url} alt="Chosen cover" className="cover-pick__img" />
                    <Button size="sm" variant="ghost" icon={X} onClick={() => setCover(null)}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button icon={ImagePlus} onClick={chooseCover}>
                    Choose an image
                  </Button>
                )}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="form__section">
          <legend>Source and licence</legend>
          <SelectField<ContentType>
            label="Content type"
            value={form.contentType}
            onChange={(v) => set('contentType', v)}
            options={CONTENT_TYPES.map((c) => ({ value: c.value, label: c.label }))}
            hint={CONTENT_TYPES.find((c) => c.value === form.contentType)?.hint}
          />
          <TextField label="Source" value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="Where it came from, e.g. Project Gutenberg, a bookshop, the author" />
          <TextArea label="Licence notes" rows={2} value={form.licenceNotes} onChange={(e) => set('licenceNotes', e.target.value)} placeholder="e.g. Public domain in the UK; bought DRM-free; personal copy" />
          <TextField
            label="External link"
            type="url"
            inputMode="url"
            value={form.externalUrl}
            onChange={(e) => set('externalUrl', e.target.value)}
            error={urlError || (touched ? linkNeeded : null)}
            hint="Saved as a link only. Notavi never downloads or copies content from websites."
            placeholder="https://"
          />
        </fieldset>

        <fieldset className="form__section">
          <legend>Your reading</legend>
          <SelectField<ReadingStatus> label="Status" value={form.status} onChange={(v) => set('status', v)} options={STATUSES} />
          <Switch label="Favourite" checked={form.favourite} onChange={(v) => set('favourite', v)} />
          <TextArea label="Personal notes" rows={3} value={form.personalNotes} onChange={(e) => set('personalNotes', e.target.value)} />
        </fieldset>

        <div className="form__actions">
          <Button variant="ghost" onClick={() => goBack(creating ? routes.library() : routes.novel(novelId!))}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={saving}>
            {creating ? 'Add novel' : 'Save details'}
          </Button>
        </div>
      </form>
    </div>
  );
}
