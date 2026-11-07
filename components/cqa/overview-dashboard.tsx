'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Check, CheckCheck, ClipboardCheck, FileUp, Globe2, Headphones, ListChecks, MessageSquare, MessagesSquare, Play, Plug, Quote, Scale, ShieldAlert, Sparkles, Target, UserRoundCheck } from 'lucide-react';
import type { AppState, Checklist, Evaluation } from '@/lib/types';
import { conversationTitle, scoreText, Spinner } from './shared';
import { ProductDemo } from './product-demo';
import './overview-dashboard.css';

interface OverviewDashboardProps {
  state: AppState;
  latest: ReadonlyMap<string, Evaluation | undefined>;
  activeChecklist?: Checklist;
  ready: boolean;
  evaluatingId: string | null;
  onImport: () => void;
  onDialogs: () => void;
  onReview: () => void;
  onAccuracy: () => void;
  onSubmission: () => void;
  onAppeals: () => void;
  onSettings: () => void;
  onChecklist: () => void;
  onOpenConversation: (id: string) => void;
}

const languages = [{ code: 'RU', name: 'Русский' }, { code: 'KZ', name: 'Қазақша' }, { code: 'EN', name: 'English' }] as const;
const countText = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
function countNoun(value: number, forms: readonly [string, string, string]): string {
  const lastTwo = Math.abs(value) % 100;
  const last = lastTwo % 10;
  return `${countText(value)} ${forms[lastTwo >= 11 && lastTwo <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`;
}

