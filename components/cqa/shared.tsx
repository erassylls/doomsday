'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, ArrowUpRight, MessageSquare, Phone, Check } from 'lucide-react';
import type { Conversation, Criterion, Evaluation, Rating } from '@/lib/types';

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Не удалось выполнить запрос. Код ' + response.status + '.');
  return payload as T;
}

export function ratingLabel(value: Rating | null | undefined): string {
  if (value === 'yes') return 'Да';
  if (value === 'no') return 'Нет';
  if (value === 'na') return 'N/A';
  if (value === undefined || value === null) return '—';
  return String(value);
}

export function ratingTone(value: Rating, criterion: Criterion): string {
  if (value === 'na') return 'neutral';
  if (criterion.kind === 'flag') return value === 'yes' ? 'danger' : 'green';
  if (value === 'yes') return 'green';
  if (value === 'no' || value === 0) return 'amber';
  return 'blue';
}

export function ratingOptions(criterion: Criterion): { value: string; label: string }[] {
  const options = criterion.kind === 'scale'
    ? [...criterion.levels].sort((a, b) => b.value - a.value).map((level) => ({
      value: String(level.value), label: level.value + ' — ' + level.label,
    }))
    : [{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }];
  if (criterion.allowNA) options.push({ value: 'na', label: 'N/A — не применимо' });
  return options;
}

export function parseRating(value: string): Rating {
  return value === 'yes' || value === 'no' || value === 'na' ? value : Number(value);
}

export function scoreText(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

export function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qyzylorda',
  }).format(date);
}

export function conversationTitle(conversation: Conversation): string {
  return conversation.transcript.find((message) => message.speaker === 'client')?.text || 'Диалог без запроса клиента';
}

export function latestFor(conversationId: string, evaluations: Evaluation[]): Evaluation | undefined {
  return evaluations
    .filter((evaluation) => evaluation.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export const speakerLabels: Record<string, string> = {
  operator: 'Оператор', client: 'Клиент', bot: 'Бот', system: 'Система',
};

export function Pill({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: string; dot?: boolean }) {
  return <span className={'pill pill-' + tone}>{dot && <span className="pill-dot" />}{children}</span>;
}

export function Channel({ conversation }: { conversation: Conversation }) {
  return <span className="channel">{conversation.channel === 'voice call' ? <Phone size={14} /> : <MessageSquare size={14} />}{conversation.channel === 'voice call' ? 'Звонок' : 'Чат'}</span>;
}

export function Spinner({ text }: { text?: string }) {
  return <span className="inline-spinner"><LoaderCircle size={17} className="spin" />{text}</span>;
}

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode; title: string; description: string; action?: ReactNode;
}) {
  return <div className="empty-state">
    <div className="empty-icon">{icon}</div>
    <h3>{title}</h3>
    <p>{description}</p>
    {action && <div className="empty-actions">{action}</div>}
  </div>;
}

export function Modal({ title, subtitle, children, onClose, wide = false, busy = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const getFocusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"], audio[controls], video[controls]',
    ) || [])].filter((element) => !element.matches(':disabled')
      && !(element.hasAttribute('tabindex') && Number(element.getAttribute('tabindex')) < 0)
      && !element.closest('[inert]')
      && element.getClientRects().length > 0
      && window.getComputedStyle(element).visibility === 'visible');
    const focusInside = (last = false) => {
      const focusable = getFocusable();
      const target = (last ? focusable.at(-1) : focusable[0]) || dialogRef.current;
      target?.focus({ preventScroll: true });
    };
    const timer = window.setTimeout(() => {
      if (dialogRef.current?.contains(document.activeElement)) return;
      const preferred = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      if (preferred && getFocusable().includes(preferred)) preferred.focus({ preventScroll: true });
      else focusInside();
    }, 10);
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!first || !active || !focusable.includes(active)) {
        event.preventDefault();
        focusInside(event.shiftKey);
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocus = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog?.isConnected && !dialog.contains(event.target as Node)) focusInside();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', handleFocus);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', handleFocus);
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      if (!busy) onClose();
    }
  }}>
    <div className={'modal ' + (wide ? 'modal-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined} aria-busy={busy || undefined} tabIndex={-1} ref={dialogRef}>
      <div className="modal-heading">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p id={subtitleId}>{subtitle}</p>}</div>
        <button type="button" className="icon-button" aria-label="Закрыть окно" onClick={onClose} disabled={busy}><X size={20} /></button>
      </div>
      {children}
    </div>
  </div>;
}

export function Toggle({ checked, onChange, title, description }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; description?: string;
}) {
  return <label className="toggle-row">
    <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="switch-input" />
    <span className={'switch ' + (checked ? 'is-on' : '')} aria-hidden="true"><span>{checked && <Check size={10} />}</span></span>
  </label>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return null;
  return <a href={href} target="_blank" rel="noreferrer" className="text-link">{children}<ArrowUpRight size={14} /></a>;
}

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
