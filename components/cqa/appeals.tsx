'use client';

import { useState } from 'react';
import { Scale, ArrowRight, CheckCheck, MessageSquare, Clock3, Check, ArrowUpRight } from 'lucide-react';
import type { AppState, Appeal, Criterion, Evaluation, Rating } from '@/lib/types';
import { api, EmptyState, Modal, Pill, Spinner, parseRating, ratingLabel, ratingOptions, shortDate, speakerLabels, scoreText } from './shared';

export function AppealForm({ evaluation, criterion, onClose, onSaved }: {
  evaluation: Evaluation; criterion: Criterion; onClose: () => void; onSaved: (appeal: Appeal) => void;
}) {
  const [comment, setComment] = useState('');
  const [proposed, setProposed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = evaluation.results.find((result) => result.criterionId === criterion.id);
  async function save() {
    if (!comment.trim()) { setError('Объясните, почему вы оспариваете оценку.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<Appeal>('/api/appeals', {
        evaluationId: evaluation.id, criterionId: criterion.id, comment: comment.trim(),
        ...(proposed !== '' ? { proposedValue: parseRating(proposed) } : {}),
      });
      onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось подать апелляцию.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Оспорить оценку" subtitle={criterion.name} onClose={onClose} busy={busy}>
    <div className="modal-content">
      <div className="appeal-current"><span>Текущая оценка</span><Pill tone="blue">{ratingLabel(current?.value)}</Pill></div>
      <p className="rubric-description">{current?.explanation}</p>
      <label className="form-field">Комментарий<textarea className="field" rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Опишите, что следует пересмотреть, и укажите фрагмент диалога." autoFocus /></label>
      <label className="form-field">Предлагаемая оценка <span className="muted regular">необязательно</span><select className="field" value={proposed} onChange={(event) => setProposed(event.target.value)}><option value="">Оставить на усмотрение проверяющего</option>{ratingOptions(criterion).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
    </div>
    <div className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Scale size={16} />}Подать апелляцию</button></div>
  </Modal>;
}

export function AppealsView({ state, onOpenConversation, onResolved }: {
  state: AppState; onOpenConversation: (id: string) => void; onResolved: () => void;
}) {
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState<Appeal | null>(null);
  const [decision, setDecision] = useState<'confirm' | 'change'>('confirm');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [decisionEvidence, setDecisionEvidence] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = state.appeals.filter((appeal) => appeal.status === 'pending').length;
  const appeals = [...state.appeals].filter((appeal) => filter === 'all' || (filter === 'pending' ? appeal.status === 'pending' : appeal.status !== 'pending')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const evaluation = selected ? state.evaluations.find((item) => item.id === selected.evaluationId) : undefined;
  const conversation = selected ? state.conversations.find((item) => item.id === selected.conversationId) : undefined;
  const criterion = evaluation?.checklist.criteria.find((item) => item.id === selected?.criterionId);
  const originalResult = evaluation?.results.find((item) => item.criterionId === selected?.criterionId);
  function open(appeal: Appeal) {
    const linkedEvaluation = state.evaluations.find((item) => item.id === appeal.evaluationId);
    const linkedResult = linkedEvaluation?.results.find((item) => item.criterionId === appeal.criterionId);
    setSelected(appeal); setDecision('confirm'); setValue(appeal.proposedValue === null ? '' : String(appeal.proposedValue)); setReason(''); setError('');
    setDecisionEvidence([...(linkedResult?.evidence || [])]);
    setRangeStart(linkedResult?.checkedRange?.[0] || '');
    setRangeEnd(linkedResult?.checkedRange?.[1] || '');
  }
  async function resolve() {
    if (!selected) return;
    if (!reason.trim()) { setError('Укажите причину решения.'); return; }
    if (decision === 'change' && value === '') { setError('Выберите новую оценку.'); return; }
    if (decision === 'change' && value === 'yes' && !decisionEvidence.length) { setError('Для «Да» выберите хотя бы одну подтверждающую реплику.'); return; }
    if (decision === 'change' && !decisionEvidence.length && (!rangeStart || !rangeEnd)) { setError('Выберите доказательство или укажите проверенный участок разговора.'); return; }
    if (decision === 'change' && ((rangeStart && !rangeEnd) || (!rangeStart && rangeEnd))) { setError('Укажите обе границы проверенного участка либо очистите их.'); return; }
    if (decision === 'change' && rangeStart && rangeEnd && conversation && conversation.transcript.findIndex((message) => message.id === rangeStart) > conversation.transcript.findIndex((message) => message.id === rangeEnd)) { setError('Конец проверенного участка должен находиться после его начала.'); return; }
    setError(''); setBusy(true);
    try {
      await api('/api/appeals/resolve', { appealId: selected.id, decision, ...(decision === 'change' ? { value: parseRating(value), evidence: decisionEvidence, checkedRange: rangeStart && rangeEnd ? [rangeStart, rangeEnd] : null } : {}), reason: reason.trim() });
      setSelected(null); onResolved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить решение.'); }
    finally { setBusy(false); }
  }
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">Обоснованный пересмотр</div><h1>Апелляции</h1><p>Каждое решение сохраняется. Итог пересчитывается автоматически.</p></div><Pill tone={pending ? 'amber' : 'green'} dot>{pending ? pending + ' ожидают решения' : 'Нет открытых обращений'}</Pill></div>
    <div className="segmented-tabs" role="group" aria-label="Статус апелляций">{[{ value: 'pending', label: 'На рассмотрении', count: pending }, { value: 'resolved', label: 'Решённые', count: state.appeals.length - pending }, { value: 'all', label: 'Все', count: state.appeals.length }].map((item) => <button className={filter === item.value ? 'active' : ''} key={item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{item.count}</span></button>)}</div>
    {!appeals.length ? <div className="panel"><EmptyState icon={<Scale size={28} />} title={filter === 'pending' ? 'Все решения под контролем' : 'Здесь появятся апелляции'} description="Откройте оценённый диалог и нажмите «Оспорить» рядом с нужным критерием. Здесь можно будет проверить обоснование и принять решение." /></div> : <div className="appeal-list">{appeals.map((appeal) => {
      const itemEvaluation = state.evaluations.find((item) => item.id === appeal.evaluationId);
      const itemCriterion = itemEvaluation?.checklist.criteria.find((item) => item.id === appeal.criterionId);
      const itemConversation = state.conversations.find((item) => item.id === appeal.conversationId);
      return <article className="panel appeal-card" key={appeal.id}>
        <div className="appeal-card-top"><div className={'appeal-symbol ' + (appeal.status === 'pending' ? 'pending' : '')}>{appeal.status === 'pending' ? <Clock3 size={20} /> : <CheckCheck size={20} />}</div><div><span className="eyebrow">{itemConversation?.conversation_id || appeal.conversationId}</span><h3>{itemCriterion?.name || appeal.criterionId}</h3></div><Pill tone={appeal.status === 'pending' ? 'amber' : appeal.status === 'changed' ? 'blue' : 'green'}>{appeal.status === 'pending' ? 'На рассмотрении' : appeal.status === 'changed' ? 'Оценка изменена' : 'Оценка подтверждена'}</Pill></div>
        <p className="appeal-comment">{appeal.comment}</p>
        <div className="appeal-card-meta"><span>Исходная: <strong>{ratingLabel(appeal.originalValue)}</strong></span>{appeal.proposedValue !== null && <span>Предложено: <strong>{ratingLabel(appeal.proposedValue)}</strong></span>}{appeal.status !== 'pending' && <span>Решение: <strong>{ratingLabel(appeal.finalValue)}</strong></span>}<span>{shortDate(appeal.createdAt)}</span></div>
        {appeal.decisionReason && <div className="decision-note"><Check size={16} /><span>{appeal.decisionReason}</span></div>}
        <div className="appeal-card-footer"><button className="button text-button small-button" onClick={() => onOpenConversation(appeal.conversationId)}><MessageSquare size={15} />Открыть диалог</button><button className={'button small-button ' + (appeal.status === 'pending' ? 'primary' : 'secondary')} onClick={() => open(appeal)}>{appeal.status === 'pending' ? 'Рассмотреть' : 'Посмотреть решение'}<ArrowRight size={15} /></button></div>
      </article>;
    })}</div>}
    {selected && evaluation && criterion && <Modal title={selected.status === 'pending' ? 'Рассмотрение апелляции' : 'Решение по апелляции'} subtitle={criterion.name} onClose={() => setSelected(null)} busy={busy} wide>
      <div className="modal-content">
        <div className="review-context"><div><span className="muted small">Диалог</span><strong>{conversation?.conversation_id}</strong></div><div><span className="muted small">Оспариваемая оценка</span><strong>{ratingLabel(selected.originalValue)}</strong></div><div><span className="muted small">Текущий итог</span><strong>{scoreText(evaluation.score.total)} / 100</strong></div><button className="button text-button small-button" onClick={() => { setSelected(null); onOpenConversation(selected.conversationId); }}>Карточка<ArrowUpRight size={14} /></button></div>
        <div className="review-block"><span className="eyebrow">Комментарий автора</span><p>{selected.comment}</p></div>
        <div className="review-block"><span className="eyebrow">Правило критерия</span><p>{criterion.description}</p>{criterion.allowNA && <p className="small muted">N/A: {criterion.naCondition}</p>}</div>
        <div className="review-block"><span className="eyebrow">Обоснование текущей оценки</span><p>{originalResult?.explanation}</p></div>
        {conversation && <details className="review-transcript" open><summary>Диалог и доказательства<Chevron size={16} /></summary><div>{conversation.transcript.map((message) => <article key={message.id} className={originalResult?.evidence.includes(message.id) ? 'review-message highlighted' : 'review-message'}><header><strong>{speakerLabels[message.speaker]}</strong><span>{message.timestamp}</span></header><p>{message.text}</p></article>)}</div></details>}
        {selected.status === 'pending' ? <>
          <div className="decision-options"><button className={decision === 'confirm' ? 'selected' : ''} onClick={() => setDecision('confirm')}><CheckCheck size={20} /><strong>Подтвердить</strong><small>Сохранить текущую оценку</small></button><button className={decision === 'change' ? 'selected' : ''} onClick={() => setDecision('change')}><Scale size={20} /><strong>Изменить</strong><small>Указать новую оценку</small></button></div>
          {decision === 'change' && <label className="form-field">Новая оценка<select className="field" value={value} onChange={(event) => setValue(event.target.value)}><option value="">Выберите значение</option>{ratingOptions(criterion).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {decision === 'change' && conversation && <>
            <details className="evidence-picker" open={value === 'yes' && decisionEvidence.length === 0}>
              <summary>Доказательства нового решения<span>{decisionEvidence.length ? decisionEvidence.length + ' выбрано' : 'Выберите реплики'}</span><Chevron size={15} /></summary>
              <div className="evidence-options">{conversation.transcript.map((message) => <label key={message.id}>
                <input type="checkbox" checked={decisionEvidence.includes(message.id)} onChange={(event) => setDecisionEvidence((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} />
                <span><small>{speakerLabels[message.speaker]} · {message.timestamp}</small>{message.text}</span>
              </label>)}</div>
            </details>
            <div className="form-field"><span>Проверенный участок <span className="muted regular">(если действие отсутствует)</span></span><div className="range-fields">
              <select className="field" aria-label="Начало участка для решения" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)}><option value="">От сообщения…</option>{conversation.transcript.map((message) => <option key={message.id} value={message.id}>{message.timestamp} · {speakerLabels[message.speaker]} · {message.text.slice(0, 55)}</option>)}</select>
              <select className="field" aria-label="Конец участка для решения" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)}><option value="">До сообщения…</option>{conversation.transcript.map((message) => <option key={message.id} value={message.id}>{message.timestamp} · {speakerLabels[message.speaker]} · {message.text.slice(0, 55)}</option>)}</select>
            </div></div>
          </>}
          <label className="form-field">Причина решения<textarea className="field" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Объясните решение со ссылкой на разговор и правило." /></label>
        </> : <div className="notice notice-success"><CheckCheck size={19} /><span><strong>{selected.status === 'changed' ? 'Оценка изменена на ' + ratingLabel(selected.finalValue) : 'Оценка подтверждена'}</strong><br />{selected.decisionReason}</span></div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
      </div>
      <div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => setSelected(null)}>Закрыть</button>{selected.status === 'pending' && <button className="button primary" disabled={busy} onClick={resolve}>{busy ? <Spinner /> : <CheckCheck size={16} />}Сохранить решение</button>}</div>
    </Modal>}
  </div>;
}

function Chevron({ size }: { size: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6" /></svg>; }
