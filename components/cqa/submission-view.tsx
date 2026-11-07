'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Code2, Copy, Download, FileCheck2, FileJson2, FileUp, FolderGit2, GitBranch, ListChecks, Search, ShieldCheck, Sparkles } from 'lucide-react';
import type { AppState, ModelMode } from '@/lib/types';
import { buildSubmission, SUBMISSION_CRITERIA, SUBMISSION_DATASETS, type BuildSubmissionInput, type SubmissionBuild, type SubmissionIssue, type SubmissionRow } from '@/lib/submission';
import { downloadFile, scoreText, Spinner } from './shared';
import './submission-view.css';

interface SubmissionViewProps {
  state: AppState;
  onImport: () => void;
  onDialogs: (groupId?: string) => void;
  onSettings: () => void;
  onOpenConversation: (id: string, evaluationId?: string, showOriginal?: boolean) => void;
}

type Dataset = 'dev' | 'prod';
type RowFilter = 'all' | 'error' | 'review';
type GroupSelection = Record<Dataset, string>;
type LegacyMode = { mode: ModelMode | ''; confirmed: boolean };
type DeclaredModel = { name: string; mode: ModelMode | ''; confirmed: boolean };
const STORAGE_KEY = 'cqa-submission-preferences-v1';
const REPOSITORY_URL = 'https://github.com/erassylls/doomsday';
const MODE_NAMES: Record<ModelMode, string> = {
  external_api: 'Облачный API',
  local: 'Локальная модель',
  hybrid: 'Смешанный подход',
};
const GIT_COMMANDS = 'git add results/dev/results.json results/prod/results.json\ngit commit -m "Add CQA evaluation results"\ngit push';

function rowLabel(row: SubmissionRow): string {
  if (row.kind === 'invalid') return 'Исправить';
  if (row.kind === 'failed') return 'Ошибка запуска';
  if (row.kind === 'unprocessed') return 'Без AI-запуска';
  return row.needsReview ? 'AI · проверить' : 'AI · готово';
}

function IssueList({ issues }: { issues: SubmissionIssue[] }) {
  return <ul className="submission-issue-list">{issues.map((issue, index) => <li key={`${issue.code}-${issue.conversationId || ''}-${issue.criterionId || ''}-${index}`}>
    {issue.conversationId && <code>{issue.conversationId}</code>}<span>{issue.message}</span>
  </li>)}</ul>;
}

