'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal, KeyRound, Eye, EyeOff, Save, LockKeyhole, BookOpen, Coins, Plug, ArrowUpRight } from 'lucide-react';
import type { ProviderSettings } from '@/lib/types';
import { api, Pill, Spinner, Toggle } from './shared';

export function SettingsPanel({ settings, apiKey, setApiKey, providerConfigured, onSaved }: {
  settings: ProviderSettings; apiKey: string; setApiKey: (key: string) => void;
  providerConfigured: boolean; onSaved: () => void;
}) {
  const [form, setForm] = useState<ProviderSettings>({ ...settings });
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm({ ...settings }); }, [settings.baseUrl, settings.model, settings.inputPrice, settings.outputPrice, settings.strictJson, settings.verification, settings.knowledge]);
  function update(update: Partial<ProviderSettings>) { setForm((current) => ({ ...current, ...update })); setSaved(false); }
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      await api('/api/settings', { ...form, baseUrl: form.baseUrl.trim().replace(/\/+$/, ''), model: form.model.trim() });
      setSaved(true); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить настройки.'); }
    finally { setBusy(false); }
  }
  return <div className="page-stack settings-page">
    <div className="page-heading">
      <div><div className="eyebrow">Под ваше решение</div><h1>Настройки оценки</h1><p>Подключите модель и добавьте проверенные правила компании.</p></div>
      <button className="button primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={16} />}Сохранить настройки</button>
    </div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {saved && <div className="notice notice-success" role="status">Настройки сохранены. Ключ API остаётся только в памяти этой вкладки.</div>}
    <div className="settings-layout">
      <div className="settings-main">
        <section className="panel settings-card">
          <div className="panel-heading"><div className="heading-with-icon"><span className="soft-icon"><Plug size={20} /></span><div><h2>Подключение модели</h2><p>API, совместимый с Chat Completions</p></div></div><Pill tone={providerConfigured || apiKey ? 'green' : 'amber'}>{providerConfigured ? 'Ключ на сервере' : apiKey ? 'Ключ в этой вкладке' : 'Нужен ключ'}</Pill></div>
          <div className="settings-card-body">
            <label className="form-field">Адрес API<input className="field" value={form.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" type="url" autoComplete="off" /><small>Базовый адрес без /chat/completions. Для размещённого приложения используйте HTTPS.</small></label>
            <label className="form-field">Модель<input className="field" value={form.model} onChange={(event) => update({ model: event.target.value })} placeholder="Введите ID модели у вашего провайдера" spellCheck={false} autoComplete="off" /><small>Доступность модели проверяется при запуске оценки.</small></label>
            <label className="form-field">Ключ API<span className="password-wrap"><input className="field" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setSaved(false); }} type={showKey ? 'text' : 'password'} placeholder={providerConfigured ? 'Можно использовать серверный ключ' : 'Вставьте ключ вашего провайдера'} autoComplete="off" spellCheck={false} name="cqa_session_key" /><button type="button" className="icon-button" aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></span><small>Ключ не сохраняется в базе или браузерном хранилище. После обновления страницы введите его снова.</small></label>
            {apiKey && <button type="button" className="button text-button small-button" onClick={() => setApiKey('')}><KeyRound size={14} />Очистить ключ в этой вкладке</button>}
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading"><div className="heading-with-icon"><span className="soft-icon"><SlidersHorizontal size={20} /></span><div><h2>Контроль результата</h2><p>Формат ответа и дополнительная проверка</p></div></div></div>
          <div className="settings-card-body toggle-settings">
            <Toggle checked={form.strictJson} onChange={(value) => update({ strictJson: value })} title="Строгая JSON-схема" description="Модель возвращает результат по заданной структуре. Отключите, если провайдер поддерживает только JSON-режим." />
            <Toggle checked={form.verification} onChange={(value) => update({ verification: value })} title="Независимая проверка оценки" description="Второй анализ не видит первый ответ. При расхождении исходная оценка сохраняется и помечается для эксперта. Увеличивает время и стоимость." />
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading"><div className="heading-with-icon"><span className="soft-icon"><BookOpen size={20} /></span><div><h2>Знания о компании</h2><p>Подтверждённый контекст для консультаций</p></div></div><Pill tone="neutral">Необязательно</Pill></div>
          <div className="settings-card-body">
            <label className="form-field">Правила, тарифы и процедуры<textarea className="field knowledge-field" rows={9} value={form.knowledge} onChange={(event) => update({ knowledge: event.target.value })} placeholder={'Добавьте подтверждённую информацию, на которую должна опираться модель.\n\nНапример: название процедуры, условия её применения, официальный источник и дата актуальности.'} /><small>Реплики операторов в DEV не считаются справочником правильных ответов. Добавляйте только проверенные сведения.</small></label>
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading"><div className="heading-with-icon"><span className="soft-icon"><Coins size={20} /></span><div><h2>Расчёт стоимости</h2><p>По использованным токенам всех вызовов</p></div></div><Pill tone="neutral">Необязательно</Pill></div>
          <div className="settings-card-body">
            <div className="form-grid"><label className="form-field">Вход · USD за 1 млн токенов<input className="field" type="number" min={0} step="any" value={form.inputPrice ?? ''} placeholder="Не задано" onChange={(event) => update({ inputPrice: event.target.value === '' ? null : Number(event.target.value) })} /></label><label className="form-field">Выход · USD за 1 млн токенов<input className="field" type="number" min={0} step="any" value={form.outputPrice ?? ''} placeholder="Не задано" onChange={(event) => update({ outputPrice: event.target.value === '' ? null : Number(event.target.value) })} /></label></div>
            <p className="small muted">Укажите актуальные тарифы выбранного провайдера. Это приблизительная оценка без скидок, кеширования и иных условий тарификации.</p>
          </div>
        </section>
      </div>
      <aside className="settings-aside">
        <div className="panel aside-note"><LockKeyhole size={24} /><h3>Ключ остаётся у вас</h3><p>Приложение передаёт ключ серверу только для выполнения оценки. В историю попадают результат, название модели и расход токенов.</p></div>
        <div className="aside-note plain-note"><h3>Своя модель</h3><p>Локальную LLM можно подключить через доступный серверу HTTPS API с публичным доменом. Прямой адрес localhost в этой версии не поддерживается.</p></div>
        <a className="docs-link" href="https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" target="_blank" rel="noreferrer">Формат Chat Completions<ArrowUpRight size={15} /></a>
      </aside>
    </div>
  </div>;
}
