import { useState } from 'react';
import { ArrowLeft, ArrowUpDown, Folders, ListChecks, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { db, mutate, useStore } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { goBack, navigate, routes } from '../../app/router';
import { addToCollection, collectionNovelIds, createCollection, deleteCollection, getCollection, removeFromCollection, reorderCollectionItems, updateCollection } from '../../data/collections';
import type { NovelSummary } from '../../data/model';
import { BookCard } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { Button, IconButton } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Menu } from '../components/Menu';
import { EmptyState, PageHeader, Spinner } from '../components/misc';
import { TextArea, TextField } from '../components/Fields';
import { confirmAction } from '../components/confirm';
import { ReorderList } from '../components/ReorderList';
import { CollectionTile } from './Home';

function CollectionForm({ open, onClose, initial, onSave }: { open: boolean; onClose: () => void; initial?: { name: string; description: string }; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? 'Edit collection' : 'New collection'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void onSave(name, description).then(onClose)}>
            {initial ? 'Save' : 'Create collection'}
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} data-autofocus placeholder="e.g. Victorian mysteries" />
      <TextArea label="Description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
    </Dialog>
  );
}

export function CollectionsPage() {
  useDocumentTitle('Collections');
  const collections = useStore((s) => s.collections);
  const novels = useStore((s) => s.novels);
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <PageHeader title="Collections" lead="Group novels however you like. A novel can be in any number of collections.">
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          New collection
        </Button>
      </PageHeader>
      {!collections.length ? (
        <EmptyState icon={Folders} title="No collections yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create a collection</Button>}>
          Collections are shelves you arrange yourself, e.g. “To reread” or “Cultivation”.
        </EmptyState>
      ) : (
        <div className="collection-grid">
          {collections.map((c) => (
            <CollectionTile key={c.id} id={c.id} name={c.name} count={c.novelCount} coverNovelIds={c.coverNovelIds} novels={novels} />
          ))}
        </div>
      )}
      {creating && (
        <CollectionForm
          open
          onClose={() => setCreating(false)}
          onSave={async (name, description) => {
            const id = await mutate((d) => createCollection(d, name, description), 'Collection created');
            if (id) navigate(routes.collection(id));
          }}
        />
      )}
    </div>
  );
}

export function CollectionPage({ id }: { id: string }) {
  const novels = useStore((s) => s.novels);
  const data = useAsync(async () => ({ c: await getCollection(db(), id), ids: await collectionNovelIds(db(), id) }), [id]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reorder, setReorder] = useState(false);
  useDocumentTitle(data.data?.c?.name);

  if (data.loading && !data.data) return <div className="page"><Spinner /></div>;
  const c = data.data?.c;
  if (!c)
    return (
      <div className="page">
        <EmptyState icon={Folders} title="Collection not found" action={<Button onClick={() => navigate(routes.collections())}>All collections</Button>}>
          It may have been deleted.
        </EmptyState>
      </div>
    );
  const members = data.data!.ids.map((nid) => novels.find((n) => n.id === nid)).filter(Boolean) as NovelSummary[];

  return (
    <div className="page">
      <button type="button" className="back-link" onClick={() => goBack(routes.collections())}>
        <ArrowLeft size={18} aria-hidden /> Collections
      </button>
      <PageHeader title={c.name} lead={c.description || `${members.length} ${members.length === 1 ? 'novel' : 'novels'}`}>
        {members.length > 1 && (
          <Button icon={reorder ? ListChecks : ArrowUpDown} variant={reorder ? 'primary' : 'secondary'} onClick={() => setReorder(!reorder)}>
            {reorder ? 'Done' : 'Reorder'}
          </Button>
        )}
        <Button icon={Plus} onClick={() => setAdding(true)}>
          Add novels
        </Button>
        <Menu
          label="Collection actions"
          items={[
            { label: 'Edit name and description', icon: Pencil, onSelect: () => setEditing(true) },
            {
              label: 'Delete collection',
              icon: Trash2,
              danger: true,
              onSelect: async () => {
                if (await confirmAction({ title: `Delete “${c.name}”?`, body: 'The novels stay in your library; only the collection is removed.', confirmLabel: 'Delete collection', danger: true })) {
                  await mutate((d) => deleteCollection(d, c.id), 'Collection deleted');
                  navigate(routes.collections(), { replace: true });
                }
              },
            },
          ]}
          trigger={(p) => <IconButton icon={MoreHorizontal} label="Collection actions" {...p} />}
        />
      </PageHeader>
      {!members.length ? (
        <EmptyState icon={Folders} title="This collection is empty" action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add novels</Button>} />
      ) : reorder ? (
        <ReorderList
          items={members}
          label={(n) => n.title}
          onReorder={(ids) => void mutate((d) => reorderCollectionItems(d, c.id, ids)).then(data.reload)}
          renderItem={(n) => (
            <span className="reorder-novel">
              <Cover coverId={n.coverId} title={n.title} size="xs" />
              {n.title}
            </span>
          )}
        />
      ) : (
        <div className="book-grid">
          {members.map((n) => (
            <div key={n.id} className="book-grid__item--removable">
              <BookCard novel={n} />
              <IconButton className="book-grid__remove" icon={X} size="sm" label={`Remove ${n.title} from ${c.name}`} onClick={() => void mutate((d) => removeFromCollection(d, c.id, n.id)).then(data.reload)} />
            </div>
          ))}
        </div>
      )}
      {editing && <CollectionForm open initial={{ name: c.name, description: c.description }} onClose={() => setEditing(false)} onSave={async (name, description) => void (await mutate((d) => updateCollection(d, c.id, { name, description }), 'Saved'), data.reload())} />}
      {adding && <AddNovels collectionId={c.id} existing={data.data!.ids} onClose={() => (setAdding(false), data.reload())} />}
    </div>
  );
}

function AddNovels({ collectionId, existing, onClose }: { collectionId: string; existing: string[]; onClose: () => void }) {
  const novels = useStore((s) => s.novels);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const list = novels.filter((n) => !existing.includes(n.id) && (!q || n.title.toLowerCase().includes(q.toLowerCase()) || n.author.toLowerCase().includes(q.toLowerCase())));
  const save = async () => {
    await mutate(async (d) => {
      for (const id of picked) await addToCollection(d, collectionId, id);
    }, picked.length === 1 ? 'Added 1 novel' : `Added ${picked.length} novels`);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add novels"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.length} onClick={save}>
            Add {picked.length || ''}
          </Button>
        </>
      }
    >
      <TextField label="Find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or author" data-autofocus />
      {!list.length ? (
        <p className="muted">{novels.length === existing.length ? 'Every novel in your library is already in this collection.' : 'No novels match.'}</p>
      ) : (
        <ul className="check-list check-list--novels">
          {list.map((n) => (
            <li key={n.id}>
              <label className="check-list__item">
                <input type="checkbox" checked={picked.includes(n.id)} onChange={() => setPicked(picked.includes(n.id) ? picked.filter((x) => x !== n.id) : [...picked, n.id])} />
                <Cover coverId={n.coverId} title={n.title} size="xs" />
                <span>
                  {n.title}
                  {n.author && <span className="muted"> by {n.author}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
