'use client';

import { useRef, useState } from 'react';
import { Upload, FileJson, CloudDownload, CheckCircle2 } from 'lucide-react';
import { api, Modal, Spinner } from './shared';

export function ImportModal({ datasetConfigured, onClose, onImported }: {
  datasetConfigured: boolean; onClose: () => void; onImported: (groupId: string, count: number) => void;
}) {
  const [mode, setMode] = useState<'api' | 'json'>(datasetConfigured ? 'api' : 'json');
  const [groupId, setGroupId] = useState('DEV');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Размер JSON-файла не должен превышать 5 МБ.'); return; }
    try { setText(await file.text()); setFileName(file.name); setError(''); }
    catch { setError('Не удалось прочитать файл.'); }
  }
  async function run() {
    setError('');
    if (!groupId.trim()) { setError('Укажите идентификатор набора.'); return; }
    let body: unknown;
    if (mode === 'json') {
      if (!text.trim()) { setError('Выберите файл или вставьте JSON.'); return; }
      try { body = { groupId: groupId.trim(), payload: JSON.parse(text) }; }
      catch { setError('Не удалось прочитать JSON. Проверьте синтаксис файла.'); return; }
    } else body = { groupId: groupId.trim() };
    setBusy(true);
    try {
      const result = await api<{ count: number; groupId: string }>('/api/import', body);
      onImported(result.groupId, result.count);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить диалоги.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Загрузить диалоги" subtitle="Новый набор для оценки по вашему чек-листу" onClose={onClose} busy={busy}>
    <div className="modal-content">
      <div className="segmented-tabs import-tabs"><button className={mode === 'api' ? 'active' : ''} onClick={() => setMode('api')} disabled={!datasetConfigured}><CloudDownload size={16} />API организаторов</button><button className={mode === 'json' ? 'active' : ''} onClick={() => { setMode('json'); if (groupId === 'DEV') setGroupId('UPLOAD'); }}><FileJson size={16} />JSON-файл</button></div>
      <label className="form-field">Идентификатор набора<input className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)} placeholder={mode === 'api' ? 'DEV или группа контрольного набора' : 'Например, CONTROL'} maxLength={100} /><small>{mode === 'api' ? 'Для контрольного этапа введите group_id, полученный от организаторов.' : 'Этот идентификатор поможет отличать загруженные наборы.'}</small></label>
      {mode === 'json' ? <>
        <input ref={inputRef} type="file" accept=".json,application/json" className="visually-hidden" onChange={(event) => readFile(event.target.files?.[0])} />
        <button className={'upload-zone ' + (fileName ? 'has-file' : '')} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void readFile(event.dataTransfer.files[0]); }}>{fileName ? <CheckCircle2 size={28} /> : <Upload size={28} />}<strong>{fileName || 'Выберите или перетащите JSON-файл'}</strong><span>Ответ API организаторов или массив диалогов · до 5 МБ</span></button>
        <label className="form-field">Или вставьте JSON<textarea className="field code-field" rows={6} value={text} onChange={(event) => { setText(event.target.value); setFileName(''); }} placeholder='{"data":{"records":[...]}}' spellCheck={false} /></label>
      </> : <div className="notice notice-soft"><CloudDownload size={19} /><span>Диалоги загружаются через сервер. Исходные роли, текст и временные метки сохраняются.</span></div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>Отмена</button><button className="button primary" onClick={run} disabled={busy}>{busy ? <Spinner /> : <Upload size={16} />}{busy ? 'Загружаем…' : 'Загрузить диалоги'}</button></div>
  </Modal>;
}
