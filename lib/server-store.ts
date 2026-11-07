import { env } from 'cloudflare:workers';
import { DEFAULT_CHECKLIST, validateChecklist } from './rubric';
import { calculateScore, validateResults } from './scoring';
import { EVALUATOR_REVISION, EvaluationError, evaluateConversation } from './evaluator';
import { DEFAULT_SETTINGS } from './types';
import type {
  Appeal, AppState, Checklist, Conversation, Criterion, CriterionResult,
  Evaluation, EvaluationFailure, Language, Message, ModelMode, ProviderSettings, Rating, Speaker, Usage,
} from './types';

type JsonObject = Record<string, unknown>;
type PayloadRow = { payload: string };
type ConversationRow = PayloadRow & { content_hash: string };
type EvaluationRow = PayloadRow & { revision: number };
const runtime = env as Cloudflare.Env;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_IMPORT = 12 * 1024 * 1024;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'INVALID_REQUEST', public usage?: Usage) {
    super(message);
    this.name = 'ApiError';
  }
}

function database(): D1Database {
  if (!runtime.DB) throw new ApiError(503, 'Хранилище ещё не подключено. Требуется привязка D1 DB.', 'DATABASE_UNAVAILABLE');
  return runtime.DB;
}

function object(value: unknown, label = 'Запрос'): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, `${label}: ожидается JSON-объект.`);
  }
  return value as JsonObject;
}

function textValue(value: unknown, label: string, max = 4000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new ApiError(400, `${label}: требуется ${allowEmpty ? '' : 'непустая '}строка до ${max} символов.`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string, max = 240, preserve = false): string {
  const validated = textValue(value, label, max);
  const id = preserve ? value as string : validated;
  if (/[\u0000-\u001f\u007f]/.test(id)) throw new ApiError(400, `${label}: недопустимые управляющие символы.`);
  return id;
}

function groupName(value: unknown): string {
  const name = textValue(value, 'Набор данных', 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new ApiError(400, 'Имя набора может содержать латинские буквы, цифры, точку, дефис и подчёркивание.');
  }
  return name;
}

/** Only public HTTPS endpoints are accepted by a hosted instance. */
export function validateProviderUrl(value: unknown): string {
  const input = textValue(value, 'Адрес API модели', 1000);
  let url: URL;
  try { url = new URL(input); } catch { throw new ApiError(400, 'Укажите полный адрес API модели.'); }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, 'Адрес API не должен содержать пароль, параметры запроса или фрагмент.');
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new ApiError(400, 'Для размещённого приложения нужен HTTPS-адрес модели.');
  if (
    !hostname.includes('.') || hostname.includes(':') || hostname.startsWith('[') ||
    /^\d+(\.\d+){3}$/.test(hostname) ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(hostname) ||
    hostname === 'metadata.google.internal'
  ) {
    throw new ApiError(400, 'Используйте публичное доменное имя HTTPS API. Для локальной модели нужен доступный серверу HTTPS-шлюз.');
  }
  return url.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function assertSameOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  if (!origin) return; // CLI clients have no browser Origin; hosting still enforces access.
  let supplied: URL;
  try { supplied = new URL(origin); } catch { throw new ApiError(403, 'Недопустимый источник запроса.', 'ORIGIN_NOT_ALLOWED'); }
  if (supplied.host !== new URL(request.url).host) {
    throw new ApiError(403, 'Изменения разрешены только из этого приложения.', 'ORIGIN_NOT_ALLOWED');
  }
}

async function limitedText(source: Request | Response, maxBytes: number): Promise<string> {
  const declared = Number(source.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new ApiError(413, 'Файл или запрос превышает допустимый размер.', 'BODY_TOO_LARGE');
  if (!source.body) return '';
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'Файл или запрос превышает допустимый размер.', 'BODY_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

async function bodyObject(request: Request, maxBytes = MAX_BODY): Promise<JsonObject> {
  const raw = await limitedText(request, maxBytes);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError(400, 'Не удалось прочитать JSON запроса.', 'INVALID_JSON'); }
  return object(parsed);
}

export async function respond(request: Request, action: () => Promise<unknown>): Promise<Response> {
  try {
    assertSameOrigin(request);
    return json(await action());
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code, ...(error.usage ? { usage: error.usage } : {}) }, error.status);
    // Do not log request bodies, provider keys, signed dataset URLs or transcripts.
    console.error('CQA backend operation failed', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Не удалось выполнить операцию. Проверьте подключение хранилища и попробуйте ещё раз.', code: 'INTERNAL_ERROR' }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function setting<T>(key: string): Promise<T | null> {
  const row = await database().prepare('SELECT value FROM cqa_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : null;
}

async function ensureDefaults(): Promise<void> {
  const db = database();
  const now = new Date().toISOString();
  const checklist: Checklist = { ...DEFAULT_CHECKLIST, createdAt: now };
  const settings: ProviderSettings = {
    ...DEFAULT_SETTINGS,
    baseUrl: runtime.OPENAI_BASE_URL?.replace(/\/+$/, '') || DEFAULT_SETTINGS.baseUrl,
    model: runtime.OPENAI_MODEL || DEFAULT_SETTINGS.model,
  };
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO cqa_checklists (id, version, payload, created_at) VALUES (?, ?, ?, ?)')
      .bind(checklist.id, checklist.version, JSON.stringify(checklist), now),
    db.prepare('INSERT OR IGNORE INTO cqa_settings (key, value, updated_at) VALUES (?, ?, ?)')
      .bind('provider', JSON.stringify(settings), now),
    db.prepare('INSERT OR IGNORE INTO cqa_settings (key, value, updated_at) VALUES (?, ?, ?)')
      .bind('activeChecklistId', JSON.stringify(checklist.id), now),
  ]);
}