export function SubmissionView({ state, onImport, onDialogs, onSettings, onOpenConversation }: SubmissionViewProps) {
  const fieldId = useId();
  const [dataset, setDataset] = useState<Dataset>('dev');
  const [teamName, setTeamName] = useState('');
  const [groupSelection, setGroupSelection] = useState<GroupSelection>(() => ({ dev: state.conversations.some((item) => item.dataset_group_id === 'DEV') ? 'DEV' : '', prod: '' }));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [legacyModes, setLegacyModes] = useState<Record<Dataset, LegacyMode>>({ dev: { mode: '', confirmed: false }, prod: { mode: '', confirmed: false } });
  const [declaredModels, setDeclaredModels] = useState<Record<Dataset, DeclaredModel>>({ dev: { name: '', mode: '', confirmed: false }, prod: { name: '', mode: '', confirmed: false } });
  const [search, setSearch] = useState('');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [feedback, setFeedback] = useState('');
  const [checked, setChecked] = useState<{ input: BuildSubmissionInput; value: SubmissionBuild | null; error: string } | null>(null);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of state.conversations) counts.set(item.dataset_group_id, (counts.get(item.dataset_group_id) || 0) + 1);
    return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
  }, [state.conversations]);
  const groupId = groups.some((group) => group.id === groupSelection[dataset]) ? groupSelection[dataset] : '';
  const legacy = legacyModes[dataset];
  const declared = declaredModels[dataset];
  const specification = SUBMISSION_DATASETS[dataset];

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored && typeof stored === 'object') {
        const value = stored as { teamName?: unknown; dev?: unknown; prod?: unknown };
        if (typeof value.teamName === 'string') setTeamName(value.teamName.slice(0, 200));
        setGroupSelection((previous) => ({
          dev: typeof value.dev === 'string' ? value.dev.slice(0, 64) : previous.dev,
          prod: typeof value.prod === 'string' ? value.prod.slice(0, 64) : previous.prod,
        }));
      }
    } catch { /* Preferences are optional; storage may be unavailable. */ }
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamName, ...groupSelection })); }
    catch { /* A disabled browser store must not prevent an export. */ }
  }, [preferencesLoaded, teamName, groupSelection]);

  const buildInput = useMemo(() => ({
    state, dataset, groupId, teamName,
    ...(legacy.mode ? { legacyModelMode: legacy.mode, legacyModeConfirmed: legacy.confirmed } : {}),
    ...(declared.confirmed && declared.mode && declared.name.trim() ? { unprocessedModel: { name: declared.name.trim(), mode: declared.mode } } : {}),
  }), [state, dataset, groupId, teamName, legacy.mode, legacy.confirmed, declared.name, declared.mode, declared.confirmed]);

  useEffect(() => {
    let active = true;
    void buildSubmission(buildInput).then((value) => {
      if (active) setChecked({ input: buildInput, value, error: '' });
    }).catch(() => {
      if (active) setChecked({ input: buildInput, value: null, error: 'Не удалось проверить файл. Обновите данные и попробуйте снова.' });
    });
    return () => { active = false; };
  }, [buildInput]);

  useEffect(() => { setSearch(''); setRowFilter('all'); setFeedback(''); }, [dataset, groupId]);
  useEffect(() => { setFeedback(''); }, [teamName, legacy.mode, legacy.confirmed, declared.name, declared.mode, declared.confirmed]);

  // The input reference prevents a previous dataset's ready file from being downloaded while the next check is running.
  const current = checked?.input === buildInput ? checked : null;
  const report = current?.value || null;
  // Keep metadata fields mounted while their own input is being checked, so typing never loses focus.
  // A different group or data snapshot must not inherit these displayed details.
  const metadataReport = checked?.input.state === state && checked.input.dataset === dataset && checked.input.groupId === groupId ? checked.value : null;
  const checking = !current;
  const counts = report?.counts;
  const rows = (report?.rows || []).filter((row) => (!search.trim() || row.conversationId.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && (rowFilter === 'all' || (rowFilter === 'error' ? row.status === 'error' : row.needsReview)));
  const documentRows = new Map(report?.document?.results.map((row) => [row.conversation_id, row]) || []);
  const loaded = counts?.total || 0;
  const correctCount = loaded === specification.expected && counts?.chats === specification.chats && counts?.calls === specification.calls;
  const ready = !!report?.canExport;
  const model = metadataReport?.document?.model;
  const usesDeclaredModel = !!metadataReport?.warnings.some((warning) => warning.code === 'DECLARED_MODEL');
  const hasActualModels = !!metadataReport?.models.length && !usesDeclaredModel;
  const canDeclareModel = !!metadataReport && (!metadataReport.models.length || usesDeclaredModel);
  const readyWithErrors = ready && !!counts?.error;
  const completion = Math.min(100, loaded / specification.expected * 100);

  function selectDataset(value: Dataset) { setDataset(value); }
  function selectGroup(value: string) {
    setGroupSelection((previous) => ({ ...previous, [dataset]: value }));
    setLegacyModes((previous) => ({ ...previous, [dataset]: { mode: '', confirmed: false } }));
    setDeclaredModels((previous) => ({ ...previous, [dataset]: { name: '', mode: '', confirmed: false } }));
  }
  function setLegacyMode(value: ModelMode | '') {
    setLegacyModes((previous) => ({ ...previous, [dataset]: { mode: value, confirmed: false } }));
  }
  function updateDeclaredModel(change: Partial<Pick<DeclaredModel, 'name' | 'mode'>>) {
    setDeclaredModels((previous) => ({ ...previous, [dataset]: { ...previous[dataset], ...change, confirmed: false } }));
  }
  async function copy(text: string, success: string) {
    try { await navigator.clipboard.writeText(text); setFeedback(success); }
    catch { setFeedback('Не удалось скопировать автоматически. Выделите текст и скопируйте его вручную.'); }
  }
  function download() {
    if (!report?.canExport || !report.document) return;
    downloadFile('results.json', report.json, 'application/json;charset=utf-8');
    setFeedback(`Скачивание ${dataset.toUpperCase()} запрошено. Разместите файл в ${report.filePath}, затем выполните commit и push.`);
  }

  return <div className="submission-center">
    <section className="submission-hero" aria-labelledby={`${fieldId}-title`}>
      <div className="submission-hero-copy">
        <span className="submission-eyebrow"><FileCheck2 size={14} />ФОРМАТ ОРГАНИЗАТОРОВ · JSON 1.0</span>
        <h1 id={`${fieldId}-title`}>Сдача результатов<span>Все диалоги. Один формат.</span></h1>
        <p>Соберите оценки DEV и контрольного набора, проверьте файл и подготовьте его к отправке в Git.</p>
        <div className="submission-hero-tags"><span><ShieldCheck size={13} />Исходные AI-оценки</span><span><ListChecks size={13} />8 критериев на диалог</span></div>
      </div>
      <div className="submission-window" aria-label="Контрольный этап: получение набора через 23 часа после старта, стоп-код через 24 часа">
        <span className="submission-window-caption"><Clock3 size={15} />КОНТРОЛЬНЫЙ ЭТАП</span>
        <strong>10 чатов<span>1 час на весь процесс</span></strong>
        <div className="submission-timeline"><div><b>23-й час</b><span>Получение набора</span></div><ArrowRight size={20} /><div><b>24-й час</b><span>Стоп-код</span></div></div>
        <p>Получить → оценить → проверить → push</p>
      </div>
    </section>

    <div className="submission-datasets" role="group" aria-label="Файл набора для подготовки">
      {(['dev', 'prod'] as const).map((value) => {
        const target = SUBMISSION_DATASETS[value];
        const total = groups.find((group) => group.id === groupSelection[value])?.count || 0;
        return <button type="button" key={value} className={`submission-dataset ${dataset === value ? 'is-selected' : ''}`} aria-pressed={dataset === value} onClick={() => selectDataset(value)}>
          <span className="submission-dataset-icon"><FolderGit2 size={22} strokeWidth={1.6} /></span>
          <span className="submission-dataset-copy"><span><strong>{value.toUpperCase()}</strong><small>{value === 'dev' ? 'Разработка' : 'Контрольный набор'}</small></span><code>{target.path}</code></span>
          <span className="submission-dataset-count"><b>{total}<span> / {target.expected}</span></b><small>загружено</small></span>
          <span className="submission-dataset-choice" aria-hidden="true">{dataset === value && <Check size={13} strokeWidth={2.5} />}</span>
        </button>;
      })}
    </div>

    <div className="submission-workspace">
      <section className="submission-card submission-configuration" aria-labelledby={`${fieldId}-config-title`}>
        <div className="submission-card-heading"><span className="submission-step">01</span><div><h2 id={`${fieldId}-config-title`}>Параметры файла</h2><p>Выберите набор и укажите название команды.</p></div></div>
        <div className="submission-fields">
          <label className="form-field" htmlFor={`${fieldId}-team`}>Название команды<input className="field" id={`${fieldId}-team`} value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={200} placeholder="Как в заявке на хакатон" autoComplete="organization" aria-describedby={`${fieldId}-team-help`} /><small id={`${fieldId}-team-help`}>Попадёт в поле <code>team_name</code> в обоих файлах.</small></label>
          <label className="form-field" htmlFor={`${fieldId}-group`}>Набор для файла {dataset.toUpperCase()}<select className="field" id={`${fieldId}-group`} value={groupId} onChange={(event) => selectGroup(event.target.value)} aria-describedby={`${fieldId}-group-help`}><option value="">Выберите загруженный набор</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.id} · {group.count} диалогов</option>)}</select><small id={`${fieldId}-group-help`}>{dataset === 'dev' ? 'Нужны 60 чатов и 5 звонков из DEV.' : 'Выберите 10 контрольных чатов, полученных от организаторов. Название набора в API может отличаться от PROD.'}</small></label>
        </div>
        <div className="submission-configuration-actions"><button type="button" className="button text-button small-button" onClick={onImport}><FileUp size={15} />Загрузить набор</button><button type="button" className="button text-button small-button" onClick={() => onDialogs(groupId || undefined)}><Sparkles size={15} />К оценке диалогов<ArrowUpRight size={13} /></button></div>
        <div className="submission-model">
          <div className="submission-model-heading"><Code2 size={16} /><strong>{usesDeclaredModel ? 'Модель, указанная для файла с ошибками' : 'Модель в сохранённых запусках'}</strong></div>
          {hasActualModels ? <dl><div><dt>Название</dt><dd>{metadataReport!.models.join(', ')}</dd></div><div><dt>Режим</dt><dd>{model ? <>{MODE_NAMES[model.mode]} <code>{model.mode}</code></> : metadataReport?.needsLegacyMode ? 'Требует уточнения' : 'Проверяется вместе с файлом'}</dd></div></dl> : <p>{!metadataReport ? 'Проверяем историю AI-запусков…' : usesDeclaredModel ? 'Сведения подтверждены вами. Все диалоги в этом файле сохранят статус error.' : 'В выбранном наборе пока нет сохранённых названий моделей. Выполните AI-оценку или заполните сведения для файла с ошибками.'}</p>}
          <button type="button" className="button text-button small-button" onClick={onSettings}>Настройки модели<ArrowUpRight size={13} /></button>
          {canDeclareModel && <div className="submission-declared-model">
            <p id={`${fieldId}-declared-help`}><CircleHelp size={15} /><span>Если попытки оценки не сохранились, укажите фактически использованную модель для файла с ошибками. Все ID останутся <code>status: error</code>.</span></p>
            <label className="form-field" htmlFor={`${fieldId}-declared-name`}>Фактически использованная модель<input id={`${fieldId}-declared-name`} className="field" value={declared.name} onChange={(event) => updateDeclaredModel({ name: event.target.value })} maxLength={500} placeholder="Название модели или несколько через запятую" autoComplete="off" aria-describedby={`${fieldId}-declared-help`} /></label>
            <label className="form-field" htmlFor={`${fieldId}-declared-mode`}>Фактический режим модели<select id={`${fieldId}-declared-mode`} className="field" value={declared.mode} onChange={(event) => updateDeclaredModel({ mode: event.target.value as ModelMode | '' })}><option value="">Выберите фактический режим</option><option value="external_api">Облачный API · external_api</option><option value="local">Локальная модель · local</option><option value="hybrid">Смешанный подход · hybrid</option></select></label>
            <label className="submission-confirm"><input type="checkbox" disabled={!declared.name.trim() || !declared.mode} checked={declared.confirmed} onChange={(event) => setDeclaredModels((previous) => ({ ...previous, [dataset]: { ...previous[dataset], confirmed: event.target.checked } }))} /><span>Подтверждаю, что указаны фактически использованные модель и режим. Все записи останутся ошибками обработки.</span></label>
          </div>}
          {metadataReport?.needsLegacyMode && <div className="submission-legacy-mode">
            <p><CircleHelp size={15} />У ранних запусков режим не сохранялся. Укажите режим, который действительно использовался.</p>
            <label className="form-field" htmlFor={`${fieldId}-legacy-mode`}>Режим ранних запусков<select id={`${fieldId}-legacy-mode`} className="field" value={legacy.mode} onChange={(event) => setLegacyMode(event.target.value as ModelMode | '')}><option value="">Выберите фактический режим</option><option value="external_api">Облачный API · external_api</option><option value="local">Локальная модель · local</option><option value="hybrid">Смешанный подход · hybrid</option></select></label>
            <label className="submission-confirm"><input type="checkbox" disabled={!legacy.mode} checked={legacy.confirmed} onChange={(event) => setLegacyModes((previous) => ({ ...previous, [dataset]: { ...previous[dataset], confirmed: event.target.checked } }))} /><span>Подтверждаю режим для этих ранних запусков.</span></label>
          </div>}
        </div>
      </section>

      <section className={`submission-card submission-readiness ${ready ? 'is-ready' : ''}`} aria-labelledby={`${fieldId}-readiness-title`}>
        <div className="submission-card-heading"><span className="submission-step">02</span><div><h2 id={`${fieldId}-readiness-title`}>Проверка перед выгрузкой</h2><p>Полнота набора, типы значений, оценки и ссылки на реплики.</p></div></div>
        <div className="submission-readiness-body">
          <div className="submission-loaded"><span>{dataset.toUpperCase()} · состав набора</span><strong>{checking ? '…' : loaded}<small> / {specification.expected}</small>{correctCount && <CheckCheck size={20} />}</strong></div>
          <div className="submission-progress" aria-hidden="true"><span className={loaded > specification.expected ? 'over-target' : ''} style={{ width: `${completion}%` }} /></div>
          <p className="submission-count-detail">Чаты: {counts?.chats || 0} / {specification.chats}<span />Звонки: {counts?.calls || 0} / {specification.calls}</p>
          <div className="submission-result-counts"><div><span>С AI-оценкой</span><strong>{checking ? '—' : counts?.ok || 0}</strong></div><div><span>С ошибкой в файле</span><strong>{checking ? '—' : counts?.error || 0}</strong></div><div><span>Нужна проверка</span><strong>{checking ? '—' : counts?.needsReview || 0}</strong></div></div>
          <div className={`submission-validation-state ${ready && !readyWithErrors ? 'is-ready' : ''}`} role="status" aria-live="polite">
            {checking ? <Spinner /> : ready && !readyWithErrors ? <ShieldCheck size={20} /> : <AlertCircle size={20} />}
            <div><strong>{checking ? 'Проверяем результаты…' : readyWithErrors ? counts?.error === counts?.total ? 'Формат готов. Все записи с ошибками' : 'Формат готов. Есть ошибки оценки' : ready ? 'Формат готов к выгрузке' : 'Нужно завершить подготовку'}</strong><p>{checking ? 'Сверяем исходные AI-оценки и все ID выбранного набора.' : ready ? counts?.error ? `В файл включены записи status: error — ${counts.error}. Их причины сохранятся вместе с ID.` : 'Все записи соответствуют JSON 1.0. Теперь можно сохранить results.json.' : current?.error || 'Исправьте замечания ниже, чтобы скачать официальный файл.'}</p></div>
          </div>
          {!!report?.issues.length && <div className="submission-blocking"><IssueList issues={report.issues.slice(0, 5)} />{report.issues.length > 5 && <details><summary>Все замечания ({report.issues.length})<ChevronDown size={14} /></summary><IssueList issues={report.issues.slice(5)} /></details>}</div>}
          {!!report?.warnings.length && <details className="submission-warnings"><summary><CircleHelp size={15} />На что обратить внимание ({report.warnings.length})<ChevronDown size={14} /></summary><IssueList issues={report.warnings} /></details>}
        </div>
      </section>
    </div>

    <section className="submission-card submission-results" aria-labelledby={`${fieldId}-rows-title`}>
      <div className="submission-card-heading"><div><h2 id={`${fieldId}-rows-title`}>Каждый ID на своём месте</h2><p>Для сдачи используем исходные AI-оценки до апелляций. Проверяем последнюю попытку на текущем транскрипте.</p></div><span className="submission-small-badge">{report?.rows.length || 0} записей</span></div>
      <div className="submission-results-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Найти ID в файле сдачи" placeholder="Поиск по conversation_id" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="submission-filter-label">Показать<select className="field" aria-label="Фильтр записей для сдачи" value={rowFilter} onChange={(event) => setRowFilter(event.target.value as RowFilter)}><option value="all">Все записи</option><option value="error">Записи с ошибками</option><option value="review">Требуют проверки</option></select></label></div>
      {!report?.rows.length ? <div className="submission-empty"><FileJson2 size={34} strokeWidth={1.4} /><h3>{groupId ? 'Готовим список диалогов' : 'Выберите набор для файла'}</h3><p>Здесь появится каждый исходный ID: с AI-оценкой или с явной причиной ошибки обработки.</p>{!groups.length && <button type="button" className="button secondary" onClick={onImport}><FileUp size={15} />Загрузить диалоги</button>}</div> : !rows.length ? <p className="submission-no-matches">Нет записей по этому запросу. Измените поиск или фильтр.</p> : <div className="table-scroll submission-table-scroll"><table className="submission-table"><thead><tr><th scope="col">Исходный ID диалога</th><th scope="col">Состояние</th><th scope="col">Итог</th><th scope="col">Сведения</th></tr></thead><tbody>{rows.map((row, index) => {
        const item = documentRows.get(row.conversationId);
        const total = item?.status === 'ok' ? item.score.final_score : null;
        return <tr key={`${row.id}-${index}`}>
          <td><button type="button" className="submission-id-button" onClick={() => onOpenConversation(row.id, row.evaluationId, !!row.evaluationId)}>{row.conversationId}<ArrowUpRight size={13} /></button></td>
          <td><span className={`submission-row-status submission-row-${row.kind} ${row.needsReview ? 'needs-review' : ''}`}><i />{rowLabel(row)}</span>{row.status === 'error' && <small className="submission-status-code">status: error</small>}</td>
          <td className="submission-row-score">{scoreText(total)}{item?.status === 'ok' && item.score.critical_flag && <span className="submission-critical" title="critical_flag: true">Грубая ошибка</span>}</td>
          <td><span className="submission-row-detail">{row.error || (row.needsReview ? 'В исходной оценке есть отметки для проверки.' : 'Все 8 критериев и основания включены.')}</span>{row.model && <small className="submission-row-model">{row.model}</small>}{row.issues.length > 0 && <details className="submission-row-issues"><summary>Замечания: {row.issues.length}</summary><IssueList issues={row.issues} /></details>}</td>
        </tr>;
      })}</tbody></table></div>}
      <div className="submission-table-note"><CircleHelp size={15} /><span>Ошибки и диалоги без AI-оценки остаются в файле с <code>criteria: []</code> и <code>score: null</code>. Ручная разметка не подменяет результат модели.</span></div>
    </section>

    <section className="submission-card submission-export" aria-labelledby={`${fieldId}-export-title`}>
      <div className="submission-export-main"><span className="submission-step">03</span><div className="submission-export-copy"><h2 id={`${fieldId}-export-title`}>Сохраните файл в репозиторий</h2><p>Путь от корня репозитория для выбранного набора:</p><div className="submission-file-path"><FileJson2 size={18} /><code>{specification.path}</code><button type="button" aria-label="Скопировать путь файла" title="Скопировать путь файла" onClick={() => copy(specification.path, 'Путь файла скопирован.')}><Copy size={15} /></button></div></div><button type="button" className="button primary submission-download" disabled={!ready} onClick={download}><Download size={17} />Скачать results.json</button></div>
      <div className="submission-export-footnote"><span><CheckCheck size={14} />UTF-8 · исходные ID · JSON 1.0</span><span>После сохранения нужны commit и push до стоп-кода.</span></div>
      <details className="submission-json"><summary><span><Code2 size={17} />Посмотреть JSON {report?.document && <small>{ready ? 'Проверен' : 'Черновик · есть замечания'}</small>}</span><ChevronDown size={16} /></summary>{report?.json ? <pre tabIndex={0} aria-label={`Предпросмотр JSON набора ${dataset.toUpperCase()}`}><code>{report.json}</code></pre> : <div className="submission-json-empty">JSON появится после выбора набора, названия команды и подтверждения сведений о модели.</div>}</details>
    </section>

    {feedback && <div className="submission-feedback" role="status"><Check size={16} /><span>{feedback}</span></div>}

    <div className="submission-reference-grid">
      <section className="submission-card submission-guide" aria-labelledby={`${fieldId}-guide-title`}>
        <div className="submission-card-heading"><div><span className="submission-section-eyebrow">ФИНИШНАЯ ПРЯМАЯ</span><h2 id={`${fieldId}-guide-title`}>Как сдать оба набора</h2></div><GitBranch size={23} strokeWidth={1.5} /></div>
        <ol className="submission-steps"><li><span>1</span><div><strong>Получите исходные диалоги</strong><p>Используйте API организаторов. Сохраните все исходные <code>conversation_id</code>.</p></div></li><li><span>2</span><div><strong>Выполните оценку</strong><p>По восемь критериев на диалог. Если оценка не удалась, сохраните ID и причину ошибки.</p></div></li><li><span>3</span><div><strong>Подготовьте два results.json</strong><p>DEV: 60 чатов и 5 звонков. PROD: ровно 10 контрольных чатов, включая ошибки.</p></div></li><li><span>4</span><div><strong>Сделайте commit и push</strong><p>Оба файла должны быть доступны в открытом репозитории по заранее переданной организаторам ссылке.</p></div></li></ol>
        <details className="submission-git-commands"><summary><Code2 size={16} />Команды Git после сохранения файлов<ChevronDown size={14} /></summary><pre tabIndex={0}><code>{GIT_COMMANDS}</code></pre><button type="button" className="button text-button small-button" onClick={() => copy(GIT_COMMANDS, 'Команды скопированы. Выполните их в своей копии репозитория после сохранения обоих файлов.')}><Copy size={14} />Скопировать команды</button></details>
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="submission-repository"><FolderGit2 size={18} /><span><strong>erassylls / doomsday</strong><small>Открыть репозиторий и проверить файлы</small></span><ArrowUpRight size={17} /></a>
        <p className="submission-guide-note"><Clock3 size={15} />Последний час включает получение набора, оценку, проверку и push. Локального файла или одного commit недостаточно.</p>
      </section>

      <section className="submission-card submission-format" aria-labelledby={`${fieldId}-format-title`}>
        <div className="submission-card-heading"><div><span className="submission-section-eyebrow">ПРАВИЛА JSON 1.0</span><h2 id={`${fieldId}-format-title`}>Восемь точных кодов</h2></div><ListChecks size={23} strokeWidth={1.5} /></div>
        <div className="table-scroll"><table className="submission-schema"><thead><tr><th scope="col">Критерий</th><th scope="col">Значение</th><th scope="col">Вес</th></tr></thead><tbody>{SUBMISSION_CRITERIA.map((criterion) => <tr key={criterion.id}><td><code>{criterion.id}</code><small>{criterion.name}</small></td><td><code>{criterion.kind === 'scale' ? [...criterion.levels].sort((a, b) => a - b).join(', ') : 'true / false'}{criterion.allowNA && ' / null'}</code></td><td>{criterion.kind === 'flag' ? '—' : criterion.weight}</td></tr>)}</tbody></table></div>
        <div className="submission-format-notes"><p><strong>Номера реплик с 1.</strong> <code>evidence_turns</code> учитывает весь исходный массив: клиента, оператора, бота и события.</p><p><strong>Шкала до веса.</strong> <code>dialogue: 7</code> — это 7 из 10 при весе 15. N/A исключает вес; итог округляется до двух знаков.</p><p><strong>Грубая ошибка — отдельный флаг.</strong> <code>critical_flag</code> совпадает со значением <code>critical</code> и не обнуляет балл.</p></div>
      </section>
    </div>
    <p className="submission-source">Основано на приложении «Сдача результатов оценки» к студенческому гайду Freedom Broker / CQA Hackathon. Формат JSON 1.0.</p>
  </div>;
}
