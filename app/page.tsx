'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard, MessagesSquare, ClipboardCheck, Scale, Settings2, ArrowUpRight, Plus, Search, ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, Sparkles, CircleCheck, AlertCircle, X, Menu, Headphones, MessageSquare, Plug, Square, ShieldCheck, Command, Target } from 'lucide-react';
import type { AppState, Conversation, Evaluation, Checklist } from '@/lib/types';
import { api, Channel, EmptyState, Pill, Spinner, conversationTitle, csvCell, downloadFile, latestFor, ratingLabel, scoreText } from '@/components/cqa/shared';
import { ChecklistEditor } from '@/components/cqa/checklist-editor';
import { SettingsPanel } from '@/components/cqa/settings-panel';
import { DialogueDetail } from '@/components/cqa/dialogue-detail';
import { AppealsView } from '@/components/cqa/appeals';
import { ImportModal } from '@/components/cqa/import-modal';
import { AccuracyView } from '@/components/cqa/accuracy-view';
import { OverviewDashboard } from '@/components/cqa/overview-dashboard';

type View = 'overview' | 'dialogs' | 'checklist' | 'accuracy' | 'appeals' | 'settings';
const navItems = [
  { id: 'overview' as View, label: 'Обзор', icon: LayoutDashboard },
  { id: 'dialogs' as View, label: 'Диалоги', icon: MessagesSquare },
  { id: 'checklist' as View, label: 'Чек-лист', icon: ClipboardCheck },
  { id: 'accuracy' as View, label: 'Точность AI', icon: Target },
  { id: 'appeals' as View, label: 'Апелляции', icon: Scale },
  { id: 'settings' as View, label: 'Настройки', icon: Settings2 },
];

