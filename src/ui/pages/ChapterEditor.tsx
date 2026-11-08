import { useEffect, useRef, useState } from 'react';
import { AlignCenter, ArrowLeft, Bold, Italic, Minus, RemoveFormatting, Type } from 'lucide-react';
import { db, mutate } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { blobUrl, resolveBlobRefs } from '../../app/blobs';
import { goBack, navigate, routes, useRoute } from '../../app/router';
import { addChapter, getChapter, getNovel, listChapters, updateChapter } from '../../data/novels';
import { sanitizeChapterHtml } from '../../import/dom';
import { textToHtml } from '../../import/txt';
import { countWords, formatNumber, htmlToText } from '../../lib/text';
import { Button, IconButton } from '../components/Button';
import { Segmented, TextField } from '../components/Fields';
import { PageHeader, Spinner } from '../components/misc';
import { confirmAction } from '../components/confirm';

/** Turn editor HTML (with blob: URLs for images) back into stored HTML. */
function toStored(html: string, urlToRef: Map<string, string>): string {
  let out = html;
  for (const [url, ref] of urlToRef) out = out.replaceAll(url, ref);
  return sanitizeChapterHtml(out);
}

function htmlToEditableText(html: string): string {
  return htmlToText(html.replace(/<\/p>\s*<p/gi, '</p>\n\n<p').replace(/<hr\s*\/?>/gi, '\n\n* * *\n\n')).replace(/\n(?!\n)/g, '\n\n').replace(/\n{3,}/g, '\n\n');
}

