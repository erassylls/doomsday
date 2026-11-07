'use client';

import { useId, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CheckCheck, ChevronRight, FileText,
  ListChecks, MessageCircle, Moon, Quote, ShieldCheck, Upload,
} from 'lucide-react';
import { Modal } from './shared';
import './product-demo.css';

// A fictional, read-only interface example. It is never evaluated or persisted.
const DEMO_MESSAGES = [
  { id: 'demo-01', speaker: 'client', name: 'Клиент', time: '10:24', text: 'Здравствуйте! Где включить тёмную тему?' },
  { id: 'demo-02', speaker: 'operator', name: 'Анна · оператор', time: '10:24', text: 'Здравствуйте! Я Анна, помогу с настройками.' },
  { id: 'demo-03', speaker: 'operator', name: 'Анна · оператор', time: '10:25', text: 'Откройте «Настройки» → «Внешний вид» и выберите «Тёмная тема».' },
  { id: 'demo-04', speaker: 'client', name: 'Клиент', time: '10:25', text: 'Получилось, спасибо!' },
  { id: 'demo-05', speaker: 'operator', name: 'Анна · оператор', time: '10:26', text: 'Тёмная тема включена. Если понадобится помощь, обращайтесь. Хорошего дня!' },
] as const;

type DemoMessageId = typeof DEMO_MESSAGES[number]['id'];
interface DemoStep {
  label: string;
  caption: string;
  criterion: string;
  rule: string;
  explanation: string;
  evidenceIndex: 1 | 2 | 4;
  contextIds: readonly DemoMessageId[];
  icon: typeof MessageCircle;
}

const DEMO_STEPS: readonly DemoStep[] = [
  {
    label: 'Контакт', caption: 'С первого ответа', icon: MessageCircle,
    criterion: 'Установление контакта',
    rule: 'Оператор поздоровался на языке клиента и представился в первом ответе.',
    explanation: 'Клиент написал по-русски. В первой реплике оператор отвечает на том же языке и называет своё имя.',
    evidenceIndex: 1, contextIds: ['demo-01'],
  },
  {
    label: 'Консультация', caption: 'Понятные действия', icon: ListChecks,
    criterion: 'Корректная и полная консультация',
    rule: 'Все существенные вопросы закрыты или дан корректный следующий шаг.',
    explanation: 'В этом вымышленном сценарии оператор объясняет последовательность действий. Следующая реплика клиента подтверждает, что задача решена.',
    evidenceIndex: 2, contextIds: ['demo-01', 'demo-04'],
  },
  {
    label: 'Завершение', caption: 'Понятный итог', icon: CheckCheck,
    criterion: 'Завершение',
    rule: 'Оператор подвёл итог или предложил дальнейшую помощь и попрощался.',
    explanation: 'В финальной реплике есть итог разговора, предложение дальнейшей помощи и прощание. Все три элемента видны в тексте.',
    evidenceIndex: 4, contextIds: ['demo-04'],
  },
];