function serverKeyMatches(baseUrl: string): boolean {
  const configuredBase = (runtime.OPENAI_BASE_URL || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, '');
  return !!runtime.OPENAI_API_KEY && baseUrl.replace(/\/+$/, '') === configuredBase;
}

export async function loadState(): Promise<AppState> {
  await ensureDefaults();
  const db = database();
  const [conversationRows, checklistRows, evaluationRows, failureRows, appealRows, settings, active] = await Promise.all([
    db.prepare('SELECT payload FROM cqa_conversations ORDER BY dataset_group_id, id').all<PayloadRow>(),
    db.prepare('SELECT payload FROM cqa_checklists ORDER BY version DESC').all<PayloadRow>(),
    db.prepare('SELECT payload FROM cqa_evaluations ORDER BY created_at DESC, id DESC').all<PayloadRow>(),
    db.prepare('SELECT payload FROM cqa_evaluation_failures ORDER BY created_at DESC, id DESC').all<PayloadRow>(),
    db.prepare('SELECT payload FROM cqa_appeals ORDER BY created_at DESC, id DESC').all<PayloadRow>(),
    setting<ProviderSettings>('provider'),
    setting<string>('activeChecklistId'),
  ]);
  const currentSettings = { ...DEFAULT_SETTINGS, ...settings };
  return {
    conversations: conversationRows.results.map((row) => JSON.parse(row.payload)),
    checklists: checklistRows.results.map((row) => JSON.parse(row.payload)),
    activeChecklistId: active || DEFAULT_CHECKLIST.id,
    evaluations: evaluationRows.results.map((row) => JSON.parse(row.payload)),
    evaluationFailures: failureRows.results.map((row) => JSON.parse(row.payload)),
    appeals: appealRows.results.map((row) => JSON.parse(row.payload)),
    settings: currentSettings,
    providerConfigured: !!currentSettings.model.trim() && serverKeyMatches(currentSettings.baseUrl),
    datasetConfigured: !!runtime.DATASET_API_URL,
  };
}

function importEnvelope(payload: unknown): { records: unknown[]; groupId?: string } {
  if (Array.isArray(payload)) return { records: payload };
  const envelope = object(payload, 'Файл набора');
  if ('isSuccess' in envelope && envelope.isSuccess !== true) {
    throw new ApiError(400, 'Источник вернул неуспешный ответ. Диалоги не импортированы.', 'DATASET_ERROR');
  }
  const data = 'data' in envelope ? object(envelope.data, 'data') : envelope;
  if (!Array.isArray(data.records)) throw new ApiError(400, 'Нужен массив records либо ответ API с data.records.');
  if ('total_records' in data && (typeof data.total_records !== 'number' || data.total_records !== data.records.length)) {
    throw new ApiError(400, 'Количество записей не совпадает с total_records. Проверьте полноту файла.');
  }
  return { records: data.records, groupId: data.dataset_group_id === undefined ? undefined : groupName(data.dataset_group_id) };
}

function normalizeConversation(raw: unknown, groupId: string, now: string): Conversation {
  const record = object(raw, 'Диалог');
  // The submission contract requires the exact source ID, including its whitespace.
  const externalId = identifier(record.conversation_id, 'conversation_id', 180, true);
  if (record.channel !== 'agent chat' && record.channel !== 'voice call') {
    throw new ApiError(400, `${externalId}: channel должен быть agent chat или voice call.`);
  }
  if (!['RU', 'KZ', 'EN'].includes(String(record.language))) {
    throw new ApiError(400, `${externalId}: language должен быть RU, KZ или EN.`);
  }
  if (!Array.isArray(record.transcript) || record.transcript.length === 0 || record.transcript.length > 3000) {
    throw new ApiError(400, `${externalId}: transcript должен быть массивом от 1 до 3000 реплик.`);
  }
  const transcript: Message[] = record.transcript.map((rawMessage, index) => {
    const message = object(rawMessage, `${externalId}, реплика ${index + 1}`);
    if (!['client', 'operator', 'bot', 'system'].includes(String(message.speaker))) {
      throw new ApiError(400, `${externalId}, реплика ${index + 1}: неизвестная роль.`);
    }
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 30000) {
      throw new ApiError(400, `${externalId}, реплика ${index + 1}: некорректный текст.`);
    }
    if (typeof message.timestamp !== 'string' || !message.timestamp.trim() || message.timestamp.length > 100) {
      throw new ApiError(400, `${externalId}, реплика ${index + 1}: требуется исходная метка времени.`);
    }
    return {
      id: `m${String(index + 1).padStart(4, '0')}`,
      timestamp: message.timestamp,
      speaker: message.speaker as Speaker,
      text: message.text,
    };
  });
  if (transcript.reduce((length, message) => length + message.text.length, 0) > 600000) {
    throw new ApiError(400, `${externalId}: слишком длинный транскрипт.`);
  }
  let audioUrl: string | null = null;
  if (record.audio_url !== null && record.audio_url !== undefined && record.audio_url !== '') {
    const candidate = textValue(record.audio_url, `${externalId}: audio_url`, 10000);
    let url: URL;
    try { url = new URL(candidate); } catch { throw new ApiError(400, `${externalId}: неверная ссылка на запись.`); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new ApiError(400, `${externalId}: ссылка на запись должна использовать HTTP или HTTPS.`);
    }
    audioUrl = candidate;
  }
  return {
    id: `${groupId}:${externalId}`, conversation_id: externalId, dataset_group_id: groupId,
    channel: record.channel, language: record.language as Language,
    transcript, audio_url: audioUrl, importedAt: now,
  };
}