export default function Home() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingText = 'Открываем рабочее пространство…';
  const [fatal, setFatal] = useState('');
  const [view, setView] = useState<View>('overview');
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [focusedEvaluationId, setFocusedEvaluationId] = useState('');
  const [focusedOriginal, setFocusedOriginal] = useState(false);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [accuracyModel, setAccuracyModel] = useState('');
  const [accuracyRevision, setAccuracyRevision] = useState('');
  const [checklistId, setChecklistId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('all');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState('all');
  const [dataset, setDataset] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ running: boolean; total: number; completed: number; errors: string[] } | null>(null);
  const stopBatch = useRef(false);
  const booted = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterNavigation = useRef(false);

  function notify(text: string, tone: 'success' | 'error' | 'info' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 9000 : 6000);
  }
  async function reload() {
    const next = await api<AppState>('/api/state');
    setState(next);
    setFatal('');
    setChecklistId((previous) => next.checklists.some((checklist) => checklist.id === previous) ? previous : next.activeChecklistId || next.checklists[0]?.id || '');
    return next;
  }
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        await reload();
      } catch (cause) { setFatal(cause instanceof Error ? cause.message : 'Не удалось открыть приложение.'); }
      finally { setLoading(false); }
    })();
  }, []);
  useEffect(() => { setPage(1); }, [search, language, channel, status, dataset]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 850px)');
    const update = () => { setMobileNavigation(media.matches); if (!media.matches) setSidebarOpen(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileNavigation || !sidebarOpen || !sidebarRef.current) return;
    const drawer = sidebarRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const initialFocus = requestAnimationFrame(() => (drawer.querySelector<HTMLButtonElement>('[aria-current="page"]') || drawer.querySelector<HTMLButtonElement>('button'))?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); return; }
      if (event.key !== 'Tab') return;
      const controls = [...drawer.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (!drawer.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(initialFocus);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!focusAfterNavigation.current && window.matchMedia('(max-width: 850px)').matches) requestAnimationFrame(() => menuTriggerRef.current?.focus());
    };
  }, [mobileNavigation, sidebarOpen]);
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => { mainRef.current?.focus({ preventScroll: true }); focusAfterNavigation.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  function requestContentFocus() { focusAfterNavigation.current = true; setFocusRequest((current) => current + 1); }

  function navigate(next: View) {
    requestContentFocus();
    setView(next); setSelectedConversation(null); setFocusedEvaluationId(''); setFocusedOriginal(false); setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function openConversation(id: string, evaluationId = '', showOriginal = false) { requestContentFocus(); setSelectedConversation(id); setFocusedEvaluationId(evaluationId); setFocusedOriginal(showOriginal); setView('dialogs'); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function refresh() {
    setRefreshing(true);
    try { await reload(); notify('Данные обновлены.'); } catch (cause) { notify(cause instanceof Error ? cause.message : 'Не удалось обновить данные.', 'error'); }
    finally { setRefreshing(false); }
  }
  function saveEvaluation(evaluation: Evaluation) {
    setState((current) => current ? { ...current, evaluations: [evaluation, ...current.evaluations.filter((item) => item.id !== evaluation.id)] } : current);
  }
  function aiReady(): boolean {
    if (!state?.settings.model?.trim() || (!apiKey.trim() && !state?.providerConfigured)) {
      navigate('settings'); notify('Укажите модель и API-ключ, затем сохраните настройки.', 'info'); return false;
    }
    return true;
  }
  async function evaluate(conversationId: string): Promise<Evaluation | null> {
    if (!aiReady() || evaluatingId || batch?.running) return null;
    setEvaluatingId(conversationId);
    try {
      const evaluation = await api<Evaluation>('/api/evaluate', { conversationId, checklistId, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      saveEvaluation(evaluation); notify('Оценка сохранена с доказательствами.');
      return evaluation;
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Не удалось оценить диалог.', 'error'); return null; }
    finally { setEvaluatingId(null); }
  }
  async function runBatch() {
    if (!selected.size || !aiReady() || evaluatingId || batch?.running) return;
    const ids = [...selected];
    stopBatch.current = false;
    const current = { running: true, total: ids.length, completed: 0, errors: [] as string[] };
    setBatch({ ...current });
    for (const id of ids) {
      if (stopBatch.current) break;
      setEvaluatingId(id);
      try {
        const evaluation = await api<Evaluation>('/api/evaluate', { conversationId: id, checklistId, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
        saveEvaluation(evaluation);
      } catch (cause) { current.errors.push((state?.conversations.find((item) => item.id === id)?.conversation_id || id) + ': ' + (cause instanceof Error ? cause.message : 'Ошибка оценки')); }
      current.completed++;
      setBatch({ ...current, errors: [...current.errors] });
    }
    setEvaluatingId(null);
    setBatch({ ...current, running: false, errors: [...current.errors] });
    notify(stopBatch.current ? 'Пакетная оценка остановлена после текущего диалога.' : 'Пакетная оценка завершена: ' + (current.completed - current.errors.length) + ' успешно, ' + current.errors.length + ' с ошибкой.', current.errors.length ? 'info' : 'success');
  }

  const conversations = state?.conversations || [];
  const evaluations = state?.evaluations || [];
  const latest = useMemo(() => new Map(conversations.map((conversation) => [conversation.id, latestFor(conversation.id, evaluations)])), [conversations, evaluations]);
  const filtered = useMemo(() => conversations.filter((conversation) => {
    const evaluation = latest.get(conversation.id);
    return (language === 'all' || conversation.language === language)
      && (channel === 'all' || conversation.channel === channel)
      && (dataset === 'all' || conversation.dataset_group_id === dataset)
      && (status === 'all' || (status === 'evaluated' ? !!evaluation : status === 'pending' ? !evaluation : status === 'review' ? evaluation?.results.some((item) => item.needsReview) : state?.appeals.some((appeal) => appeal.conversationId === conversation.id && appeal.status === 'pending')))
      && (!search.trim() || (conversation.conversation_id + ' ' + conversation.transcript.map((message) => message.text).join(' ')).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  }), [conversations, latest, language, channel, dataset, status, search, state?.appeals]);
  const selectedDetail = conversations.find((conversation) => conversation.id === selectedConversation);
  const activeChecklist = state?.checklists.find((checklist) => checklist.id === checklistId) || state?.checklists[0];
  const groups = [...new Set(conversations.map((conversation) => conversation.dataset_group_id))];
  const pendingAppeals = state?.appeals.filter((appeal) => appeal.status === 'pending').length || 0;
  const ready = !!state?.settings.model.trim() && (!!apiKey.trim() || !!state?.providerConfigured);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const activePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((activePage - 1) * 10, activePage * 10);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function exportResults(format: 'json' | 'csv') {
    if (!state?.evaluations.length) { notify('Сначала выполните хотя бы одну оценку.', 'info'); return; }
    if (format === 'json') downloadFile('cqa-results.json', JSON.stringify({ exportedAt: new Date().toISOString(), evaluations: state.evaluations, appeals: state.appeals }, null, 2), 'application/json;charset=utf-8');
    else {
      const rows: unknown[][] = [['Диалог', 'Набор', 'Язык', 'Канал', 'Источник', 'Модель', 'Версия чек-листа', 'Критерий', 'Оценка', 'Вклад', 'Обоснование', 'Доказательства', 'Исходный итог', 'Финальный итог', 'Грубая ошибка', 'Стоимость USD']];
      for (const evaluation of state.evaluations) {
        const conversation = state.conversations.find((item) => item.id === evaluation.conversationId);
        for (const result of evaluation.results) {
          const criterion = evaluation.checklist.criteria.find((item) => item.id === result.criterionId);
          rows.push([conversation?.conversation_id || evaluation.conversationId, conversation?.dataset_group_id, conversation?.language, conversation?.channel, evaluation.source, evaluation.model, evaluation.checklist.version, criterion?.name || result.criterionId, ratingLabel(result.value), evaluation.score.items.find((item) => item.criterionId === result.criterionId)?.points, result.explanation, result.evidence.map((id) => conversation?.transcript.find((message) => message.id === id)?.text || id).join(' | '), evaluation.initialScore.total, evaluation.score.total, evaluation.score.critical ? 'Да' : 'Нет', evaluation.usage.costUsd]);
        }
      }
      downloadFile('cqa-results.csv', '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
    }
  }

  function renderConversationRows(rows: Conversation[], selectable = false) {
    return rows.map((conversation) => {
      const evaluation = latest.get(conversation.id);
      const hasAppeal = state?.appeals.some((appeal) => appeal.conversationId === conversation.id && appeal.status === 'pending');
      return <tr key={conversation.id} onClick={() => openConversation(conversation.id)} className={selected.has(conversation.id) ? 'selected-row' : ''}>
        {selectable && <td className="checkbox-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={'Выбрать ' + conversation.conversation_id} checked={selected.has(conversation.id)} onChange={() => toggle(conversation.id)} /></td>}
        <td><button className="dialogue-name" onClick={() => openConversation(conversation.id)}><span className={'conversation-icon ' + (conversation.channel === 'voice call' ? 'voice-icon' : '')}>{conversation.channel === 'voice call' ? <Headphones size={17} /> : <MessageSquare size={17} />}</span><span><strong>{conversationTitle(conversation)}</strong><small>{conversation.conversation_id}{selectable ? ' · ' + conversation.dataset_group_id : ''}</small></span></button></td>
        <td><span className={'language-badge language-' + conversation.language.toLowerCase()}>{conversation.language}</span></td>
        {selectable && <td><Channel conversation={conversation} /></td>}
        <td>{evaluatingId === conversation.id ? <Pill tone="blue"><Spinner />Оценка…</Pill> : hasAppeal ? <Pill tone="amber" dot>Апелляция</Pill> : evaluation ? <Pill tone={evaluation.results.some((item) => item.needsReview) ? 'amber' : evaluation.source === 'ai' ? 'green' : 'blue'} dot>{evaluation.results.some((item) => item.needsReview) ? 'Нужна проверка' : evaluation.source === 'ai' ? 'AI-оценка' : 'Эксперт'}</Pill> : <Pill tone="neutral">Не оценён</Pill>}</td>
        <td className="score-cell">{evaluation ? <strong>{scoreText(evaluation.score.total)}</strong> : <span className="muted">—</span>}{evaluation?.score.critical && <span className="critical-dot" title="Обнаружена грубая ошибка" />}</td>
        <td className="arrow-cell"><ArrowUpRight size={16} /></td>
      </tr>;
    });
  }

  return <div className="app-shell">
    <a className="studio-skip-link" href="#cqa-main">Перейти к содержимому</a>
    {sidebarOpen && <button aria-label="Закрыть меню" tabIndex={-1} className="mobile-scrim" onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebarRef} id="cqa-navigation" className={'sidebar ' + (sidebarOpen ? 'open' : '')} inert={mobileNavigation && !sidebarOpen} aria-hidden={mobileNavigation && !sidebarOpen ? true : undefined} role={mobileNavigation && sidebarOpen ? 'dialog' : undefined} aria-modal={mobileNavigation && sidebarOpen ? true : undefined} aria-label="Главное меню">
      <button className="studio-menu-close" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)}><X size={19} /></button>
      <button className="brand" onClick={() => navigate('overview')} aria-label="CQA Studio — обзор"><span className="brand-mark"><i /><i /><i /></span><span>CQA<span className="brand-studio">studio</span></span></button>
      <div className="workspace-label"><span className="workspace-icon"><Command size={15} /></span><span>Рабочее пространство<small>Conversation Quality Analytics</small></span></div>
      <div className="nav-caption">АНАЛИТИКА КАЧЕСТВА</div>
      <nav className="main-nav" aria-label="Основная навигация">{navItems.map((item) => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.label}</span>{item.id === 'dialogs' && conversations.length > 0 && <small>{conversations.length}</small>}{item.id === 'appeals' && pendingAppeals > 0 && <small className="nav-alert">{pendingAppeals}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-check"><ShieldCheck size={20} /><strong>От оценки к доверию</strong><p>Каждый вывод можно проверить по исходному разговору.</p></div><div className="sidebar-credit"><span className="freedom-symbol">F</span><div><strong>Freedom Broker</strong><small>CQA HACKATHON · 2026</small></div></div></div>
    </aside>
    <div className="main-shell" inert={mobileNavigation && sidebarOpen} aria-hidden={mobileNavigation && sidebarOpen ? true : undefined}>
      <header className="topbar">
        <div className="topbar-left"><button ref={menuTriggerRef} className="icon-button mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Открыть меню" aria-expanded={sidebarOpen} aria-controls="cqa-navigation"><Menu size={21} /></button><span className="topbar-label">Рабочее пространство</span><ChevronRight size={13} /><strong>{navItems.find((item) => item.id === view)?.label}</strong></div>
        <div className="topbar-right"><span className="live-status studio-load-status" data-state={loading || refreshing ? 'loading' : fatal || !state ? 'error' : 'ready'} role="status"><span />{loading ? 'Загрузка данных' : fatal || !state ? 'Данные недоступны' : refreshing ? 'Обновляем данные' : 'Данные загружены'}</span><button className="icon-button" aria-label="Обновить данные" title="Обновить данные" disabled={refreshing || loading} onClick={refresh}><RefreshCw size={17} className={refreshing ? 'spin' : ''} /></button><span className="topbar-divider" /><span className="avatar">QA</span></div>
      </header>
      <main ref={mainRef} id="cqa-main" tabIndex={-1} aria-label={navItems.find((item) => item.id === view)?.label} className={'main-content ' + (selectedDetail && view === 'dialogs' ? 'detail-content' : '')}>
        {loading ? <div className="loading-page"><div className="loading-brand"><span className="brand-mark"><i /><i /><i /></span></div><h1>{loadingText}</h1><p>Подготавливаем диалоги и настройки оценки.</p><div className="loading-line" /><div className="skeleton-stats">{[1, 2, 3, 4].map((item) => <div key={item} />)}</div></div> : fatal || !state ? <div className="panel"><EmptyState icon={<AlertCircle size={30} />} title="Не удалось загрузить рабочее пространство" description={fatal || 'Попробуйте обновить страницу.'} action={<button className="button primary" onClick={() => { setFatal(''); setLoading(true); reload().catch((cause) => setFatal(cause.message)).finally(() => setLoading(false)); }}><RefreshCw size={16} />Попробовать снова</button>} /></div> : <>
          {view === 'overview' && <OverviewDashboard state={state} latest={latest} activeChecklist={activeChecklist} ready={ready} evaluatingId={evaluatingId}
            onImport={() => setImportOpen(true)} onDialogs={() => navigate('dialogs')}
            onReview={() => { setStatus('review'); setSearch(''); setLanguage('all'); setChannel('all'); setDataset('all'); navigate('dialogs'); }}
            onAccuracy={() => navigate('accuracy')} onAppeals={() => navigate('appeals')} onSettings={() => navigate('settings')} onChecklist={() => navigate('checklist')} onOpenConversation={openConversation} />}
          {view === 'dialogs' && (selectedDetail ? <DialogueDetail initialShowOriginal={focusedOriginal} initialEvaluationId={focusedEvaluationId} conversation={selectedDetail} state={state} checklistId={checklistId} onChecklistChange={setChecklistId} onBack={() => { setSelectedConversation(null); setFocusedEvaluationId(''); setFocusedOriginal(false); requestContentFocus(); }} onEvaluate={evaluate} evaluating={evaluatingId === selectedDetail.id} onRefresh={() => { void reload().then(() => notify('Апелляция сохранена.')).catch((cause) => notify(cause.message, 'error')); }} onSettings={() => navigate('settings')} onEvaluationSaved={(evaluation) => { saveEvaluation(evaluation); notify('Оценка эксперта сохранена.'); }} /> : <div className="page-stack">
            <div className="page-heading"><div><div className="eyebrow">От разговора к результату</div><h1>Диалоги <span className="heading-count">{conversations.length}</span></h1><p>Чаты и звонки на русском, казахском и английском.</p></div><div className="heading-actions"><details className="export-menu"><summary className="button secondary"><Download size={16} />Экспорт<ChevronDown size={13} /></summary><div><button onClick={() => exportResults('json')}>Все оценки · JSON</button><button onClick={() => exportResults('csv')}>Таблица результатов · CSV</button></div></details><button className="button primary" onClick={() => setImportOpen(true)}><Plus size={16} />Загрузить диалоги</button></div></div>
            {batch && <div className={'batch-panel ' + (batch.running ? 'running' : '')}><div className="batch-heading"><div>{batch.running ? <Spinner /> : <CircleCheck size={18} />}<strong>{batch.running ? 'Пакетная оценка' : 'Обработка завершена'}</strong><span>{batch.completed} из {batch.total}</span></div>{batch.running ? <button className="button secondary small-button" onClick={() => { stopBatch.current = true; notify('Остановим обработку после текущего диалога.', 'info'); }}><Square size={12} />Остановить</button> : <button className="icon-button" aria-label="Скрыть результат пакетной оценки" onClick={() => setBatch(null)}><X size={16} /></button>}</div><div className="batch-progress"><i style={{ width: (batch.completed / batch.total * 100) + '%' }} /></div>{batch.errors.length > 0 && <details><summary>Ошибки: {batch.errors.length}</summary>{batch.errors.map((error, index) => <p key={index}>{error}</p>)}</details>}</div>}
            <section className="panel dialogues-panel">
              <div className="filters"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по тексту или ID диалога" aria-label="Поиск диалогов" />{search && <button aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={14} /></button>}</label><select className="field filter-field" aria-label="Набор данных" value={dataset} onChange={(event) => setDataset(event.target.value)}><option value="all">Все наборы</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select><select className="field filter-field" aria-label="Язык" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">Все языки</option><option value="RU">Русский</option><option value="KZ">Қазақша</option><option value="EN">English</option></select><select className="field filter-field" aria-label="Канал" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">Все каналы</option><option value="agent chat">Чаты</option><option value="voice call">Звонки</option></select><select className="field filter-field" aria-label="Статус" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Все статусы</option><option value="pending">Не оценены</option><option value="evaluated">С оценкой</option><option value="appealed">С апелляцией</option><option value="review">Нужна проверка</option></select></div>
              {selected.size > 0 && <div className="selection-bar"><span><strong>{selected.size}</strong> выбрано</span><button className="button text-button small-button" onClick={() => setSelected(new Set())}>Снять выбор</button><select className="field compact-field" aria-label="Чек-лист пакетной оценки" value={checklistId} onChange={(event) => setChecklistId(event.target.value)}>{state.checklists.map((checklist) => <option key={checklist.id} value={checklist.id}>{checklist.name} · v{checklist.version}</option>)}</select><button className="button primary small-button" disabled={!!evaluatingId || !!batch?.running} onClick={runBatch}><Sparkles size={15} />Оценить выбранные</button></div>}
              {!filtered.length ? <EmptyState icon={<Search size={28} />} title={conversations.length ? 'Диалоги не найдены' : 'Добавьте первый набор'} description={conversations.length ? 'Попробуйте другой запрос или измените фильтры.' : 'Загрузите диалоги из API организаторов или собственного JSON-файла.'} action={<button className="button secondary" onClick={() => { if (!conversations.length) setImportOpen(true); else { setSearch(''); setLanguage('all'); setChannel('all'); setStatus('all'); setDataset('all'); } }}>{conversations.length ? 'Сбросить фильтры' : 'Загрузить диалоги'}</button>} /> : <div className="table-scroll"><table className="data-table dialogues-table"><thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="Выбрать все диалоги на странице" checked={pageRows.length > 0 && pageRows.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const item of pageRows) { if (event.target.checked) next.add(item.id); else next.delete(item.id); } return next; })} /></th><th>Диалог</th><th>Язык</th><th>Канал</th><th>Статус</th><th>Балл</th><th /></tr></thead><tbody>{renderConversationRows(pageRows, true)}</tbody></table></div>}
              <div className="table-footer"><span>{filtered.length ? (activePage - 1) * 10 + 1 : 0}–{Math.min(activePage * 10, filtered.length)} из {filtered.length} диалогов</span><div className="pagination"><button className="icon-button" aria-label="Предыдущая страница" disabled={activePage <= 1} onClick={() => setPage(activePage - 1)}><ChevronLeft size={17} /></button>{Array.from({ length: pageCount }, (_, index) => index + 1).filter((number) => number === 1 || number === pageCount || Math.abs(number - activePage) <= 1).map((number, index, array) => <span key={number}>{index > 0 && number - array[index - 1] > 1 && <span className="pagination-ellipsis">…</span>}<button className={number === activePage ? 'active' : ''} onClick={() => setPage(number)} aria-label={'Страница ' + number} aria-current={number === activePage ? 'page' : undefined}>{number}</button></span>)}<button className="icon-button" aria-label="Следующая страница" disabled={activePage >= pageCount} onClick={() => setPage(activePage + 1)}><ChevronRight size={17} /></button></div></div>
            </section>
          </div>)}
          {view === 'checklist' && <ChecklistEditor checklist={activeChecklist} all={state.checklists} onSelect={setChecklistId} onSaved={(checklist: Checklist) => { setState((current) => current ? { ...current, checklists: [checklist, ...current.checklists], activeChecklistId: checklist.id } : current); setChecklistId(checklist.id); notify('Новая версия чек-листа сохранена.'); }} />}
          {view === 'accuracy' && <AccuracyView state={state} model={accuracyModel} revision={accuracyRevision} onModelChange={setAccuracyModel} onRevisionChange={setAccuracyRevision} referenceIds={referenceIds} onReferencesChange={setReferenceIds} onOpenConversation={openConversation} onDialogs={() => navigate('dialogs')} />}
          {view === 'appeals' && <AppealsView state={state} onOpenConversation={openConversation} onResolved={() => { void reload().then(() => notify('Решение сохранено, итог пересчитан.')).catch((cause) => notify(cause.message, 'error')); }} />}
          {view === 'settings' && <SettingsPanel settings={state.settings} apiKey={apiKey} setApiKey={setApiKey} providerConfigured={state.providerConfigured} onSaved={() => { void reload().catch((cause) => notify(cause.message, 'error')); }} />}
        </>}
      </main>
      <footer className="app-footer"><span>CQA Studio</span><span>Прозрачная оценка. Проверяемые решения.</span><span>RU · KZ · EN</span></footer>
    </div>
    {importOpen && <ImportModal datasetConfigured={!!state?.datasetConfigured} onClose={() => setImportOpen(false)} onImported={(groupId, count) => { setImportOpen(false); setDataset(groupId); void reload().then(() => { navigate('dialogs'); notify('Загружено диалогов: ' + count + '. Набор ' + groupId + '.'); }).catch((cause) => notify(cause.message, 'error')); }} />}
    {toast && <div className={'toast toast-' + toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>{toast.tone === 'error' ? <AlertCircle size={19} /> : toast.tone === 'success' ? <CircleCheck size={19} /> : <Plug size={19} />}<span>{toast.text}</span><button aria-label="Закрыть уведомление" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>;
}