export function ChapterEditorPage({ novelId, chapterId }: { novelId: string; chapterId: string | null }) {
  const creating = !chapterId;
  const { query } = useRoute();
  const at = query.get('at');
  useDocumentTitle(creating ? 'New chapter' : 'Edit chapter');
  const data = useAsync(async () => {
    const [novel, chapter, chapters] = await Promise.all([getNovel(db(), novelId), chapterId ? getChapter(db(), chapterId) : undefined, listChapters(db(), novelId, { all: true })]);
    return { novel, chapter, count: chapters.length };
  }, [novelId, chapterId]);

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'rich' | 'text'>('rich');
  const [plain, setPlain] = useState('');
  const [words, setWords] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const urlMap = useRef(new Map<string, string>());
  const loaded = useRef(false);

  useEffect(() => {
    if (!data.data || loaded.current) return;
    loaded.current = true;
    const ch = data.data.chapter;
    setTitle(ch ? (data.data.novel?.readingMode === 'book' ? ch.originalTitle : ch.title) : `Chapter ${(at ? Number(at) : data.data.count) + 1}`);
    const raw = ch?.content ?? '';
    const refs = Array.from(new Set(Array.from(raw.matchAll(/notavi-blob:([a-z0-9-]+)/gi), (m) => m[1])));
    void Promise.all(refs.map((id) => blobUrl(id))).then((urls) => {
      urls.forEach((u, i) => u && urlMap.current.set(u, `notavi-blob:${refs[i]}`));
      return resolveBlobRefs(raw);
    }).then((resolved) => {
      if (editor.current) editor.current.innerHTML = resolved || '<p><br></p>';
      setWords(countWords(htmlToText(raw)));
    });
  }, [data.data, at]);

  // Warn before leaving with unsaved changes (browser close / reload).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const currentHtml = () => (mode === 'text' ? textToHtml(plain) : toStored(editor.current?.innerHTML ?? '', urlMap.current));

  const switchMode = (m: 'rich' | 'text') => {
    if (m === mode) return;
    if (m === 'text') setPlain(htmlToEditableText(toStored(editor.current?.innerHTML ?? '', urlMap.current)));
    else {
      const html = textToHtml(plain);
      requestAnimationFrame(() => {
        if (editor.current) editor.current.innerHTML = html || '<p><br></p>';
      });
    }
    setMode(m);
  };

  const exec = (cmd: string, arg?: string) => {
    editor.current?.focus();
    document.execCommand(cmd, false, arg);
    setDirty(true);
  };

  const toggleCentre = () => {
    let node = window.getSelection()?.anchorNode ?? null;
    while (node && node !== editor.current && !(node instanceof HTMLElement && /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(node.tagName))) node = node.parentNode;
    if (!(node instanceof HTMLElement) || node === editor.current) return;
    if (node.dataset.align === 'center') delete node.dataset.align;
    else node.dataset.align = 'center';
    setDirty(true);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? sanitizeChapterHtml(html.replace(/<img[^>]*>/gi, '')) : textToHtml(text);
    document.execCommand('insertHTML', false, clean);
    setDirty(true);
  };

  const save = async () => {
    const content = currentHtml();
    setSaving(true);
    let ok: unknown;
    if (creating) {
      ok = await mutate((d) => addChapter(d, novelId, { title, content }, at ? Number(at) : undefined), 'Chapter added');
    } else {
      ok = await mutate((d) => updateChapter(d, chapterId!, data.data?.novel?.readingMode === 'book' && data.data.chapter && data.data.chapter.originalTitle !== data.data.chapter.title ? { originalTitle: title, content } : { title, content }).then(() => true), 'Chapter saved');
    }
    setSaving(false);
    if (ok) {
      setDirty(false);
      navigate(routes.novel(novelId, 'chapters'), { replace: true });
    }
  };

  const leave = async () => {
    if (dirty && !(await confirmAction({ title: 'Discard changes?', body: 'Your edits to this chapter haven’t been saved.', confirmLabel: 'Discard', danger: true }))) return;
    goBack(routes.novel(novelId, 'chapters'));
  };

  if (data.loading && !data.data) return <div className="page"><Spinner /></div>;
  if (!data.data?.novel || (!creating && !data.data.chapter)) return <div className="page"><p>This chapter no longer exists.</p></div>;

  return (
    <div className="page page--editor">
      <button type="button" className="back-link" onClick={leave}>
        <ArrowLeft size={18} aria-hidden /> {data.data.novel.title}
      </button>
      <PageHeader title={creating ? 'New chapter' : 'Edit chapter'}>
        <Button variant="ghost" onClick={leave}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} busy={saving} disabled={!title.trim()}>
          {creating ? 'Add chapter' : 'Save chapter'}
        </Button>
      </PageHeader>
      <TextField label="Chapter title" value={title} onChange={(e) => (setTitle(e.target.value), setDirty(true))} />
      <div className="editor-bar">
        <Segmented
          label="Editing mode"
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'rich', label: 'Formatted' },
            { value: 'text', label: 'Plain text' },
          ]}
        />
        {mode === 'rich' && (
          <div className="editor-bar__tools" role="toolbar" aria-label="Formatting">
            <IconButton icon={Bold} size="sm" label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} />
            <IconButton icon={Italic} size="sm" label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} />
            <IconButton icon={Type} size="sm" label="Subheading" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'h3')} />
            <IconButton icon={AlignCenter} size="sm" label="Centre paragraph" onMouseDown={(e) => e.preventDefault()} onClick={toggleCentre} />
            <IconButton icon={Minus} size="sm" label="Scene break" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertHTML', '<hr><p><br></p>')} />
            <IconButton icon={RemoveFormatting} size="sm" label="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => (exec('removeFormat'), exec('formatBlock', 'p'))} />
          </div>
        )}
        <span className="editor-bar__count">{formatNumber(words)} words</span>
      </div>
      {mode === 'rich' ? (
        <div
          ref={editor}
          className="chapter-editor reading-text"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Chapter text"
          onInput={() => {
            setDirty(true);
            setWords(countWords(editor.current?.innerText ?? ''));
          }}
          onPaste={onPaste}
        />
      ) : (
        <textarea
          className="chapter-editor chapter-editor--plain"
          aria-label="Chapter text"
          value={plain}
          onChange={(e) => {
            setPlain(e.target.value);
            setDirty(true);
            setWords(countWords(e.target.value));
          }}
          placeholder="Paste or type the chapter. Leave a blank line between paragraphs."
        />
      )}
      <p className="field__hint">Pasted text keeps simple formatting (italics, bold, paragraphs). Leave a blank line between paragraphs in plain-text mode; a line of “* * *” becomes a scene break.</p>
    </div>
  );
}