function conversationContent(conversation: Conversation): unknown {
  const { importedAt: _importedAt, ...content } = conversation;
  return content;
}

export async function importDataset(request: Request): Promise<{ count: number; groupId: string }> {
  const body = await bodyObject(request, MAX_IMPORT);
  let payload: unknown;
  let requestedGroup: string | undefined;
  if (body.groupId !== undefined) requestedGroup = groupName(body.groupId);
  if ('payload' in body) {
    payload = body.payload;
  } else {
    if (!runtime.DATASET_API_URL) {
      throw new ApiError(409, 'API набора ещё не подключён. Загрузите JSON-файл или настройте DATASET_API_URL на сервере.', 'DATASET_NOT_CONFIGURED');
    }
    requestedGroup ||= 'DEV';
    const url = new URL(runtime.DATASET_API_URL);
    url.searchParams.set('group_id', requestedGroup);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      // Workers supports manual/follow, but throws before I/O for redirect: 'error'.
      // Keep the intended no-redirect policy explicitly, without forwarding a signed URL.
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel(); } catch { /* The redirect remains rejected. */ }
        throw new ApiError(502, 'API организаторов вернул перенаправление. Обновите адрес подключения на сервере и повторите импорт.', 'DATASET_REDIRECT_BLOCKED');
      }
      if (!response.ok) throw new ApiError(502, `API организаторов вернул HTTP ${response.status}. Повторите загрузку позже.`, 'DATASET_FETCH_FAILED');
      const raw = await limitedText(response, MAX_IMPORT);
      try { payload = JSON.parse(raw); } catch { throw new ApiError(502, 'API организаторов вернул некорректный JSON.', 'DATASET_FETCH_FAILED'); }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Diagnostic categories only: never write URLs, signatures, keys or raw causes to logs.
      const failure = error instanceof Error ? error : null;
      const cause = failure?.cause instanceof Error ? failure.cause : null;
      const combined = `${failure?.message || ''} ${cause?.message || ''}`;
      const safeAtom = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
      const causeCode = cause && 'code' in cause ? safeAtom(cause.code) : undefined;
      const category = /redirect/i.test(combined) ? 'redirect'
        : /certificate|\btls\b|\bssl\b/i.test(combined) ? 'tls'
          : /dns|ENOTFOUND|EAI_AGAIN/i.test(combined) ? 'dns'
            : /refused|ECONNREFUSED/i.test(combined) ? 'connection_refused'
              : /network|connection|fetch failed/i.test(combined) ? 'network'
                : 'unknown';
      console.error('CQA dataset network failure', {
        name: safeAtom(failure?.name), causeName: safeAtom(cause?.name), causeCode,
        category, timedOut: controller.signal.aborted,
      });
      throw new ApiError(502, 'Не удалось загрузить набор из API организаторов. Проверьте соединение или импортируйте JSON-файл.', 'DATASET_FETCH_FAILED');
    } finally { clearTimeout(timeout); }
  }
  const envelope = importEnvelope(payload);
  if (requestedGroup && envelope.groupId && requestedGroup !== envelope.groupId) {
    throw new ApiError(400, 'Имя набора в ответе не совпадает с запрошенным group_id.', 'DATASET_GROUP_MISMATCH');
  }
  const groupId = requestedGroup || envelope.groupId || 'UPLOAD';
  if (envelope.records.length === 0 || envelope.records.length > 500) {
    throw new ApiError(400, 'За один импорт допускается от 1 до 500 диалогов.');
  }
  const now = new Date().toISOString();
  const conversations = envelope.records.map((record) => normalizeConversation(record, groupId, now));
  if (new Set(conversations.map((conversation) => conversation.id)).size !== conversations.length) {
    throw new ApiError(400, 'В наборе повторяются conversation_id. Импорт отменён.', 'DUPLICATE_CONVERSATION');
  }
  const candidates = await Promise.all(conversations.map(async (conversation) => ({ conversation, contentHash: await hash(conversationContent(conversation)) })));
  await ensureDefaults();
  const db = database();
  const [stored, scored] = await Promise.all([
    db.prepare('SELECT id, content_hash FROM cqa_conversations WHERE dataset_group_id = ?').bind(groupId)
      .all<{ id: string; content_hash: string }>(),
    db.prepare('SELECT DISTINCT conversation_id FROM cqa_evaluations').all<{ conversation_id: string }>(),
  ]);
  const previous = new Map(stored.results.map((row) => [row.id, row.content_hash]));
  const evaluated = new Set(scored.results.map((row) => row.conversation_id));
  const protectedChanges = candidates.filter(({ conversation, contentHash }) => evaluated.has(conversation.id) && previous.get(conversation.id) !== contentHash);
  if (protectedChanges.length) {
    throw new ApiError(409, `Диалог ${protectedChanges[0].conversation.conversation_id} уже оценён. Для изменённого транскрипта используйте новый набор, чтобы сохранить доказательства.`, 'EVALUATED_TRANSCRIPT_IMMUTABLE');
  }
  const changes = candidates.filter(({ conversation, contentHash }) => previous.get(conversation.id) !== contentHash);
  if (changes.length) {
    const statements = changes.map(({ conversation, contentHash }) => db.prepare(`
      INSERT INTO cqa_conversations (id, dataset_group_id, content_hash, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET content_hash = excluded.content_hash, payload = excluded.payload, updated_at = excluded.updated_at
      WHERE cqa_conversations.content_hash = excluded.content_hash
        OR NOT EXISTS (SELECT 1 FROM cqa_evaluations WHERE conversation_id = excluded.id)
    `).bind(conversation.id, groupId, contentHash, JSON.stringify(conversation), now, now));
    const results = await db.batch(statements);
    if (results.some((result) => result.meta.changes === 0)) {
      throw new ApiError(409, 'Один из диалогов был оценён во время импорта и сохранён без изменения. Обновите список и импортируйте изменённые данные под новым именем набора.', 'CONCURRENT_IMPORT');
    }
  }
  return { count: conversations.length, groupId };
}