export function ProductDemo({ onClose, onImport }: { onClose: () => void; onImport?: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const id = useId();
  const step = DEMO_STEPS[activeIndex];
  const evidence = DEMO_MESSAGES[step.evidenceIndex];
  const StepIcon = step.icon;
  const transcriptId = `${id}-transcript`;
  const insightId = `${id}-insight`;
  const insightTitleId = `${id}-insight-title`;

  function openImport() {
    onClose();
    onImport?.();
  }

  return <Modal title="Посмотрите, как устроена оценка" subtitle="Один разговор. Три понятных шага." onClose={onClose} wide>
    <div className="demo-shell">
      <section className="demo-intro" aria-label="О демонстрации">
        <div className="demo-intro-copy">
          <span className="demo-label"><span className="demo-label-dot" aria-hidden="true" />Демонстрация интерфейса · вымышленный диалог</span>
          <h3 className="demo-title">У каждого вывода<br />есть основание.</h3>
          <p className="demo-description">Выберите этап разговора, чтобы увидеть правило и реплику, которая его подтверждает.</p>
        </div>
        <div className="demo-boundary">
          <span className="demo-boundary-icon"><ShieldCheck size={22} strokeWidth={1.7} aria-hidden="true" /></span>
          <p>Без AI-запроса и сохранения в рабочую базу</p>
          <span className="demo-boundary-caption">Можно изучать свободно</span>
        </div>
      </section>

      <nav className="demo-steps" aria-label="Шаги демонстрации">
        {DEMO_STEPS.map((item, index) => {
          const Icon = item.icon;
          return <button
            key={item.label}
            type="button"
            className="demo-step"
            aria-pressed={activeIndex === index}
            aria-controls={`${transcriptId} ${insightId}`}
            data-autofocus={index === 0 ? 'true' : undefined}
            onClick={() => setActiveIndex(index)}
          >
            <span className="demo-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="demo-step-copy"><strong>{item.label}</strong><small>{item.caption}</small></span>
            <Icon className="demo-step-icon" size={19} strokeWidth={1.8} aria-hidden="true" />
          </button>;
        })}
      </nav>

      <p className="demo-sr-only" role="status" aria-live="polite" aria-atomic="true">
        Шаг {activeIndex + 1} из {DEMO_STEPS.length}. {step.label}. Точная цитата: {evidence.text} {step.explanation}
      </p>

      <div className="demo-layout">
        <section className="demo-chat-card" id={transcriptId} aria-labelledby={`${id}-chat-title`}>
          <header className="demo-chat-heading">
            <span className="demo-chat-symbol"><Moon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
            <div className="demo-chat-heading-copy"><span className="demo-kicker">Разговор целиком</span><h3 id={`${id}-chat-title`}>Как включить тёмную тему</h3></div>
            <span className="demo-language">RU</span>
          </header>
          <ol className="demo-conversation" aria-label="Реплики вымышленного диалога">
            {DEMO_MESSAGES.map((message, index) => {
              const isEvidence = message.id === evidence.id;
              const isContext = step.contextIds.includes(message.id);
              return <li
                className={`demo-message demo-message-${message.speaker}`}
                data-highlight={isEvidence ? 'evidence' : isContext ? 'context' : undefined}
                key={message.id}
              >
                <div className="demo-message-meta">
                  <span className="demo-message-index" aria-label={`Реплика ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{message.name}</strong>
                  {isEvidence && <Quote size={12} className="demo-message-proof-icon" aria-label="Цитата выбранного шага" />}
                  <time>{message.time}</time>
                </div>
                <p className="demo-message-text">{isEvidence ? <mark className="demo-inline-quote">{message.text}</mark> : message.text}</p>
              </li>;
            })}
          </ol>
          <p className="demo-chat-legend"><span className="demo-legend-swatch" aria-hidden="true" />Цитата выделена цветом, связанные реплики — рамкой</p>
        </section>

        <section className="demo-insight" id={insightId} aria-labelledby={insightTitleId}>
          <header className="demo-insight-heading">
            <span className="demo-insight-symbol"><StepIcon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
            <div><span className="demo-kicker">Что проверяем</span><h3 id={insightTitleId}>{step.criterion}</h3></div>
          </header>
          <div className="demo-rule">
            <span className="demo-section-label"><FileText size={13} aria-hidden="true" />Правило критерия</span>
            <p>{step.rule}</p>
          </div>
          <div className="demo-proof">
            <div className="demo-proof-heading"><span><Quote size={15} aria-hidden="true" />Точная цитата</span><small>Реплика {String(step.evidenceIndex + 1).padStart(2, '0')}</small></div>
            <blockquote className="demo-quote"><p>{evidence.text}</p></blockquote>
          </div>
          <div className="demo-explanation">
            <span className="demo-section-label">Почему это основание</span>
            <p>{step.explanation}</p>
          </div>
          <div className="demo-insight-note"><ChevronRight size={15} aria-hidden="true" /><span>Так можно проверить каждый вывод по исходному разговору.</span></div>
        </section>
      </div>
    </div>

    <div className="demo-footer">
      <div className="demo-pagination" role="group" aria-label="Переход между шагами">
        <button type="button" className="demo-navigation-button" disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))} aria-label="Предыдущий шаг">
          <ArrowLeft size={16} aria-hidden="true" /><span>Назад</span>
        </button>
        <span className="demo-step-count">Шаг <strong>{activeIndex + 1}</strong> из {DEMO_STEPS.length}</span>
        <button type="button" className="demo-navigation-button" disabled={activeIndex === DEMO_STEPS.length - 1} onClick={() => setActiveIndex((index) => Math.min(DEMO_STEPS.length - 1, index + 1))} aria-label="Следующий шаг">
          <span>Далее</span><ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      {onImport ? <button type="button" className="demo-action-button" onClick={openImport} aria-label="Закрыть пример и открыть загрузку диалогов"><Upload size={16} aria-hidden="true" />Загрузить свои диалоги</button>
        : <button type="button" className="demo-action-button" onClick={onClose}>Закрыть пример<CheckCheck size={17} aria-hidden="true" /></button>}
    </div>
  </Modal>;
}
