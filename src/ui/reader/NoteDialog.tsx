import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';

export function NoteDialog({ quote, initial, onSave, onCancel }: { quote: string; initial: string; onSave: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState(initial);
  return (
    <Dialog
      open
      onClose={onCancel}
      title={initial ? 'Edit note' : 'Add a note'}
      className="reader-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(note.trim())} disabled={!note.trim() && !initial}>
            Save note
          </Button>
        </>
      }
    >
      {quote && <blockquote className="ann__quote">{quote.length > 400 ? quote.slice(0, 400) + '…' : quote}</blockquote>}
      <label className="field__label" htmlFor="reader-note">
        Your note
      </label>
      <textarea id="reader-note" className="input input--area" rows={5} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
    </Dialog>
  );
}