function normalizeCriteria(value: unknown): Criterion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new ApiError(400, 'Чек-лист должен содержать от 1 до 50 критериев.');
  }
  return value.map((raw) => {
    const criterion = object(raw, 'Критерий');
    const id = identifier(criterion.id, 'ID критерия', 100);
    const kind = criterion.kind;
    if (kind !== 'boolean' && kind !== 'scale' && kind !== 'flag') throw new ApiError(400, `${id}: неизвестный тип ответа.`);
    if (typeof criterion.weight !== 'number' || !Number.isFinite(criterion.weight) || criterion.weight < 0 || criterion.weight > 10000) {
      throw new ApiError(400, `${id}: вес должен быть числом от 0 до 10000.`);
    }
    if (typeof criterion.allowNA !== 'boolean') throw new ApiError(400, `${id}: укажите доступность N/A.`);
    if (!Array.isArray(criterion.levels) || criterion.levels.length > 30) throw new ApiError(400, `${id}: неверная шкала.`);
    return {
      id, name: textValue(criterion.name, 'Название критерия', 180),
      section: textValue(criterion.section, 'Секция', 180, true),
      description: textValue(criterion.description, 'Правило критерия', 10000),
      kind, weight: criterion.weight, allowNA: criterion.allowNA,
      naCondition: textValue(criterion.naCondition, 'Условие N/A', 5000, true),
      levels: criterion.levels.map((rawLevel) => {
        const level = object(rawLevel, 'Ступень шкалы');
        if (typeof level.value !== 'number' || !Number.isFinite(level.value) || level.value < 0 || level.value > 10000) {
          throw new ApiError(400, `${id}: ступень шкалы должна быть неотрицательным числом.`);
        }
        return { value: level.value, label: textValue(level.label, 'Описание ступени', 5000) };
      }),
    };
  });
}

export async function createChecklist(request: Request): Promise<Checklist> {
  const body = await bodyObject(request);
  const name = textValue(body.name, 'Название чек-листа', 180);
  const criteria = normalizeCriteria(body.criteria);
  const issues = validateChecklist(criteria);
  if (issues.length) throw new ApiError(400, issues.slice(0, 5).join(' '), 'INVALID_CHECKLIST');
  await ensureDefaults();
  const db = database();
  const max = await db.prepare('SELECT MAX(version) AS version FROM cqa_checklists').first<{ version: number | null }>();
  const version = (max?.version || 0) + 1;
  const createdAt = new Date().toISOString();
  const checklist: Checklist = { id: `checklist-${crypto.randomUUID()}`, name, version, criteria, createdAt };
  try {
    await db.batch([
      db.prepare('INSERT INTO cqa_checklists (id, version, payload, created_at) VALUES (?, ?, ?, ?)')
        .bind(checklist.id, version, JSON.stringify(checklist), createdAt),
      db.prepare('INSERT INTO cqa_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind('activeChecklistId', JSON.stringify(checklist.id), createdAt),
    ]);
  } catch {
    throw new ApiError(409, 'Чек-лист был одновременно обновлён. Обновите список версий и сохраните ещё раз.', 'CHECKLIST_CONFLICT');
  }
  return checklist;
}

function modelMode(value: unknown): ModelMode {
  if (value === undefined) return 'external_api';
  if (value !== 'local' && value !== 'external_api' && value !== 'hybrid') {
    throw new ApiError(400, 'Режим модели должен быть local, external_api или hybrid.', 'INVALID_MODEL_MODE');
  }
  return value;
}

function normalizeSettings(raw: JsonObject): ProviderSettings {
  if ('apiKey' in raw || 'OPENAI_API_KEY' in raw) {
    throw new ApiError(400, 'Ключ модели не сохраняется в настройках. Передавайте его только при запуске оценки.');
  }
  const price = (value: unknown, label: string): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000) {
      throw new ApiError(400, `${label}: укажите неотрицательную цену за миллион токенов или оставьте поле пустым.`);
    }
    return value;
  };
  if (typeof raw.strictJson !== 'boolean' || typeof raw.verification !== 'boolean') {
    throw new ApiError(400, 'Настройки формата и проверки должны быть логическими значениями.');
  }
  return {
    baseUrl: validateProviderUrl(raw.baseUrl),
    model: textValue(raw.model, 'Название модели', 200, true),
    modelMode: modelMode(raw.modelMode),
    inputPrice: price(raw.inputPrice, 'Входящие токены'),
    outputPrice: price(raw.outputPrice, 'Исходящие токены'),
    strictJson: raw.strictJson, verification: raw.verification,
    knowledge: textValue(raw.knowledge, 'База знаний', 100000, true),
  };
}

