'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Check, UserRoundPen, Save } from 'lucide-react';
import type { Checklist, Conversation, CriterionResult, Evaluation } from '@/lib/types';
import { api, Modal, Pill, Spinner, parseRating, ratingOptions, speakerLabels } from './shared';

interface Draft { value: string; explanation: string; evidence: string[]; start: string; end: string }

export function ManualEvaluation({ conversation, checklist, onClose, onSaved }: {
  conversation: Conversation; checklist: Checklist; onClose: () => void; onSaved: (evaluation: Evaluation) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    Object.fromEntries(checklist.criteria.map((criterion) => [criterion.id, { value: '', explanation: '', evidence: [], start: '', end: '' }])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openCriteria, setOpenCriteria] = useState<Set<string>>(() => new Set(checklist.criteria[0] ? [checklist.criteria[0].id] : []));
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());
  const [errorCriterion, setErrorCriterion] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!errorCriterion) return;
    const item = document.getElementById('manual-' + errorCriterion.id);
    item?.querySelector('summary')?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [errorCriterion]);
  function setCriterionOpen(id: string, open: boolean) {
    setOpenCriteria((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
  }
  function setEvidenceOpen(id: string, open: boolean) {
    setOpenEvidence((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
  }
  function showCriterionError(id: string, message: string, evidenceRequired = false) {
    setError(message);
    setCriterionOpen(id, true);
    if (evidenceRequired) setEvidenceOpen(id, true);
    setErrorCriterion({ id });
  }
  function update(id: string, changes: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  }
  const complete = checklist.criteria.filter((criterion) => {
    const draft = drafts[criterion.id];
    return draft?.value !== '' && draft?.explanation.trim() && (draft.value === 'yes' ? draft.evidence.length > 0 : (draft?.evidence.length || (draft?.start && draft?.end)));
  }).length;
  async function save() {
    setError('');
    for (const criterion of checklist.criteria) {
      const draft = drafts[criterion.id];
      if (draft?.value === 'yes' && !draft.evidence.length) {
        showCriterionError(criterion.id, 'Для «Да» выберите хотя бы одну подтверждающую реплику: ' + criterion.name + '.', true);
        return;
      }
      if (!draft || draft.value === '' || !draft.explanation.trim() || (!draft.evidence.length && (!draft.start || !draft.end))) {
        showCriterionError(criterion.id, 'Заполните оценку, объяснение и доказательство или проверенный участок для критерия «' + criterion.name + '».');
        return;
      }
      if ((draft.start && !draft.end) || (!draft.start && draft.end)) { showCriterionError(criterion.id, 'Укажите начало и конец проверенного участка.'); return; }
      if (draft.start && draft.end && conversation.transcript.findIndex((message) => message.id === draft.start) > conversation.transcript.findIndex((message) => message.id === draft.end)) {
        showCriterionError(criterion.id, 'Конец проверенного участка должен находиться после его начала.'); return;
      }
    }
    const results: CriterionResult[] = checklist.criteria.map((criterion) => {
      const draft = drafts[criterion.id];
      return { criterionId: criterion.id, value: parseRating(draft.value), explanation: draft.explanation.trim(),
        evidence: draft.evidence, checkedRange: draft.start && draft.end ? [draft.start, draft.end] : null, needsReview: false };
    });
    setBusy(true);
    try {
      const evaluation = await api<Evaluation>('/api/manual', { conversationId: conversation.id, checklistId: checklist.id, results });
      onSaved(evaluation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить оценку.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Оценка эксперта" subtitle={conversation.conversation_id + ' · ' + checklist.name + ' · версия ' + checklist.version} onClose={onClose} wide busy={busy}>
    <div className="modal-content">
      <div className="notice notice-soft"><UserRoundPen size={18} /><span>Вы выставляете оценки самостоятельно. Результат будет отмечен как оценка эксперта и сохранён отдельно от запусков AI. Официальная сдача использует исходные AI-запуски. Номера реплик ниже соответствуют полному исходному транскрипту.</span></div>
      <div className="manual-progress"><span>Заполнено критериев</span><strong>{complete} / {checklist.criteria.length}</strong><div><i style={{ width: (complete / Math.max(1, checklist.criteria.length) * 100) + '%' }} /></div></div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="manual-list">
        {checklist.criteria.map((criterion, index) => {
          const draft = drafts[criterion.id];
          const completed = draft.value !== '' && draft.explanation.trim() && (draft.value === 'yes' ? draft.evidence.length > 0 : (draft.evidence.length || (draft.start && draft.end)));
          return <details className="manual-item" id={'manual-' + criterion.id} key={criterion.id} open={openCriteria.has(criterion.id)} onToggle={(event) => {
            if (event.target === event.currentTarget) setCriterionOpen(criterion.id, event.currentTarget.open);
          }}>
            <summary><span className={'manual-number ' + (completed ? 'complete' : '')}>{completed ? <Check size={15} /> : index + 1}</span><strong>{criterion.name}</strong>{draft.value === 'na' && <Pill>N/A</Pill>}<ChevronDown size={16} className="details-chevron" /></summary>
            <div className="manual-body">
              <p className="rubric-description">{criterion.description}</p>
              {criterion.allowNA && <p className="small muted"><strong>N/A:</strong> {criterion.naCondition}</p>}
              {criterion.kind === 'scale' && <dl className="manual-scale-guide" aria-label={'Ступени шкалы: ' + criterion.name}>
                {[...criterion.levels].sort((a, b) => b.value - a.value).map((level) => <div key={level.value} className={draft.value === String(level.value) ? 'is-selected' : ''}><dt>{level.value}</dt><dd>{level.label}</dd></div>)}
              </dl>}
              <label className="form-field">Оценка<select className="field" value={draft.value} onChange={(event) => update(criterion.id, { value: event.target.value })}><option value="">Выберите оценку</option>{ratingOptions(criterion).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="form-field">Обоснование<textarea className="field" rows={2} value={draft.explanation} onChange={(event) => update(criterion.id, { explanation: event.target.value })} placeholder="Что в разговоре подтверждает вашу оценку?" /></label>
              <details className="evidence-picker" open={openEvidence.has(criterion.id)} onToggle={(event) => {
                if (event.target === event.currentTarget) setEvidenceOpen(criterion.id, event.currentTarget.open);
              }}>
                <summary>Выбрать реплики-доказательства <span>{draft.evidence.length > 0 ? draft.evidence.length + ' выбрано' : 'Не выбраны'}</span><ChevronDown size={15} /></summary>
                <div className="evidence-options">{conversation.transcript.map((message, index) => <label key={message.id}>
                  <input type="checkbox" checked={draft.evidence.includes(message.id)} onChange={(event) => update(criterion.id, { evidence: event.target.checked ? [...draft.evidence, message.id] : draft.evidence.filter((id) => id !== message.id) })} />
                  <span><small>#{index + 1} · {speakerLabels[message.speaker]} · {message.timestamp}</small>{message.text}</span>
                </label>)}</div>
              </details>
              <div className="form-field"><span>Проверенный участок <span className="muted regular">(если действие отсутствует)</span></span><div className="range-fields">
                <select className="field" aria-label={'Начало участка: ' + criterion.name} value={draft.start} onChange={(event) => update(criterion.id, { start: event.target.value })}><option value="">От сообщения…</option>{conversation.transcript.map((message, index) => <option key={message.id} value={message.id}>#{index + 1} · {message.timestamp} · {speakerLabels[message.speaker]} · {message.text.slice(0, 55)}</option>)}</select>
                <select className="field" aria-label={'Конец участка: ' + criterion.name} value={draft.end} onChange={(event) => update(criterion.id, { end: event.target.value })}><option value="">До сообщения…</option>{conversation.transcript.map((message, index) => <option key={message.id} value={message.id}>#{index + 1} · {message.timestamp} · {speakerLabels[message.speaker]} · {message.text.slice(0, 55)}</option>)}</select>
              </div></div>
            </div>
          </details>;
        })}
      </div>
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>Отмена</button><button className="button primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={16} />}Сохранить оценку эксперта</button></div>
  </Modal>;
}
