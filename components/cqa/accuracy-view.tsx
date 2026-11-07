'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Target, Download, ArrowUpRight, CheckCheck, ListChecks, AlertCircle, Search, Info, UserRoundCheck } from 'lucide-react';
import type { AppState } from '@/lib/types';
import { buildCalibrationReport } from '@/lib/calibration';
import { EmptyState, Pill, csvCell, downloadFile, ratingLabel, scoreText, shortDate } from './shared';

export function AccuracyView({ state, referenceIds, model, revision, onModelChange, onRevisionChange, onReferencesChange, onOpenConversation, onDialogs }: {
  state: AppState; referenceIds: string[]; onReferencesChange: (ids: string[]) => void;
  model: string; revision: string; onModelChange: (value: string) => void; onRevisionChange: (value: string) => void;
  onOpenConversation: (id: string, evaluationId?: string, showOriginal?: boolean) => void; onDialogs: () => void;
}) {
  const [search, setSearch] = useState('');
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const conversations = useMemo(() => new Map(state.conversations.map((item) => [item.id, item])), [state.conversations]);
  const experts = useMemo(() => state.evaluations.filter((item) => item.source === 'manual')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.evaluations]);
  const models = [...new Set(state.evaluations.filter((item) => item.source === 'ai').map((item) => item.model))].sort();
  const revisions = [...new Set(state.evaluations.filter((item) => item.source === 'ai').map((item) => item.runConfig?.promptRevision || 'legacy'))].sort();
  const selected = new Set(referenceIds);
  const visibleExperts = experts.filter((item) => {
    const conversation = conversations.get(item.conversationId);
    return !search.trim() || (conversation?.conversation_id + ' ' + conversation?.dataset_group_id + ' ' + item.checklist.name)
      .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const report = useMemo(() => buildCalibrationReport(
    state.evaluations.filter((item) => item.source !== 'ai' || !revision || (item.runConfig?.promptRevision || 'legacy') === revision),
    { referenceIds, ...(model ? { model } : {}) },
  ), [state.evaluations, referenceIds, model, revision]);
  const pairs = report.pairs.filter((pair) => !onlyDifferences || pair.exactMatches !== pair.totalComparable);
  const percent = (value: number | null) => value === null ? '—' : scoreText(value) + '%';
  const displayId = (id: string) => conversations.get(id)?.conversation_id || id;

  function toggle(id: string) {
    onReferencesChange(selected.has(id) ? referenceIds.filter((item) => item !== id) : [...referenceIds, id]);
  }
  function exportReport(format: 'json' | 'csv') {
    const context = { purpose: 'Internal comparison with explicitly selected expert references; not organizer Ground Truth.',
      exportedAt: new Date().toISOString(), model: model || null, promptRevision: revision || null, referenceIds };
    if (format === 'json') {
      downloadFile('cqa-accuracy.json', JSON.stringify({ ...context, ...report }, null, 2), 'application/json;charset=utf-8');
      return;
    }
    const rows: unknown[][] = [['Диалог', 'AI запуск', 'Экспертный запуск', 'Версия чек-листа', 'Критерий', 'AI до апелляций', 'Эксперт', 'Расхождение N/A', 'Расхождение флага']];
    report.differences.forEach((item) => rows.push([displayId(item.conversationId), item.aiId, item.referenceId, item.checklistVersion, item.name,
      ratingLabel(item.aiValue), ratingLabel(item.referenceValue), item.naMismatch ? 'Да' : 'Нет', item.criticalFlagMismatch ? 'Да' : 'Нет']));
    downloadFile('cqa-disagreements.csv', '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  return <div className="page-stack accuracy-page">
    <div className="page-heading"><div><div className="eyebrow">Измеряйте, чтобы улучшать</div><h1>Точность AI</h1><p>Найдите расхождения с экспертной разметкой и проверьте причины по диалогам.</p></div>
      <div className="heading-actions"><button className="button secondary" disabled={!report.pairCount} onClick={() => exportReport('csv')}><Download size={15} />Расхождения CSV</button><button className="button primary" disabled={!report.pairCount} onClick={() => exportReport('json')}><Download size={15} />Отчёт JSON</button></div>
    </div>

    <section className="panel accuracy-protocol">
      <span className="accuracy-protocol-icon"><Target size={25} /></span>
      <div><h2>Сравнение на одинаковых условиях</h2><p>Выберите проверенные экспертные оценки как рабочие эталоны. Система сопоставит их с исходным ответом AI для той же версии чек-листа и того же транскрипта.</p>
        <div className="protocol-tags"><span><CheckCheck size={13} />AI до апелляций</span><span><ListChecks size={13} />Одинаковые правила</span><span><UserRoundCheck size={13} />Явно выбранный эксперт</span></div>
      </div>
    </section>

    <section className="panel reference-panel">
      <div className="panel-heading"><div><h2>1. Выберите экспертные эталоны</h2><p>Одна экспертная оценка на диалог и версию правил. Ручные результаты становятся эталонами только после вашего выбора.</p></div><Pill tone={referenceIds.length ? 'green' : 'neutral'}>{referenceIds.length} выбрано</Pill></div>
      {!experts.length ? <EmptyState icon={<UserRoundCheck size={28} />} title="Проверочная разметка пока не добавлена" description="Откройте диалог и сохраните оценку эксперта. Затем выберите её здесь для сравнения с AI." action={<button className="button secondary" onClick={onDialogs}>К диалогам<ArrowUpRight size={15} /></button>} /> : <>
        <div className="reference-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Поиск экспертных эталонов" placeholder="Диалог, набор или чек-лист" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="button text-button small-button" disabled={!selected.size} onClick={() => onReferencesChange([])}>Снять выбор</button></div>
        <div className="table-scroll reference-scroll"><table className="data-table reference-table"><thead><tr><th>Эталон</th><th>Диалог</th><th>Правила</th><th>Экспертный балл</th><th>Разметка</th></tr></thead>
          <tbody>{visibleExperts.map((item) => <tr key={item.id} className={selected.has(item.id) ? 'selected-row' : ''}>
            <td><input type="checkbox" aria-label={'Выбрать эталон ' + displayId(item.conversationId) + ' v' + item.checklist.version + ' ' + item.id} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td>
            <td><button className="plain-table-link" onClick={() => onOpenConversation(item.conversationId, item.id)}>{displayId(item.conversationId)}<ArrowUpRight size={13} /></button><small className="table-subtext">{conversations.get(item.conversationId)?.dataset_group_id} · {conversations.get(item.conversationId)?.language}</small></td>
            <td><span className="table-rule-name">{item.checklist.name}</span><small className="table-subtext">Версия {item.checklist.version}</small></td><td><strong>{scoreText(item.score.total)}</strong></td><td>{shortDate(item.updatedAt)}<small className="table-subtext">Оценка эксперта</small></td>
          </tr>)}</tbody></table></div>
        {!visibleExperts.length && <p className="panel-inline-empty">По этому запросу нет экспертных оценок.</p>}
      </>}
    </section>

    <div className="accuracy-controls"><h2>2. Сопоставьте с AI</h2><div className="heading-actions"><label className="compact-label">Модель<select className="field compact-field" value={model} onChange={(event) => onModelChange(event.target.value)}><option value="">Все модели · последний запуск</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="compact-label">Редакция оценки<select className="field compact-field" value={revision} onChange={(event) => onRevisionChange(event.target.value)}><option value="">Все редакции</option>{revisions.map((item) => <option key={item} value={item}>{item === 'legacy' ? 'Ранние запуски без метаданных' : item}</option>)}</select></label></div></div>

    <div className="stat-grid accuracy-stats">
      <Metric label="Пар для сравнения" value={String(report.pairCount)} caption={'Диалогов: ' + new Set(report.pairs.map((pair) => pair.conversationId)).size + ' · эталонов: ' + report.selectedReferenceCount} icon={<ListChecks size={18} />} />
      <Metric label="Совпадение критериев" value={percent(report.agreementPercent)} caption={report.totalComparable ? report.exactMatches + ' из ' + report.totalComparable + ' · включая N/A' : 'Нужны сопоставимые оценки'} icon={<CheckCheck size={18} />} />
      <Metric label="Средняя ошибка итога" value={scoreText(report.totalMae)} caption={report.totalScorePairs ? 'MAE · баллы из 100 · ниже лучше' : 'Нужны пары с числовым итогом'} icon={<Target size={18} />} />
      <Metric label="Расхождения N/A" value={report.pairCount ? String(report.naMismatches) : '—'} caption={report.pairCount ? report.criticalFlagMismatches + ' расхождений по флагам нарушений' : 'Появятся после сравнения'} icon={<AlertCircle size={18} />} />
    </div>

    {!!report.unmatched.length && <div className="notice notice-warning calibration-unmatched"><AlertCircle size={18} /><div><strong>Не все выбранные оценки можно сравнить</strong>{report.unmatched.map((item) => <p key={item.referenceId}>{item.conversationId ? displayId(item.conversationId) + ': ' : ''}{item.message}</p>)}</div></div>}
    {!report.pairCount ? <section className="panel"><EmptyState icon={<Target size={30} />} title={referenceIds.length ? 'Пока нет сопоставимых AI-результатов' : 'Выберите эталоны, чтобы увидеть метрики'} description={referenceIds.length ? 'Для выбранных диалогов нужен AI-запуск с тем же транскриптом и версией чек-листа. Проверьте модель и фильтр редакции.' : 'Без пар AI и эксперта показатели не рассчитываются. Здесь появятся реальные совпадения и расхождения.'} /></section> : <>
      <section className="panel"><div className="panel-heading"><div><h2>Где расходятся оценки</h2><p>Каждый критерий считается отдельно для своей версии правил.</p></div><Pill>{report.differences.length} расхождений</Pill></div>
        <div className="table-scroll"><table className="data-table calibration-table"><thead><tr><th>Критерий</th><th>Совпадение</th><th>N/A</th><th>Флаг нарушения</th></tr></thead><tbody>{report.breakdown.map((item) => <tr key={item.key}><td><strong>{item.name}</strong><small className="table-subtext">Чек-лист v{item.checklistVersion} · {item.checklistName}</small></td><td><div className="agreement-cell"><span>{percent(item.agreementPercent)}</span><div className="agreement-bar"><i style={{ width: (item.agreementPercent ?? 0) + '%' }} /></div><small>{item.exactMatches} / {item.totalComparable}</small></div></td><td>{item.naMismatches || '—'}</td><td>{item.criticalFlagMismatches || '—'}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Сопоставленные диалоги</h2><p>Откройте исходный AI-запуск, чтобы проверить конкретные реплики.</p></div><label className="checkbox-label"><input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />Только расхождения</label></div>
        <div className="comparison-list">{pairs.map((pair) => {
          const differences = report.differences.filter((item) => item.aiId === pair.aiId && item.referenceId === pair.referenceId);
          return <article className="comparison-item" key={pair.referenceId}><div className="comparison-top"><div><button className="plain-table-link" onClick={() => onOpenConversation(pair.conversationId, pair.aiId, true)}>{displayId(pair.conversationId)}<ArrowUpRight size={14} /></button><small>{pair.model} · чек-лист v{pair.checklistVersion} · {shortDate(pair.aiCreatedAt)}</small></div><div className="comparison-scores"><span>AI<strong>{scoreText(pair.aiScore)}</strong></span><span>Эксперт<strong>{scoreText(pair.referenceScore)}</strong></span><span>Ошибка<strong>{scoreText(pair.absoluteError)}</strong></span></div></div>
            {!!differences.length && <div className="difference-list">{differences.map((item) => <div key={item.criterionId}><span>{item.name}</span><Pill tone="amber">AI: {ratingLabel(item.aiValue)}</Pill><Pill tone="blue">Эксперт: {ratingLabel(item.referenceValue)}</Pill></div>)}</div>}
            {!differences.length && <p className="all-agree"><CheckCheck size={14} />Все критерии совпали</p>}
          </article>;
        })}</div>
        {!pairs.length && <p className="panel-inline-empty">В выбранных парах все критерии совпали.</p>}
      </section>
    </>}
    <div className="notice notice-soft"><Info size={18} /><span>Это внутренняя проверка на выбранной вами разметке. Ground Truth организаторов и их итоговый отбор оцениваются отдельно. При малом числе диалогов метрики могут заметно меняться.</span></div>
  </div>;
}

function Metric({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: ReactNode }) {
  return <div className="panel stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><span className="stat-caption">{caption}</span></div>;
}
