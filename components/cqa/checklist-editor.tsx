'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, RotateCcw, ListChecks, ShieldCheck, ChevronDown, ArrowRight } from 'lucide-react';
import type { Checklist, Criterion } from '@/lib/types';
import { CHECKLIST_TEMPLATE_CHANGES, CHECKLIST_TEMPLATE_REVISION, DEFAULT_CHECKLIST, validateChecklist } from '@/lib/rubric';
import { SUBMISSION_CRITERIA, checklistSubmissionIssues } from '@/lib/submission';
import { api, Pill, Spinner, shortDate } from './shared';

export function ChecklistEditor({ checklist, all, onSelect, onSaved }: {
  checklist?: Checklist; all: Checklist[]; onSelect: (id: string) => void; onSaved: (checklist: Checklist) => void;
}) {
  const [name, setName] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fromTemplate, setFromTemplate] = useState(false);
  const [openCriteria, setOpenCriteria] = useState<Set<string>>(new Set());
  useEffect(() => {
    setName(checklist?.name || '');
    setCriteria(structuredClone(checklist?.criteria || []));
    setError('');
    setFromTemplate(false);
    setOpenCriteria(new Set(checklist?.criteria[0] ? [checklist.criteria[0].id] : []));
  }, [checklist?.id]);
  const changed = name !== checklist?.name || JSON.stringify(criteria) !== JSON.stringify(checklist?.criteria);
  const weighted = criteria.filter((criterion) => criterion.kind !== 'flag');
  const weight = weighted.reduce((sum, criterion) => sum + (Number(criterion.weight) || 0), 0);
  const issues = validateChecklist(criteria);
  const submissionIssues = checklist ? checklistSubmissionIssues({ ...checklist, criteria }) : [];
  function update(id: string, update: Partial<Criterion>) {
    setCriteria((current) => current.map((criterion) => criterion.id === id ? { ...criterion, ...update } : criterion));
  }
  function setCriterionOpen(id: string, open: boolean) {
    setOpenCriteria((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
  }
  function addCriterion() {
    const id = 'custom-' + crypto.randomUUID().slice(0, 8);
    setCriteria((current) => [...current, {
      id,
      name: '', section: 'Дополнительные критерии', description: '', kind: 'boolean',
      weight: 10, allowNA: false, naCondition: '', levels: [],
    }]);
    setCriterionOpen(id, true);
  }
  function removeCriterion(id: string) {
    setCriteria((current) => current.filter((criterion) => criterion.id !== id));
    setCriterionOpen(id, false);
  }
  function applyTemplate() {
    setName(DEFAULT_CHECKLIST.name + ' · уточнённые правила');
    setCriteria(structuredClone(DEFAULT_CHECKLIST.criteria));
    setOpenCriteria(new Set(DEFAULT_CHECKLIST.criteria[0] ? [DEFAULT_CHECKLIST.criteria[0].id] : []));
    setFromTemplate(true);
    setError('');
  }
  function resetDraft() {
    if (!checklist) return;
    setName(checklist.name);
    setCriteria(structuredClone(checklist.criteria));
    setOpenCriteria((current) => new Set([...current].filter((id) => checklist.criteria.some((criterion) => criterion.id === id))));
    setFromTemplate(false);
    setError('');
  }
  async function save() {
    setError('');
    if (!name.trim()) { setError('Укажите название чек-листа.'); return; }
    if (!criteria.length) { setError('Добавьте хотя бы один критерий.'); return; }
    if (issues.length) { setError(issues.slice(0, 5).join(' ')); return; }
    if (criteria.some((criterion) => !criterion.name.trim() || !criterion.description.trim())) {
      setError('У каждого критерия должны быть название и правило оценки.'); return;
    }
    setBusy(true);
    try {
      const result = await api<Checklist>('/api/checklists', { name: name.trim(), criteria });
      onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить чек-лист.'); }
    finally { setBusy(false); }
  }
  if (!checklist) return <div className="panel quiet-loading"><Spinner text="Загружаем чек-лист…" /></div>;
  return <div className="page-stack">
    <div className="page-heading">
      <div><div className="eyebrow">Единый стандарт оценки</div><h1>Чек-лист качества</h1><p>Точные правила, прозрачные веса и история версий.</p></div>
      <div className="heading-actions">
        <select aria-label="Версия чек-листа" value={checklist.id} onChange={(event) => onSelect(event.target.value)} className="field compact-field">
          {[...all].sort((a, b) => b.version - a.version).map((item) => <option key={item.id} value={item.id}>Версия {item.version} · {item.name}</option>)}
        </select>
        <button className="button primary" onClick={save} disabled={busy || !changed}>{busy ? <Spinner /> : <Save size={16} />}Сохранить версию</button>
      </div>
    </div>
    <div className="checklist-summary panel">
      <div className="summary-icon"><ListChecks size={25} /></div>
      <div className="checklist-name">
        <label htmlFor="checklist-name">Название чек-листа</label>
        <input id="checklist-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={150} className="title-input" />
        <span className="muted small">Версия {checklist.version} · {shortDate(checklist.createdAt)}</span>
      </div>
      <div className="checklist-stat"><strong>{criteria.length}</strong><span>критериев</span></div>
      <div className="checklist-stat"><strong>{weight}</strong><span>сумма весов</span></div>
      <Pill tone={changed ? 'amber' : 'green'} dot>{changed ? 'Есть изменения' : 'Версия сохранена'}</Pill>
    </div>
    <div className="notice notice-soft"><ShieldCheck size={18} /><span>Сохранение создаёт новую версию. Уже выполненные оценки сохраняют свои правила. При N/A применимые веса пересчитываются до 100 баллов.</span></div>
    <div className={'notice ' + (submissionIssues.length ? 'notice-warning' : 'notice-soft')} role="status"><ShieldCheck size={18} /><div><strong>{submissionIssues.length ? (changed ? 'Этот черновик несовместим с форматом сдачи' : 'Выбранная версия несовместима с форматом сдачи') : 'Конфигурация совместима с JSON 1.0'}</strong><p>Для сдачи нужны 8 критериев с фиксированными кодами, весами, шкалами и условиями доступности N/A. Правильность оценок проверяется отдельно.</p>{submissionIssues.length > 0 && <ul>{submissionIssues.slice(0, 4).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}</div></div>
    <section className="panel template-panel">
      <div className="template-heading"><div><span className="eyebrow">Правила организаторов · уточнения {CHECKLIST_TEMPLATE_REVISION}</span><h2>Меньше неоднозначных оценок</h2><p>Шаблон сохраняет 8 критериев, исходные веса и ступени. Пояснения помогают одинаково трактовать спорные случаи.</p></div><button className="button secondary" disabled={busy || changed} onClick={applyTemplate}><ListChecks size={16} />Применить шаблон</button></div>
      <details className="template-changes"><summary>Что уточнено в правилах<ChevronDown size={15} /></summary><ul>{CHECKLIST_TEMPLATE_CHANGES.map((change) => <li key={change}>{change}</li>)}</ul></details>
      {fromTemplate ? <p className="template-hint">Шаблон открыт в черновике. Проверьте правила ниже и сохраните новую версию.</p> : changed ? <p className="template-hint">Чтобы применить шаблон, сначала сохраните или сбросьте текущие правки.</p> : <p className="template-hint">Применение открывает черновик. Сохранённые версии и оценки остаются в истории.</p>}
    </section>
    {changed && issues.length > 0 && <div className="notice notice-warning" role="status"><span><strong>Проверьте конфигурацию перед сохранением</strong><ul>{issues.slice(0, 5).map((issue) => <li key={issue}>{issue}</li>)}</ul></span></div>}
    {error && <div role="alert" className="notice notice-error">{error}</div>}
    <div className="editor-list">
      {criteria.map((criterion, index) => <details key={criterion.id} className="criterion-editor panel" open={openCriteria.has(criterion.id)} onToggle={(event) => {
        if (event.target === event.currentTarget) setCriterionOpen(criterion.id, event.currentTarget.open);
      }}>
        <summary>
          <span className="criterion-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="editor-summary-name"><strong>{criterion.name || 'Новый критерий'}</strong><small>{criterion.section}</small></span>
          <span className="editor-type">{criterion.kind === 'scale' ? 'Шкала' : criterion.kind === 'flag' ? 'Флаг нарушения' : 'Да / Нет'}{criterion.allowNA ? ' / N/A' : ''}</span>
          <span className="weight-tag">{criterion.kind === 'flag' ? 'Без баллов' : 'Вес ' + criterion.weight}</span>
          <ChevronDown size={17} className="details-chevron" />
        </summary>
        <div className="criterion-editor-body">
          <div className="form-grid">
            <label className="form-field span-two">Название<input className="field" value={criterion.name} onChange={(event) => update(criterion.id, { name: event.target.value })} maxLength={180} placeholder="Что проверяем в работе оператора?" /></label>
            <label className="form-field">Секция<input className="field" value={criterion.section} onChange={(event) => update(criterion.id, { section: event.target.value })} maxLength={150} /></label>
            <label className="form-field">Тип ответа<select className="field" value={criterion.kind} onChange={(event) => {
              const kind = event.target.value as Criterion['kind'];
              update(criterion.id, {
                kind, weight: kind === 'flag' ? 0 : criterion.weight || 10,
                levels: kind === 'scale'
                  ? (criterion.levels.length ? criterion.levels : [{ value: 0, label: 'Условие не выполнено' }, { value: 10, label: 'Условие выполнено полностью' }])
                  : [],
                allowNA: kind === 'flag' ? false : criterion.allowNA,
              });
            }}><option value="boolean">Да / Нет</option><option value="scale">Числовая шкала</option><option value="flag">Флаг нарушения</option></select></label>
            <label className="form-field">Вес критерия<input type="number" className="field" min={0} max={1000} step="any" value={criterion.weight} disabled={criterion.kind === 'flag'} onChange={(event) => update(criterion.id, { weight: Number(event.target.value) })} /></label>
            <label className="form-field span-two">Правило оценки<textarea className="field" rows={3} value={criterion.description} onChange={(event) => update(criterion.id, { description: event.target.value })} placeholder="Опишите условия для каждого ответа." /></label>
          </div>
          {criterion.kind === 'scale' && <div className="scale-editor">
            <div className="section-line"><h3>Ступени шкалы</h3><span className="muted small">Максимальная ступень даёт полный вес</span></div>
            {criterion.levels.map((level, levelIndex) => <div className="scale-row" key={levelIndex}>
              <input className="field" aria-label={'Балл ступени ' + (levelIndex + 1)} type="number" min={0} step="any" value={level.value} onChange={(event) => update(criterion.id, {
                levels: criterion.levels.map((current, i) => i === levelIndex ? { ...current, value: Number(event.target.value) } : current),
              })} />
              <input className="field" aria-label={'Описание ступени ' + (levelIndex + 1)} value={level.label} placeholder="Когда выставляется эта оценка" onChange={(event) => update(criterion.id, {
                levels: criterion.levels.map((current, i) => i === levelIndex ? { ...current, label: event.target.value } : current),
              })} />
              <button className="icon-button" aria-label="Удалить ступень" onClick={() => update(criterion.id, { levels: criterion.levels.filter((_, i) => i !== levelIndex) })}><Trash2 size={15} /></button>
            </div>)}
            <button className="button text-button small-button" onClick={() => update(criterion.id, { levels: [...criterion.levels, { value: Math.max(0, ...criterion.levels.map((level) => level.value)) + 5, label: '' }] })}><Plus size={15} />Добавить ступень</button>
          </div>}
          {criterion.kind !== 'flag' && <div className="na-editor">
            <label className="checkbox-label"><input type="checkbox" checked={criterion.allowNA} onChange={(event) => update(criterion.id, { allowNA: event.target.checked })} /><strong>Разрешить N/A</strong><span className="muted">Критерий может быть неприменим</span></label>
            {criterion.allowNA && <label className="form-field">Условие неприменимости<textarea className="field" rows={2} value={criterion.naCondition} onChange={(event) => update(criterion.id, { naCondition: event.target.value })} placeholder="Укажите точное условие для ответа N/A." /></label>}
          </div>}
          <div className="editor-footer"><span className="muted small">ID: {criterion.id}{SUBMISSION_CRITERIA.find((item) => item.internalId === criterion.id) && <> · Код в results.json: <code>{SUBMISSION_CRITERIA.find((item) => item.internalId === criterion.id)?.id}</code></>}</span><button className="button danger-text small-button" onClick={() => removeCriterion(criterion.id)}><Trash2 size={14} />Удалить критерий</button></div>
        </div>
      </details>)}
    </div>
    <button className="add-criterion" onClick={addCriterion}><Plus size={20} /><span>Добавить критерий</span><ArrowRight size={17} /></button>
    <div className="editor-savebar">
        <p><strong>{criteria.length} критериев</strong> · веса нормируются до 100 баллов</p>
      <div className="heading-actions"><button className="button secondary" disabled={!changed || busy} onClick={resetDraft}><RotateCcw size={15} />Сбросить правки</button><button className="button primary" disabled={busy || !changed} onClick={save}>{busy ? <Spinner /> : <Save size={16} />}Сохранить новую версию</button></div>
    </div>
  </div>;
}
