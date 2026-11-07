'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, UserRoundPen, Headphones, ShieldAlert, Scale, MessageSquare, ClipboardCheck, Clock3, ArrowDown, Quote, History, CheckCircle2, AlertCircle, Info, Download } from 'lucide-react';
import type { AppState, Conversation, Criterion, Evaluation } from '@/lib/types';
import { SUBMISSION_CRITERIA } from '@/lib/submission';
import { Channel, EmptyState, ExternalLink, Pill, Spinner, downloadFile, ratingLabel, ratingTone, scoreText, shortDate, speakerLabels } from './shared';
import { ManualEvaluation } from './manual-evaluation';
import { AppealForm } from './appeals';

export function DialogueDetail({ conversation, state, checklistId, initialEvaluationId = '', initialShowOriginal = false, onChecklistChange, onBack, onEvaluate, evaluating, onRefresh, onSettings, onEvaluationSaved }: {
  conversation: Conversation; state: AppState; checklistId: string; onChecklistChange: (id: string) => void;
  onBack: () => void; onEvaluate: (conversationId: string) => Promise<Evaluation | null>; evaluating: boolean;
  onRefresh: () => void; onSettings: () => void; onEvaluationSaved: (evaluation: Evaluation) => void;
  initialEvaluationId?: string;
  initialShowOriginal?: boolean;
}) {
  const [highlight, setHighlight] = useState<string[]>([]);
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [appealCriterion, setAppealCriterion] = useState<Criterion | null>(null);
  const [historyId, setHistoryId] = useState(initialEvaluationId);
  const [showOriginal, setShowOriginal] = useState(initialShowOriginal);
  const [activeTab, setActiveTab] = useState<'results' | 'history'>('results');
  const [criterionFilter, setCriterionFilter] = useState<'all' | 'review' | 'revised'>('all');
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const evidenceOriginRef = useRef<HTMLButtonElement | null>(null);
  const evaluationPanelRef = useRef<HTMLElement | null>(null);
  const history = useMemo(() => state.evaluations.filter((evaluation) => evaluation.conversationId === conversation.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.evaluations, conversation.id]);
  const storedEvaluation = history.find((item) => item.id === historyId) || history[0];
  const showingOriginal = showOriginal && storedEvaluation?.source === 'ai';
  const evaluation = showingOriginal
    ? { ...storedEvaluation, results: storedEvaluation.initialResults, score: storedEvaluation.initialScore }
    : storedEvaluation;
  const selectedChecklist = state.checklists.find((item) => item.id === checklistId) || state.checklists.find((item) => item.id === state.activeChecklistId) || state.checklists[0];
  const conversationAppeals = state.appeals.filter((appeal) => appeal.conversationId === conversation.id);
  const failures = (state.evaluationFailures || []).filter((item) => item.conversationId === conversation.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lastAi = history.find((item) => item.source === 'ai');
  const lastFailure = failures[0] && (!lastAi || failures[0].createdAt >= lastAi.createdAt) ? failures[0] : undefined;
  const turnByMessageId = new Map(conversation.transcript.map((message, index) => [message.id, index + 1]));
  useEffect(() => { setHighlight([]); setEvidenceTarget(null); evidenceOriginRef.current = null; setHistoryId(initialEvaluationId); setShowOriginal(initialShowOriginal); setActiveTab('results'); setCriterionFilter('all'); setAppealCriterion(null); }, [conversation.id, initialEvaluationId, initialShowOriginal]);
  function clearEvidence() {
    setHighlight([]); setEvidenceTarget(null); evidenceOriginRef.current = null;
  }
  function selectMode(original: boolean) {
    setShowOriginal(original); setCriterionFilter('all'); clearEvidence(); setAppealCriterion(null);
  }
  function selectResult(id: string) {
    setHistoryId(id); setActiveTab('results'); selectMode(false);
  }
  function focusAndReveal(target: HTMLElement) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }
  function jump(ids: string[], origin: HTMLButtonElement) {
    const target = messageRefs.current[ids[0]];
    if (!target) return;
    evidenceOriginRef.current = origin;
    setHighlight(ids);
    setEvidenceTarget(ids[0]);
    focusAndReveal(target);
  }
  function jumpRange(start: string, end: string, origin: HTMLButtonElement) {
    const first = conversation.transcript.findIndex((message) => message.id === start);
    const last = conversation.transcript.findIndex((message) => message.id === end);
    jump(conversation.transcript.slice(Math.max(0, first), last + 1).map((message) => message.id), origin);
  }
  function returnToEvaluation() {
    const origin = evidenceOriginRef.current;
    const target = origin?.isConnected ? origin : evaluationPanelRef.current;
    if (target) focusAndReveal(target);
    setEvidenceTarget(null);
    evidenceOriginRef.current = null;
  }
  async function evaluate() {
    const result = await onEvaluate(conversation.id);
    if (result) selectResult(result.id);
  }
  const sameScores = evaluation && evaluation.score.total === evaluation.initialScore.total;
  const reviewCount = evaluation?.results.filter((result) => result.needsReview).length || 0;
  const revisedCount = evaluation?.results.filter((result) => evaluation.initialResults.find((item) => item.criterionId === result.criterionId)?.value !== result.value).length || 0;
  return <div className="page-stack dialogue-detail">
    <div className="detail-breadcrumb"><button onClick={onBack}><ArrowLeft size={15} />Все диалоги</button><span>/</span><span>{conversation.conversation_id}</span></div>
    <div className="detail-heading">
      <div><div className="detail-title-line"><h1>{conversation.conversation_id}</h1><Pill tone="blue">{conversation.language}</Pill><Pill>{conversation.dataset_group_id}</Pill></div><div className="detail-meta"><Channel conversation={conversation} /><span>Реплик: {conversation.transcript.length}</span><span>Загружен {shortDate(conversation.importedAt)}</span></div></div>
      <div className="heading-actions">
        <button className="button secondary" onClick={() => setManual(true)} disabled={!selectedChecklist || evaluating}><UserRoundPen size={16} />Оценка эксперта</button>
        <button className="button primary" onClick={evaluate} disabled={evaluating || !selectedChecklist}>{evaluating ? <Spinner /> : <Sparkles size={16} />}{evaluating ? 'Оцениваем…' : evaluation ? 'Оценить заново' : 'Оценить диалог'}</button>
      </div>
    </div>
    <div className="detail-checklist-row"><ClipboardCheck size={16} /><label htmlFor="detail-checklist">Чек-лист для нового запуска</label><select id="detail-checklist" className="field compact-field" value={checklistId} onChange={(event) => onChecklistChange(event.target.value)}>{[...state.checklists].sort((a, b) => b.version - a.version).map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select>{selectedChecklist && <span className="muted small">{selectedChecklist.criteria.length} критериев</span>}</div>
    {lastFailure && <div className="notice notice-warning" role="status"><AlertCircle size={18} /><div><strong>Последняя попытка AI завершилась ошибкой</strong><p>{lastFailure.error}</p><small>В формате сдачи такой диалог получает status = "error", пустые критерии и score = null. После успешной повторной оценки будет выбран новый результат.</small></div></div>}
    <div className="dialogue-columns">
      <section className="panel transcript-panel">
        <div className="panel-heading"><div className="heading-with-icon"><MessageSquare size={18} /><h2>Разговор</h2></div><span className="muted small">{conversation.language === 'KZ' ? 'Қазақша' : conversation.language === 'EN' ? 'English' : 'Русский'}</span></div>
        {conversation.channel === 'voice call' && <div className="audio-panel"><span className="audio-symbol"><Headphones size={22} /></span><div><strong>Запись разговора</strong><p>Сверьте спорный фрагмент с оригиналом.</p>{conversation.audio_url ? <ExternalLink href={conversation.audio_url}>Открыть запись</ExternalLink> : <span className="muted small">Ссылка на запись не предоставлена</span>}</div></div>}
        <div className="transcript-scroll">
          <div className="transcript-start"><span />Начало разговора<span /></div>
          {conversation.transcript.map((message, index) => {
            const system = message.speaker === 'system';
            const bot = message.speaker === 'bot';
            return <article key={message.id} id={'msg-' + message.id} tabIndex={-1} aria-label={'Реплика ' + (index + 1) + ' · ' + speakerLabels[message.speaker] + ' · ' + message.timestamp} ref={(element) => { messageRefs.current[message.id] = element; }} className={'message message-' + message.speaker + (highlight.includes(message.id) ? ' message-highlight' : '')}>
              {system ? <div className="system-message"><span className="turn-number">#{index + 1}</span><Info size={12} /><span>{message.text}</span><time title={message.timestamp}>{message.timestamp}</time></div> : <>
                <div className="message-heading"><span className={'speaker-avatar ' + (message.speaker === 'operator' ? 'operator-avatar' : '')}>{message.speaker === 'operator' ? 'О' : bot ? 'Б' : 'К'}</span><strong>{speakerLabels[message.speaker]}</strong><span className="turn-number">#{index + 1}</span><time title={message.timestamp}>{message.timestamp}</time></div>
                <p>{message.text}</p>
              </>}
              {highlight.includes(message.id) && <span className="evidence-label"><Quote size={11} />Доказательство</span>}
              {evidenceTarget === message.id && <button type="button" className="evidence-return" onClick={returnToEvaluation}>К оценке<ArrowRight size={13} /></button>}
            </article>;
          })}
          <div className="transcript-start"><span />Конец предоставленного транскрипта<span /></div>
        </div>
        <div className="transcript-footnote"><Info size={13} />Номера с 1 по исходному массиву, включая клиента, бота и события. Эти номера используются в evidence_turns.</div>
      </section>
      <section className="panel evaluation-panel" ref={evaluationPanelRef} tabIndex={-1} aria-label="Оценка диалога">
        <div className="panel-heading evaluation-panel-heading"><div className="simple-tabs"><button onClick={() => setActiveTab('results')} className={activeTab === 'results' ? 'active' : ''}>Результат</button><button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'active' : ''}>История<span>{history.length}</span></button></div>{storedEvaluation && <button className="icon-button" aria-label="Скачать архив этой оценки в JSON" title="Для официального results.json откройте раздел «Сдача результатов»" onClick={() => downloadFile(conversation.conversation_id + '-evaluation.json', JSON.stringify(storedEvaluation, null, 2), 'application/json;charset=utf-8')}><Download size={16} /></button>}</div>
        {activeTab === 'history' ? <div className="evaluation-body">
          {!history.length ? <EmptyState icon={<History size={28} />} title="История пока пуста" description="Каждый запуск оценки будет сохранён вместе с версией чек-листа и исходным результатом." /> : <div className="history-list">{history.map((item) => <button key={item.id} className={'history-item ' + (item.id === evaluation?.id ? 'selected' : '')} onClick={() => selectResult(item.id)}><span className="history-icon">{item.source === 'ai' ? <Sparkles size={18} /> : <UserRoundPen size={18} />}</span><span><strong>{item.source === 'ai' ? 'AI-оценка' : 'Оценка эксперта'}</strong><small>v{item.checklist.version} · {shortDate(item.createdAt)}</small>{item.model && <small>{item.model}</small>}</span><span className="history-score">{scoreText(item.score.total)}<small>/ 100</small></span><ArrowRight size={16} /></button>)}</div>}
          {failures.length > 0 && <><h3 className="subsection-title">Неуспешные попытки AI</h3>{failures.map((failure) => <div className="history-appeal" key={failure.id}><AlertCircle size={17} /><div><strong>{failure.model || 'Модель не настроена'}</strong><p>{failure.error}</p><small>{shortDate(failure.createdAt)} · {failure.code} · без балла</small></div></div>)}</>}
          {conversationAppeals.length > 0 && <><h3 className="subsection-title">Пересмотр оценок</h3>{conversationAppeals.map((appeal) => <div className="history-appeal" key={appeal.id}><Scale size={17} /><div><strong>{state.evaluations.find((item) => item.id === appeal.evaluationId)?.checklist.criteria.find((item) => item.id === appeal.criterionId)?.name || appeal.criterionId}</strong><p>{appeal.comment}</p>{appeal.decisionReason && <p className="decision-copy">{appeal.decisionReason}</p>}<small>{ratingLabel(appeal.originalValue)}{appeal.status === 'changed' ? ' → ' + ratingLabel(appeal.finalValue) : ''} · {appeal.status === 'pending' ? 'На рассмотрении' : appeal.status === 'confirmed' ? 'Подтверждено' : 'Изменено'} · {shortDate(appeal.createdAt)}</small></div></div>)}</>}
        </div> : evaluating ? <div className="evaluating-state"><div className="evaluating-orbit"><Sparkles size={30} /></div><h3>Проверяем каждый критерий</h3><p>Модель читает диалог, выбирает оценки и связывает выводы с репликами.</p><div className="loading-line" /><span className="muted small">Результат появится после проверки ответа.</span></div> : !evaluation ? <div className="evaluation-body">
          <EmptyState icon={<ClipboardCheck size={32} />} title="Разговор готов к оценке" description="Запустите AI-анализ по выбранному чек-листу. Здесь появятся баллы, обоснования и переходы к доказательствам." action={<button className="button primary" onClick={evaluate}><Sparkles size={16} />Оценить диалог</button>} />
          {!state.providerConfigured && <div className="inline-setup"><span><strong>Подключение модели</strong><small>Укажите модель и API-ключ в настройках.</small></span><button className="button text-button small-button" onClick={onSettings}>Настроить<ArrowRight size={15} /></button></div>}
          <div className="evaluation-guide"><h3>Как читается результат</h3><div><span>01</span><p><strong>Оценка по правилу</strong><small>Только разрешённые значения чек-листа</small></p></div><div><span>02</span><p><strong>Проверяемое обоснование</strong><small>Нажмите на цитату — откроется нужная реплика</small></p></div><div><span>03</span><p><strong>Прозрачный пересчёт</strong><small>N/A исключается, веса приводятся к 100</small></p></div></div>
        </div> : <div className="evaluation-body">
          {evaluation.source === 'ai' && <div className="simple-tabs" aria-label="Версия результата"><button className={!showingOriginal ? 'active' : ''} aria-pressed={!showingOriginal} onClick={() => selectMode(false)}>Текущий результат</button><button className={showingOriginal ? 'active' : ''} aria-pressed={showingOriginal} onClick={() => selectMode(true)}>Исходный AI</button></div>}
          {showingOriginal && <div className="notice notice-soft"><Info size={18} /><div><strong>Исходный ответ AI до апелляций</strong><p>Показаны первоначальные оценки, обоснования и доказательства. Они используются для сравнения с эталоном и официальной сдачи. Для апелляции откройте текущий результат.</p><button className="button text-button small-button" onClick={() => selectMode(false)}>К текущему результату для пересмотра<ArrowRight size={14} /></button></div></div>}
          <div className="score-summary">
            <div className="score-ring"><svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="47" className="ring-track" /><circle cx="55" cy="55" r="47" className="ring-value" strokeDasharray={String((evaluation.score.total ?? 0) / 100 * 295.31) + ' 295.31'} /></svg><div><strong>{scoreText(evaluation.score.total)}</strong><span>из 100</span></div></div>
            <div className="score-copy"><div className="eyebrow">{showingOriginal ? 'Исходная оценка' : 'Итоговая оценка'}</div><h2>{evaluation.source === 'ai' ? reviewCount ? 'Нужна экспертная проверка' : 'Анализ завершён' : 'Оценка эксперта'}</h2><p>{evaluation.checklist.name} · v{evaluation.checklist.version}</p><div className="score-badges"><Pill tone={evaluation.source === 'ai' ? 'green' : 'blue'}>{evaluation.source === 'ai' ? 'AI' : 'Эксперт'}</Pill>{evaluation.score.critical ? <Pill tone="danger"><ShieldAlert size={12} />Грубая ошибка</Pill> : <Pill tone="neutral">Грубых ошибок нет</Pill>}</div></div>
          </div>
          {reviewCount > 0 && <div className="review-result-banner"><AlertCircle size={18} /><div><strong>Проверьте {reviewCount} критериев</strong><p>В выводах есть неопределённость или расхождение независимых проверок. Причина указана в обосновании и предупреждениях.</p></div><button className="button secondary small-button" onClick={() => setCriterionFilter('review')}>Показать</button></div>}
          {!sameScores && <div className="score-revision"><Scale size={16} /><span>После пересмотра</span><span>{scoreText(evaluation.initialScore.total)}<ArrowRight size={14} /><strong>{scoreText(evaluation.score.total)}</strong></span></div>}
          {evaluation.score.total === null && <div className="notice notice-soft">Нет применимых критериев с весом. Итог не рассчитывается.</div>}
          {evaluation.warnings.length > 0 && <div className="evaluation-warnings"><AlertCircle size={16} /><div>{evaluation.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
          <div className="evaluation-metadata"><span><Clock3 size={12} />{shortDate(evaluation.createdAt)}</span>{evaluation.model && <span>{evaluation.model}</span>}{evaluation.usage.calls > 0 && <span>{evaluation.usage.calls} выз. · {(evaluation.usage.inputTokens + evaluation.usage.outputTokens).toLocaleString('ru-RU')} ток.</span>}{evaluation.usage.costUsd !== null && <span>≈ {'$'}{evaluation.usage.costUsd.toFixed(5)}</span>}</div>
          {evaluation.source === 'ai' && evaluation.runConfig && <details className="run-config"><summary>Параметры этого запуска<Info size={13} /></summary><dl><div><dt>Режим модели</dt><dd>{evaluation.runConfig.modelMode || 'Не сохранён в раннем запуске'}</dd></div><div><dt>Редакция AI</dt><dd>{evaluation.runConfig.promptRevision}</dd></div><div><dt>Независимая проверка</dt><dd>{evaluation.runConfig.verification ? 'Включена' : 'Выключена'}</dd></div><div><dt>Строгая структура ответа</dt><dd>{evaluation.runConfig.strictJson ? 'Включена' : 'Выключена'}</dd></div><div><dt>Отпечаток базы знаний</dt><dd title={evaluation.runConfig.knowledgeHash}>{evaluation.runConfig.knowledgeHash.slice(0, 16)}</dd></div></dl></details>}
          <div className="result-filterbar" aria-label="Фильтр критериев"><button className={criterionFilter === 'all' ? 'active' : ''} onClick={() => setCriterionFilter('all')}>Все <span>{evaluation.results.length}</span></button><button className={criterionFilter === 'review' ? 'active' : ''} disabled={!reviewCount} onClick={() => setCriterionFilter('review')}>Нужна проверка <span>{reviewCount}</span></button><button className={criterionFilter === 'revised' ? 'active' : ''} disabled={!revisedCount} onClick={() => setCriterionFilter('revised')}>Изменено <span>{revisedCount}</span></button></div>
          <div className="criteria-results">
            {evaluation.checklist.criteria.map((criterion, index) => {
              const result = evaluation.results.find((item) => item.criterionId === criterion.id);
              const item = evaluation.score.items.find((item) => item.criterionId === criterion.id);
              const initial = evaluation.initialResults.find((item) => item.criterionId === criterion.id);
              const pending = state.appeals.find((appeal) => appeal.evaluationId === evaluation.id && appeal.criterionId === criterion.id && appeal.status === 'pending');
              if (!result || (criterionFilter === 'review' && !result.needsReview) || (criterionFilter === 'revised' && initial?.value === result.value)) return null;
              return <article className="result-card" key={criterion.id}>
                <div className="result-card-heading"><span className="result-number">{String(index + 1).padStart(2, '0')}</span><h3>{criterion.name}</h3><Pill tone={ratingTone(result.value, criterion)}>{ratingLabel(result.value)}{criterion.kind === 'scale' && result.value !== 'na' ? ' / ' + Math.max(...criterion.levels.map((level) => level.value)) : ''}</Pill></div>
                <div className="result-metrics">{criterion.kind === 'flag' ? <span>Отдельная отметка · без баллов</span> : <><span>Вес {criterion.weight}</span><span>Вклад {scoreText(item?.points ?? 0)} балла</span>{item?.applicable && item.effectiveWeight !== criterion.weight && <span>Вес после N/A: {scoreText(item.effectiveWeight)}</span>}</>}{result.needsReview && <Pill tone="amber">Нужна проверка</Pill>}{initial && initial.value !== result.value && <span className="revised-label">До пересмотра: {ratingLabel(initial.value)}</span>}</div>
                <p className="result-explanation">{result.explanation}</p>
                <details className="result-rule"><summary>Правило и допустимые оценки<ClipboardCheck size={13} /></summary><p>{criterion.description}</p>{criterion.kind === 'scale' && <ul>{[...criterion.levels].sort((a, b) => b.value - a.value).map((level) => <li key={level.value}><strong>{level.value}</strong><span>{level.label}</span></li>)}</ul>}{criterion.allowNA && <p className="rule-na"><strong>N/A:</strong> {criterion.naCondition}</p>}<small>Правило из сохранённой версии {evaluation.checklist.version}{SUBMISSION_CRITERIA.find((entry) => entry.internalId === criterion.id) && <> · Код сдачи: <code>{SUBMISSION_CRITERIA.find((entry) => entry.internalId === criterion.id)?.id}</code></>}</small></details>
                {result.evidence.map((messageId) => {
                  const message = conversation.transcript.find((item) => item.id === messageId);
                  if (!message) return null;
                  return <button className="evidence-quote" onClick={(event) => jump([messageId], event.currentTarget)} key={messageId}><Quote size={14} /><span><span className="quote-meta">Реплика #{turnByMessageId.get(messageId)} · {speakerLabels[message.speaker]} · {message.timestamp}</span><span className="quote-text">{message.text}</span></span><ArrowUpRightIcon /></button>;
                })}
                {result.checkedRange && <button className="checked-range" onClick={(event) => jumpRange(result.checkedRange![0], result.checkedRange![1], event.currentTarget)}><ArrowDown size={13} />Проверенный участок: #{turnByMessageId.get(result.checkedRange[0])}–#{turnByMessageId.get(result.checkedRange[1])} · {conversation.transcript.find((message) => message.id === result.checkedRange?.[0])?.timestamp || result.checkedRange[0]} — {conversation.transcript.find((message) => message.id === result.checkedRange?.[1])?.timestamp || result.checkedRange[1]}</button>}
                <div className="result-card-footer">{result.value === 'na' ? <span className="na-note">Вес перераспределён</span> : <span />}{!showingOriginal && (pending ? <Pill tone="amber"><Scale size={12} />Апелляция подана</Pill> : <button className="appeal-link" onClick={() => setAppealCriterion(criterion)}><Scale size={13} />Оспорить</button>)}</div>
              </article>;
            })}
          </div>
          {evaluation.score.sections.length > 0 && <div className="section-results"><h3>Результаты по секциям</h3>{evaluation.score.sections.map((section) => <div key={section.name}><span>{section.name}</span><strong>{scoreText(section.score)} / {scoreText(section.possible)}</strong></div>)}</div>}
          <div className="calculation-note"><CheckCircle2 size={15} /><p>Итог рассчитан по применимым критериям. N/A исключён из расчёта, грубые ошибки отмечены отдельно.</p></div>
        </div>}
      </section>
    </div>
    {manual && selectedChecklist && <ManualEvaluation conversation={conversation} checklist={selectedChecklist} onClose={() => setManual(false)} onSaved={(result) => { setManual(false); selectResult(result.id); onEvaluationSaved(result); }} />}
    {!showingOriginal && appealCriterion && storedEvaluation && <AppealForm evaluation={storedEvaluation} criterion={appealCriterion} onClose={() => setAppealCriterion(null)} onSaved={() => { setAppealCriterion(null); onRefresh(); }} />}
  </div>;
}

function ArrowUpRightIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg>; }