export function OverviewDashboard({ state, latest, activeChecklist, ready, evaluatingId, onImport, onDialogs, onReview, onAccuracy, onSubmission, onAppeals, onSettings, onChecklist, onOpenConversation }: OverviewDashboardProps) {
  const [demoOpen, setDemoOpen] = useState(false);
  const conversations = state.conversations;
  const evaluated = conversations.map((conversation) => latest.get(conversation.id)).filter((item): item is Evaluation => !!item);
  const numeric = evaluated.filter((item) => item.score.total !== null && Number.isFinite(item.score.total));
  const average = numeric.length ? numeric.reduce((sum, item) => sum + item.score.total!, 0) / numeric.length : null;
  const coverage = conversations.length ? evaluated.length / conversations.length * 100 : null;
  const reviewCount = evaluated.filter((item) => item.results.some((result) => result.needsReview)).length;
  const pendingAppeals = state.appeals.filter((item) => item.status === 'pending');
  const pendingConversationIds = new Set(pendingAppeals.map((item) => item.conversationId));
  const aiCount = evaluated.filter((item) => item.source === 'ai').length;
  const chatCount = conversations.filter((item) => item.channel === 'agent chat').length;
  const readySteps = Number(conversations.length > 0) + Number(!!activeChecklist) + Number(ready);
  const recent = useMemo(() => [...conversations].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 5), [conversations]);
  const languageCounts = languages.map((language) => ({ ...language, count: conversations.filter((item) => item.language === language.code).length }));

  return <>
    <div className="studio-overview">
      <section className="studio-hero" aria-labelledby="studio-overview-title">
        <div className="studio-hero-copy">
          <div className="studio-hero-eyebrow"><span />CQA STUDIO<span className="studio-eyebrow-divider" />ОБЗОР КАЧЕСТВА</div>
          <h1 id="studio-overview-title">Каждый разговор.<br /><span>Ясная оценка.</span></h1>
          <p className="studio-hero-description">От реплики к доказательству. От оценки к решению.<br className="studio-desktop-break" /> Весь процесс контроля качества — в одном месте.</p>
          <div className="studio-hero-actions">
            <button className="studio-button studio-button-lime" onClick={onImport}><FileUp size={17} />Загрузить диалоги<ArrowUpRight size={17} /></button>
            <button className="studio-button studio-button-ghost" onClick={() => setDemoOpen(true)}><Play size={15} />Посмотреть пример</button>
          </div>
          <div className="studio-hero-footnotes"><span><Quote size={13} />Выводы с доказательствами</span><span><Globe2 size={13} />RU · KZ · EN</span></div>
        </div>

        <div className="studio-coverage">
          <div className="studio-coverage-caption"><span className="studio-coverage-dot" />Охват оценки</div>
          <div className="studio-coverage-figure" role="img" aria-label={coverage === null ? 'Охват оценки пока не рассчитан: диалоги не загружены.' : `Охват оценки: ${scoreText(coverage)}%. С оценкой: ${evaluated.length}. Всего диалогов: ${conversations.length}.`}>
            <svg viewBox="0 0 280 280" aria-hidden="true">
              <circle className="studio-ring-ticks" cx="140" cy="140" r="130" />
              <circle className="studio-ring-guide" cx="140" cy="140" r="89" />
              <circle className="studio-ring-track" cx="140" cy="140" r="110" />
              {coverage !== null && coverage > 0 && <circle className="studio-ring-value" cx="140" cy="140" r="110" pathLength="100" strokeDasharray={`${coverage} 100`} transform="rotate(-90 140 140)" />}
            </svg>
            <div className="studio-coverage-number" aria-hidden="true"><strong>{coverage === null ? '—' : Math.round(coverage)}{coverage !== null && <span>%</span>}</strong><span>{conversations.length ? 'диалогов с оценкой' : 'Ожидаем первый набор'}</span></div>
          </div>
          <div className="studio-coverage-legend"><span><i />С оценкой<strong>{countText(evaluated.length)}</strong></span><span><i />Всего диалогов<strong>{countText(conversations.length)}</strong></span></div>
          <p className="studio-coverage-note">Сохранённые оценки AI и эксперта</p>
        </div>
      </section>

      <div className="studio-metrics" aria-label="Показатели рабочего пространства">
        <Metric label="Всего диалогов" value={countText(conversations.length)} detail={`${countNoun(chatCount, ['чат', 'чата', 'чатов'])} · ${countNoun(conversations.length - chatCount, ['звонок', 'звонка', 'звонков'])}`} icon={<MessagesSquare size={19} />} />
        <Metric label="С оценкой" value={countText(evaluated.length)} detail={`AI: ${countText(aiCount)} · эксперт: ${countText(evaluated.length - aiCount)}`} icon={<ClipboardCheck size={19} />} />
        <Metric label="Средний балл" value={scoreText(average)} unit={average === null ? undefined : '/ 100'} detail={numeric.length ? `По последней оценке · ${countNoun(numeric.length, ['диалог', 'диалога', 'диалогов'])}` : 'Появится после первой оценки'} icon={<Activity size={19} />} />
        <Metric label="Открытые апелляции" value={countText(pendingAppeals.length)} detail={pendingAppeals.length ? 'Ожидают вашего решения' : 'Нет ожидающих рассмотрения'} icon={<Scale size={19} />} onClick={onAppeals} />
      </div>

      <section className="studio-submission-entry" aria-labelledby="submission-entry-title"><div><span className="studio-section-eyebrow">ФОРМАТ СДАЧИ · JSON 1.0</span><h2 id="submission-entry-title">От готовой оценки к results.json</h2><p>DEV: 60 чатов и 5 звонков. PROD: 10 контрольных чатов. Проверка состава, критериев и исходных ID перед отправкой в Git.</p></div><button className="studio-button studio-button-forest" onClick={onSubmission}>Подготовить результаты<ArrowUpRight size={17} /></button></section>

      <div className="studio-actions-grid">
        <button className="studio-action studio-review-action" onClick={onReview}>
          <span className={'studio-review-number ' + (reviewCount ? 'studio-review-active' : '')}>{countText(reviewCount)}</span>
          <span className="studio-action-copy"><strong>Очередь проверки</strong><span>{reviewCount ? 'Диалоги с неопределённостью или расхождением оценок.' : 'Отмеченных диалогов пока нет. Здесь появятся спорные выводы.'}</span></span>
          <span className="studio-action-arrow"><ArrowUpRight size={19} /></span>
        </button>
        <button className="studio-action studio-accuracy-action" onClick={onAccuracy}>
          <span className="studio-accuracy-symbol"><Target size={30} strokeWidth={1.35} /></span>
          <span className="studio-action-copy"><span className="studio-action-eyebrow">ТОЧНОСТЬ AI</span><strong>Сравните AI с экспертом</strong><span>Выберите эталоны и разберите расхождения.</span></span>
          <span className="studio-action-arrow"><ArrowUpRight size={19} /></span>
        </button>
      </div>

      <div className="studio-workspace-grid">
        <section className="studio-card studio-recent">
          <div className="studio-card-heading"><div><span className="studio-section-eyebrow">РАБОЧИЙ ПРОЦЕСС</span><h2>Последние диалоги</h2></div><button className="studio-text-button" onClick={onDialogs}>Все диалоги<ArrowUpRight size={16} /></button></div>
          {!recent.length ? <div className="studio-empty">
            <div className="studio-empty-art" aria-hidden="true"><div className="studio-empty-sheet"><MessageSquare size={19} /><i /><i /><i /></div><span className="studio-empty-upload"><FileUp size={23} strokeWidth={1.65} /></span><span className="studio-empty-orbit" /></div>
            <h3>Первый разговор — первый инсайт</h3><p>Добавьте набор из API или JSON-файл.<br />Здесь появятся ваши диалоги и результаты.</p>
            <button className="studio-text-button" onClick={onImport}>Добавить диалоги<ArrowRight size={16} /></button>
          </div> : <ol className="studio-conversations">
            {recent.map((conversation) => {
              const evaluation = latest.get(conversation.id);
              const reviewing = evaluation?.results.some((item) => item.needsReview);
              const pending = pendingConversationIds.has(conversation.id);
              const running = evaluatingId === conversation.id;
              const label = running ? 'Оцениваем' : pending ? 'Апелляция' : reviewing ? 'Проверить' : evaluation?.source === 'ai' ? 'AI-оценка' : evaluation ? 'Эксперт' : 'Без оценки';
              const tone = pending || reviewing ? 'amber' : evaluation ? 'green' : 'neutral';
              return <li key={conversation.id}><button className="studio-conversation-row" onClick={() => onOpenConversation(conversation.id)} aria-label={`Открыть диалог ${conversation.conversation_id}: ${label}`}>
                <span className={'studio-conversation-icon ' + (conversation.channel === 'voice call' ? 'studio-voice-icon' : '')}>{conversation.channel === 'voice call' ? <Headphones size={19} /> : <MessageSquare size={19} />}</span>
                <span className="studio-conversation-copy"><strong>{conversationTitle(conversation)}</strong><span>{conversation.conversation_id}<i />{conversation.dataset_group_id}<i />{conversation.language}</span></span>
                <span className={'studio-status studio-status-' + tone}>{running ? <Spinner /> : <i />}{label}</span>
                <span className="studio-conversation-score" aria-label={evaluation?.score.total !== null && evaluation?.score.total !== undefined ? `Итоговый балл ${scoreText(evaluation.score.total)} из 100` : 'Балла пока нет'}>{scoreText(evaluation?.score.total)}{evaluation?.score.critical && <ShieldAlert size={13} aria-label="Грубая ошибка" />}</span>
                <ArrowUpRight className="studio-row-arrow" size={16} />
              </button></li>;
            })}
          </ol>}
          <div className="studio-language-summary">
            <div className="studio-language-heading"><span><Globe2 size={14} />Языки диалогов</span><span>{countText(conversations.length)} всего</span></div>
            <div className="studio-language-track" role="img" aria-label={languageCounts.map((language) => `${language.name}: ${language.count}`).join(', ')}>{languageCounts.map((language) => <span className={'studio-language-segment studio-segment-' + language.code.toLowerCase()} key={language.code} style={{ width: (conversations.length ? language.count / conversations.length * 100 : 0) + '%' }} />)}</div>
            <div className="studio-language-counts">{languageCounts.map((language) => <span key={language.code}><i className={'studio-language-key studio-segment-' + language.code.toLowerCase()} />{language.name}<strong>{countText(language.count)}</strong></span>)}</div>
          </div>
        </section>

        <aside className="studio-readiness-column">
          <section className="studio-card studio-readiness">
            <div className="studio-card-heading"><div><span className="studio-section-eyebrow">СЛЕДУЮЩИЙ ШАГ</span><h2>Готовность к оценке</h2></div><span className="studio-readiness-count" aria-label={`Выполнено ${readySteps} из 3 условий`}>{readySteps}<span>/3</span></span></div>
            <div className="studio-readiness-steps">
              <ReadinessStep number="01" label="Загрузите диалоги" detail={conversations.length ? `${countText(conversations.length)} в рабочем пространстве` : 'Набор из API или JSON-файл'} done={conversations.length > 0} onClick={onImport} />
              <ReadinessStep number="02" label="Правила оценки" detail={activeChecklist ? `${countNoun(activeChecklist.criteria.length, ['критерий', 'критерия', 'критериев'])} · версия ${activeChecklist.version}` : 'Создайте правила оценки'} done={!!activeChecklist} onClick={onChecklist} />
              <ReadinessStep number="03" label="Подключите модель" detail={ready ? state.settings.model : 'Укажите модель и API-ключ'} done={ready} onClick={onSettings} />
            </div>
            <div className="studio-model-status"><Plug size={16} /><span>{ready ? 'Настройки модели заполнены.' : 'Модель ещё не подключена.'}<small>{ready ? 'Доступ проверяется при AI-запуске.' : 'Для AI-оценки нужны модель и ключ.'}</small></span></div>
            <button className="studio-button studio-button-forest" onClick={onSettings}>{ready ? 'Настройки модели' : 'Подключить модель'}<ArrowRight size={16} /></button>
            <p className="studio-manual-note"><UserRoundCheck size={14} />Оценка эксперта доступна без AI.</p>
          </section>
          <button className="studio-standard" onClick={onChecklist}><span><ListChecks size={21} /></span><span><strong>Ваш стандарт качества</strong><small>Критерии, веса и история версий</small></span><ArrowUpRight size={17} /></button>
        </aside>
      </div>

      <div className="studio-overview-footnote"><CheckCheck size={15} /><span>Каждое решение сохраняется вместе с правилами, по которым оно принято.</span><Sparkles size={14} /></div>
    </div>
    {demoOpen && <ProductDemo onClose={() => setDemoOpen(false)} onImport={() => { setDemoOpen(false); onImport(); }} />}
  </>;
}

function Metric({ label, value, unit, detail, icon, onClick }: { label: string; value: string; unit?: string; detail: string; icon: ReactNode; onClick?: () => void }) {
  const content = <><span className="studio-metric-label">{label}<span>{icon}</span></span><strong className="studio-metric-value">{value}{unit && <span>{unit}</span>}</strong><span className="studio-metric-detail">{detail}{onClick && <ArrowUpRight size={13} />}</span></>;
  return onClick ? <button className="studio-metric studio-metric-button" onClick={onClick}>{content}</button> : <section className="studio-metric" aria-label={label}>{content}</section>;
}

function ReadinessStep({ number, label, detail, done, onClick }: { number: string; label: string; detail: string; done: boolean; onClick: () => void }) {
  return <button className={'studio-readiness-step ' + (done ? 'studio-step-done' : '')} onClick={onClick}><span className="studio-step-number">{done ? <Check size={15} /> : number}<span className="visually-hidden">{done ? 'Выполнено' : 'Требуется действие'}</span></span><span className="studio-step-copy"><strong>{label}</strong><span>{detail}</span></span><ArrowUpRight size={14} /></button>;
}