export async function saveSettings(request: Request): Promise<{ ok: true }> {
  const body = await bodyObject(request);
  await ensureDefaults();
  const previous = await setting<ProviderSettings>('provider') || DEFAULT_SETTINGS;
  const settings = normalizeSettings({ ...previous, ...body });
  await database().prepare('INSERT INTO cqa_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind('provider', JSON.stringify(settings), new Date().toISOString()).run();
  return { ok: true };
}

async function evaluationInputs(body: JsonObject): Promise<{ conversation: Conversation; contentHash: string; checklist: Checklist }> {
  await ensureDefaults();
  const id = identifier(body.conversationId, 'Диалог', 250, true);
  const db = database();
  const row = await db.prepare('SELECT payload, content_hash FROM cqa_conversations WHERE id = ?').bind(id).first<ConversationRow>();
  if (!row) throw new ApiError(404, 'Диалог не найден. Сначала импортируйте данные.', 'CONVERSATION_NOT_FOUND');
  const checklistId = body.checklistId === undefined
    ? await setting<string>('activeChecklistId') || DEFAULT_CHECKLIST.id
    : identifier(body.checklistId, 'Чек-лист');
  const checklistRow = await db.prepare('SELECT payload FROM cqa_checklists WHERE id = ?').bind(checklistId).first<PayloadRow>();
  if (!checklistRow) throw new ApiError(404, 'Выбранная версия чек-листа не найдена.', 'CHECKLIST_NOT_FOUND');
  return { conversation: JSON.parse(row.payload), contentHash: row.content_hash, checklist: JSON.parse(checklistRow.payload) };
}

function normalizeResults(value: unknown): CriterionResult[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new ApiError(400, 'Нужен массив оценок для всех критериев.');
  return value.map((raw) => {
    const result = object(raw, 'Оценка критерия');
    if (typeof result.value !== 'number' && !['yes', 'no', 'na'].includes(String(result.value))) {
      throw new ApiError(400, 'Ответ должен быть yes, no, na или ступенью шкалы.');
    }
    if (typeof result.value === 'number' && !Number.isFinite(result.value)) throw new ApiError(400, 'Недопустимое числовое значение оценки.');
    if (!Array.isArray(result.evidence) || result.evidence.length > 100 || result.evidence.some((id) => typeof id !== 'string' || id.length > 100)) {
      throw new ApiError(400, 'Доказательства должны содержать идентификаторы реплик.');
    }
    if (result.checkedRange !== null && (!Array.isArray(result.checkedRange) || result.checkedRange.length !== 2 || result.checkedRange.some((id) => typeof id !== 'string' || id.length > 100))) {
      throw new ApiError(400, 'Проверенный участок должен содержать начальную и конечную реплики.');
    }
    if (typeof result.needsReview !== 'boolean') throw new ApiError(400, 'Укажите признак дополнительной проверки.');
    return {
      criterionId: identifier(result.criterionId, 'Критерий', 100), value: result.value as Rating,
      explanation: textValue(result.explanation, 'Обоснование', 10000),
      evidence: [...result.evidence] as string[], checkedRange: result.checkedRange as [string, string] | null,
      needsReview: result.needsReview,
    };
  });
}

async function persistEvaluation(input: {
  conversation: Conversation; contentHash: string; checklist: Checklist; results: CriterionResult[];
  source: 'ai' | 'manual'; model: string; usage: Usage; durationMs: number; warnings: string[];
  runConfig?: Evaluation['runConfig'];
}): Promise<Evaluation> {
  const { conversation, contentHash, checklist, results } = input;
  const issues = validateResults(checklist.criteria, results, conversation.transcript);
  if (issues.length) throw new ApiError(422, issues.slice(0, 5).join(' '), 'INVALID_EVALUATION');
  const now = new Date().toISOString();
  const score = calculateScore(checklist.criteria, results);
  const evaluation: Evaluation = {
    id: `evaluation-${crypto.randomUUID()}`, conversationId: conversation.id,
    checklist: structuredClone(checklist), initialResults: structuredClone(results), results: structuredClone(results),
    initialScore: structuredClone(score), score,
    source: input.source, model: input.model, createdAt: now, updatedAt: now,
    usage: input.usage, durationMs: input.durationMs, warnings: input.warnings,
    transcriptHash: await hash(conversation.transcript),
    ...(input.runConfig ? { runConfig: input.runConfig } : {}),
  };
  const stored = await database().prepare(`
    INSERT INTO cqa_evaluations (id, conversation_id, checklist_id, payload, revision, created_at, updated_at)
    SELECT ?, ?, ?, ?, 0, ?, ?
    WHERE EXISTS (SELECT 1 FROM cqa_conversations WHERE id = ? AND content_hash = ?)
  `).bind(evaluation.id, conversation.id, checklist.id, JSON.stringify(evaluation), now, now, conversation.id, contentHash).run();
  if (stored.meta.changes !== 1) {
    throw new ApiError(409, 'Транскрипт изменился во время оценки. Обновите диалог и запустите оценку заново.', 'TRANSCRIPT_CHANGED');
  }
  return evaluation;
}

function providerFailure(error: unknown, apiKey: string): ApiError {
  if (error instanceof EvaluationError) {
    const safeMessage = error.message.split(apiKey).join('[ключ скрыт]').replace(/sk-[A-Za-z0-9_-]+/g, '[ключ скрыт]');
    const code = error.code;
    const status = code === 'AI_TIMEOUT' ? 504
      : code === 'AI_HTTP_429' ? 429
        : ['AI_KEY_REQUIRED', 'AI_MODEL_REQUIRED'].includes(code) ? 409
          : ['AI_VALIDATION_FAILED', 'AI_OUTPUT_TRUNCATED', 'AI_REFUSAL'].includes(code) ? 422
            : ['CONTEXT_TOO_LARGE', 'INVALID_CHECKLIST', 'INVALID_TRANSCRIPT', 'EMPTY_TRANSCRIPT', 'INVALID_PROVIDER_URL', 'AI_KEY_INVALID'].includes(code) ? 400
              : 502;
    return new ApiError(status, safeMessage, code, error.usage);
  }
  const message = error instanceof Error ? error.message : '';
  if (/401|unauthori[sz]ed|authentication|invalid.{0,20}key/i.test(message)) {
    return new ApiError(502, 'Провайдер отклонил API-ключ. Проверьте ключ и адрес сервиса.', 'PROVIDER_AUTH_ERROR');
  }
  if (/429|quota|rate.limit/i.test(message)) {
    return new ApiError(429, 'Провайдер ограничил запросы или исчерпан лимит API. Проверьте квоту и повторите позже.', 'PROVIDER_LIMIT');
  }
  if (/timeout|abort|timed.out|врем/i.test(message)) {
    return new ApiError(504, 'Модель не ответила вовремя. Повторите запуск или выберите более быструю модель.', 'PROVIDER_TIMEOUT');
  }
  if (/json|schema|формат|валидац|критери|доказатель|реплик/i.test(message)) {
    return new ApiError(422, 'Модель вернула непроверяемый результат. Проверьте формат, значения и доказательства.', 'MODEL_OUTPUT_INVALID');
  }
  return new ApiError(502, 'Не удалось получить ответ модели. Проверьте название модели, адрес API и доступ к сервису.', 'PROVIDER_ERROR');
}

/** Persist only our own category descriptions, never model output or raw provider errors. */
function failureReason(code: string): string {
  const reasons: Record<string, string> = {
    MODEL_NOT_CONFIGURED: 'AI-оценка не выполнена: модель или API-ключ не настроены.',
    AI_MODEL_REQUIRED: 'AI-оценка не выполнена: модель не выбрана.',
    AI_KEY_REQUIRED: 'AI-оценка не выполнена: API-ключ не задан.',
    AI_KEY_INVALID: 'AI-оценка не выполнена: неверный формат API-ключа.',
    INVALID_PROVIDER_URL: 'AI-оценка не выполнена: неверный адрес API модели.',
    INVALID_REQUEST: 'AI-оценка не выполнена: параметры запуска не прошли проверку.',
    INVALID_CHECKLIST: 'AI-оценка не выполнена: чек-лист или его JSON-схема не прошли проверку.',
    INVALID_TRANSCRIPT: 'AI-оценка не выполнена: транскрипт не прошёл проверку.',
    EMPTY_TRANSCRIPT: 'AI-оценка не выполнена: транскрипт пуст.',
    CONTEXT_TOO_LARGE: 'Диалог, чек-лист и база знаний превышают допустимый размер запроса.',
    AI_TIMEOUT: 'Модель не ответила за отведённое время.',
    PROVIDER_TIMEOUT: 'Модель не ответила за отведённое время.',
    AI_NETWORK_ERROR: 'Не удалось установить соединение с API модели.',
    AI_REDIRECT_REJECTED: 'API модели вернул запрещённое перенаправление; нужен конечный адрес подключения.',
    PROVIDER_AUTH_ERROR: 'Провайдер отклонил API-ключ или доступ к модели.',
    PROVIDER_LIMIT: 'Провайдер ограничил запросы или исчерпана квота.',
    AI_INVALID_HTTP_JSON: 'API модели вернул некорректный JSON.',
    AI_RESPONSE_TOO_LARGE: 'Ответ API модели превысил допустимый размер.',
    AI_OUTPUT_TRUNCATED: 'Ответ модели обрезан из-за ограничения размера.',
    AI_REFUSAL: 'Модель отказалась оценивать этот диалог.',
    AI_VALIDATION_FAILED: 'Ответ модели не прошёл проверку формата, значений или доказательств после попытки исправления.',
    MODEL_OUTPUT_INVALID: 'Ответ модели не прошёл проверку формата, значений или доказательств.',
    INVALID_EVALUATION: 'Результат не сохранён: оценки или доказательства не прошли проверку.',
    TRANSCRIPT_CHANGED: 'Транскрипт изменился во время оценки; результат не сохранён.',
    EVALUATION_SAVE_FAILED: 'Не удалось сохранить результат оценки в хранилище. Требуется повторный запуск.',
  };
  if (reasons[code]) return reasons[code];
  const http = /^AI_HTTP_(\d{3})$/.exec(code);
  if (http) return `API модели вернул HTTP ${http[1]}. Диалог не оценён.`;
  return 'Не удалось получить проверенный результат AI-оценки. Требуется повторный запуск.';
}

async function persistEvaluationFailure(
  inputs: Awaited<ReturnType<typeof evaluationInputs>>, settings: ProviderSettings, error: ApiError,
): Promise<void> {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : 'EVALUATION_FAILED';
  const failure: EvaluationFailure = {
    id: `failure-${crypto.randomUUID()}`, conversationId: inputs.conversation.id,
    checklistId: inputs.checklist.id, model: settings.model, modelMode: modelMode(settings.modelMode),
    error: failureReason(code), code, createdAt: new Date().toISOString(),
    transcriptHash: await hash(inputs.conversation.transcript),
  };
  await database().prepare(`
    INSERT INTO cqa_evaluation_failures (id, conversation_id, checklist_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(failure.id, failure.conversationId, failure.checklistId, JSON.stringify(failure), failure.createdAt).run();
}

export async function runEvaluation(request: Request): Promise<Evaluation> {
  const body = await bodyObject(request);
  const inputs = await evaluationInputs(body);
  const settings = { ...DEFAULT_SETTINGS, ...await setting<ProviderSettings>('provider') };
  settings.modelMode = modelMode(settings.modelMode);
  try {
    settings.baseUrl = validateProviderUrl(settings.baseUrl);
    if (!settings.model.trim()) {
      throw new ApiError(409, 'Выберите модель в настройках перед запуском AI-оценки.', 'MODEL_NOT_CONFIGURED');
    }
    let suppliedKey = '';
    if (body.apiKey !== undefined) suppliedKey = textValue(body.apiKey, 'API-ключ', 4000, true);
    if (/[\r\n]/.test(suppliedKey)) throw new ApiError(400, 'API-ключ не должен содержать переносы строк.', 'AI_KEY_INVALID');
    const apiKey = suppliedKey || (serverKeyMatches(settings.baseUrl) ? runtime.OPENAI_API_KEY || '' : '');
    if (!apiKey) {
      throw new ApiError(409, 'Подключите API-ключ модели в настройках. Автоматическая оценка без подключённой модели не выполняется.', 'MODEL_NOT_CONFIGURED');
    }
    let outcome: Awaited<ReturnType<typeof evaluateConversation>>;
    try {
      outcome = await evaluateConversation(inputs.conversation, inputs.checklist, settings, apiKey);
    } catch (error) { throw providerFailure(error, apiKey); }
    const results = normalizeResults(outcome.results);
    return await persistEvaluation({
      ...inputs, results, source: 'ai', model: settings.model,
      usage: outcome.usage, durationMs: outcome.durationMs, warnings: outcome.warnings,
      runConfig: { promptRevision: EVALUATOR_REVISION, strictJson: settings.strictJson,
        verification: settings.verification, knowledgeHash: await hash(settings.knowledge || ''),
        modelMode: settings.modelMode },
    });
  } catch (error) {
    const failure = error instanceof ApiError ? error
      : new ApiError(500, 'Не удалось сохранить результат оценки. Попробуйте запустить её снова.', 'EVALUATION_SAVE_FAILED');
    try { await persistEvaluationFailure(inputs, settings, failure); }
    catch (storageError) {
      // A failed write must not hide the original evaluation failure or expose its details.
      console.error('CQA evaluation failure could not be recorded', storageError instanceof Error ? storageError.name : 'UnknownError');
    }
    throw failure;
  }
}

export async function saveManualEvaluation(request: Request): Promise<Evaluation> {
  const body = await bodyObject(request);
  const inputs = await evaluationInputs(body);
  const results = normalizeResults(body.results);
  return persistEvaluation({
    ...inputs, results, source: 'manual', model: 'Эксперт',
    usage: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: null }, durationMs: 0,
    warnings: ['Ручная оценка эксперта. Не является результатом AI.'],
  });
}

function assertRating(criterion: Criterion, value: unknown): asserts value is Rating {
  if (value === 'na') {
    if (criterion.allowNA) return;
    throw new ApiError(400, 'Для этого критерия N/A не разрешён.');
  }
  if (criterion.kind === 'scale') {
    if (typeof value === 'number' && criterion.levels.some((level) => level.value === value)) return;
    throw new ApiError(400, 'Выберите одну из разрешённых ступеней шкалы.');
  }
  if (value !== 'yes' && value !== 'no') throw new ApiError(400, 'Для этого критерия допустимы только Да и Нет.');
}

async function evaluationRow(id: string): Promise<{ row: EvaluationRow; evaluation: Evaluation }> {
  const row = await database().prepare('SELECT payload, revision FROM cqa_evaluations WHERE id = ?').bind(id).first<EvaluationRow>();
  if (!row) throw new ApiError(404, 'Оценка не найдена.', 'EVALUATION_NOT_FOUND');
  return { row, evaluation: JSON.parse(row.payload) };
}

export async function createAppeal(request: Request): Promise<Appeal> {
  const body = await bodyObject(request);
  const evaluationId = identifier(body.evaluationId, 'Оценка');
  const criterionId = identifier(body.criterionId, 'Критерий', 100);
  const comment = textValue(body.comment, 'Комментарий к апелляции', 8000);
  const { evaluation } = await evaluationRow(evaluationId);
  const criterion = evaluation.checklist.criteria.find((item) => item.id === criterionId);
  const result = evaluation.results.find((item) => item.criterionId === criterionId);
  if (!criterion || !result) throw new ApiError(404, 'Критерий не найден в версии чек-листа этой оценки.');
  let proposedValue: Rating | null = null;
  if (body.proposedValue !== undefined && body.proposedValue !== null) {
    assertRating(criterion, body.proposedValue);
    proposedValue = body.proposedValue;
  }
  const now = new Date().toISOString();
  const appeal: Appeal = {
    id: `appeal-${crypto.randomUUID()}`, evaluationId, conversationId: evaluation.conversationId, criterionId,
    comment, status: 'pending', originalValue: result.value, proposedValue, finalValue: null,
    decisionReason: null, createdAt: now, resolvedAt: null,
  };
  try {
    await database().prepare('INSERT INTO cqa_appeals (id, evaluation_id, criterion_id, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(appeal.id, evaluationId, criterionId, appeal.status, JSON.stringify(appeal), now, now).run();
  } catch {
    throw new ApiError(409, 'По этому критерию уже есть открытая апелляция. Сначала завершите её рассмотрение.', 'APPEAL_ALREADY_PENDING');
  }
  return appeal;
}

export async function resolveAppeal(request: Request): Promise<{ appeal: Appeal; evaluation: Evaluation }> {
  const body = await bodyObject(request);
  const id = identifier(body.appealId, 'Апелляция');
  const decision = body.decision;
  if (decision !== 'confirm' && decision !== 'change') throw new ApiError(400, 'Выберите подтверждение или изменение оценки.');
  const reason = textValue(body.reason, 'Причина решения', 8000);
  const db = database();
  const storedAppeal = await db.prepare('SELECT payload FROM cqa_appeals WHERE id = ?').bind(id).first<PayloadRow>();
  if (!storedAppeal) throw new ApiError(404, 'Апелляция не найдена.', 'APPEAL_NOT_FOUND');
  const appeal = JSON.parse(storedAppeal.payload) as Appeal;
  if (appeal.status !== 'pending') throw new ApiError(409, 'По этой апелляции уже принято решение.', 'APPEAL_ALREADY_RESOLVED');
  const { row, evaluation } = await evaluationRow(appeal.evaluationId);
  const criterion = evaluation.checklist.criteria.find((item) => item.id === appeal.criterionId);
  const index = evaluation.results.findIndex((item) => item.criterionId === appeal.criterionId);
  if (!criterion || index < 0) throw new ApiError(409, 'Критерий исходной оценки недоступен.');
  if (evaluation.results[index].value !== appeal.originalValue) {
    throw new ApiError(409, 'Оценка этого критерия изменилась после подачи апелляции. Обновите карточку.', 'APPEAL_STALE');
  }
  const finalValue = decision === 'confirm' ? evaluation.results[index].value : body.value;
  assertRating(criterion, finalValue);
  const conversationRow = await db.prepare('SELECT payload FROM cqa_conversations WHERE id = ?')
    .bind(evaluation.conversationId).first<PayloadRow>();
  if (!conversationRow) throw new ApiError(409, 'Исходный диалог недоступен. Решение по апелляции не сохранено.', 'CONVERSATION_NOT_FOUND');
  const conversation = JSON.parse(conversationRow.payload) as Conversation;
  if (await hash(conversation.transcript) !== evaluation.transcriptHash) {
    throw new ApiError(409, 'Исходный транскрипт изменился. Решение по апелляции не сохранено.', 'TRANSCRIPT_CHANGED');
  }
  const now = new Date().toISOString();
  const newResults = structuredClone(evaluation.results);
  newResults[index] = {
    ...newResults[index], value: finalValue,
    explanation: decision === 'change' ? `Решение проверяющего: ${reason}` : newResults[index].explanation,
    needsReview: false,
  };
  if (decision === 'change') {
    if (body.evidence !== undefined) {
      if (!Array.isArray(body.evidence) || body.evidence.length > 100 || body.evidence.some((item) => typeof item !== 'string' || item.length > 100)) {
        throw new ApiError(422, 'Для решения укажите идентификаторы подтверждающих реплик в evidence.', 'INVALID_APPEAL_EVIDENCE');
      }
      newResults[index].evidence = [...body.evidence] as string[];
    }
    if (body.checkedRange !== undefined) {
      if (body.checkedRange !== null && (!Array.isArray(body.checkedRange) || body.checkedRange.length !== 2 || body.checkedRange.some((item) => typeof item !== 'string' || item.length > 100))) {
        throw new ApiError(422, 'Проверенный участок должен содержать начальную и конечную реплики или null.', 'INVALID_APPEAL_EVIDENCE');
      }
      newResults[index].checkedRange = body.checkedRange as [string, string] | null;
    }
  }
  const issues = validateResults(evaluation.checklist.criteria, newResults, conversation.transcript);
  if (issues.length) {
    throw new ApiError(422, `Добавьте или исправьте доказательства решения. ${issues.slice(0, 5).join(' ')}`, 'INVALID_APPEAL_EVIDENCE');
  }
  // The immutable initialResults/initialScore and original checklist remain intact.
  const updatedEvaluation: Evaluation = { ...evaluation, results: newResults, score: calculateScore(evaluation.checklist.criteria, newResults), updatedAt: now };
  const updatedAppeal: Appeal = {
    ...appeal, status: decision === 'confirm' ? 'confirmed' : 'changed', finalValue,
    decisionReason: reason, resolvedAt: now,
  };
  const mutation = crypto.randomUUID();
  const writes = await db.batch([
    db.prepare(`
      UPDATE cqa_evaluations SET payload = ?, revision = revision + 1, last_mutation_id = ?, updated_at = ?
      WHERE id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM cqa_appeals WHERE id = ? AND status = 'pending')
    `).bind(JSON.stringify(updatedEvaluation), mutation, now, evaluation.id, row.revision, appeal.id),
    db.prepare(`
      UPDATE cqa_appeals SET payload = ?, status = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM cqa_evaluations WHERE id = ? AND last_mutation_id = ?)
    `).bind(JSON.stringify(updatedAppeal), updatedAppeal.status, now, appeal.id, evaluation.id, mutation),
  ]);
  if (writes.some((write) => write.meta.changes !== 1)) {
    throw new ApiError(409, 'Результат уже изменён другим действием. Обновите карточку и повторите решение.', 'APPEAL_CONFLICT');
  }
  return { appeal: updatedAppeal, evaluation: updatedEvaluation };
}
