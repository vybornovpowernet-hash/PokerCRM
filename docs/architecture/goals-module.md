# Architecture: Goals Module («Цели»)

> Статус: **концепт утверждён, архитектура на согласовании**. Код и миграции не пишутся,
> пока документ не принят пользователем.
>
> Принцип (Domain-Driven Design, упрощённо): «Цели» — изолированный модуль-лист в графе
> зависимостей. Он **читает** факты из общих таблиц (балансы/турниры/курсы) только на
> чтение, **пишет** только в свои таблицы, и его **никто не импортирует**. Достижение —
> lazy-реконсиляция на чтении: прогресс всегда свежий, без шин событий и без интеграции
> в чужие сервисы.

---

## 1. Принципы изоляции (почему так)

| Правило | Реализация |
|---|---|
| Модуль — лист графа | `services/goals/*` импортирует только листовые утилиты (`db.js`, `rates/convert.js`, `lib/date.js`, `lib/errors.js`, `lib/money.js`). **Ни одного импорта** сервисов `balances/sessions/statistics/rooms`. |
| Чтение — только через свой SQL | Модуль делает собственные read-only prepared-запросы к `balance_entries`, `tournaments`, `exchange_rates`, `rooms` (см. §4). Никто извне не знает о таблицах `goals`. |
| Запись — только в свои таблицы | `goals` + `goal_entries`. Никаких INSERT/UPDATE/DELETE вне своих таблиц. |
| Нет интеграционных хуков | Чужие `withTransaction`-ток-пойнты (upsertBalance, funds, saveDayBatch…) НЕ вызывают goals. Актуализация — только lazy-реконсиляция на чтении (`GET /api/goals`). Одиночный локальный пользователь — всегда актуально. |
| Расширение метрик — registry | Новая метрика = один резолвер в реестре. Не трогает резолверы, роуты, схему (см. §8). |

Зачем такой контракт: не плодим кольцевых зависимостей, не раздуваем существующие
сервисы (цели не влезают в `balances.ts`/`statistics.ts`), будущий перенос в отдельный
процесс/микросервис возможен без правки границы чтения.

---

## 2. Позиция в монорепо и файлы

Следуем существующему прецеденту подпапок доменов: `services/rates/`, `services/parsers/`
(AGENTS.md: «по домену»). «Цели» получают собственную подпапку `services/goals/` + тонкий
роут `routes/goals.ts`.

```
server/src/
  db.ts                                     ← миграция v12 (+ только этот файл меняем в корне)
  app.ts                                    ← регистрация goalsRoutes (+1 строка)
  routes/goals.ts                           ← тонкий Fastify-роут, только валидация+диспетч
  services/goals/
    goals.types.ts                          ← публичный контракт модуля (Goal, GoalEntry, GoalMetric, …)
    goals.db.ts                             ← storage: CRUD своих таблиц + READ-ONLY запрос фактов
    goals.metrics.ts                        ← снэпшот фактов GoalsFacts + реестр резолверов прогресса
    goals.reconcile.ts                      ← lazy-реконсиляция (прогресс, milestones, статусы)
    goals.service.ts                        ← точка входа: list/create/addEntry/close/delete

client/src/
  goals/
    GoalsPage.tsx                           ← контейнер страницы (fetch + стейт через useGoals)
    goals.api.ts                            ← вызовы /api/goals (обёртка над экспортированным request)
    goals.types.ts                          ← доменные типы клиента (зеркало серверного контракта)
    useGoals.ts                             ← хук: загрузка, expandedId, optimistic-мутации, rollback
    components/
      GoalsBackground.tsx                   ← амбиент-слой «мира Целей»
      GoalCreator.tsx                       ← конструктор фразы (metric chip / сумма / дедлайн)
      MetricPicker.tsx                      ← выпадающий выбор метрики (layoutId-пилюли)
      GoalCard.tsx                          ← парящая стеклянная карточка (layout-раскрытие)
      GoalRing.tsx                          ← SVG-кольцо прогресса (spring dashoffset)
      PercentCounter.tsx                    ← подсчёт процента (useSpring-счётчик)
      GoalTimeline.tsx                      ← лента (system + user)
      TimelineEntry.tsx                     ← запись ленты (variance: system|user)
      EntryComposer.tsx                     ← ввод комментария в ленте
      GgStateBadge.tsx → AchievedHalo.tsx   ← визуализация reached/failed (halo / монохром)
  App.tsx                                   ← TabId 'goals' + React.lazy + Suspense + AnimatePresence
  lib/api.ts                                ← + export request() (единственное маленькое изменение)
  lib/types.ts                              ← БЕЗ изменений (гоулы держат типы у себя)

docs/architecture/goals-module.md           ← этот документ
```

Клиент-фича кладётся в `client/src/goals/` отдельной папкой (а не в общие `pages/`+`components/`),
чтобы не перегружать глобальный контекст: страница лениво грузится, её типы и компоненты
нигде не расшариваются, стейт целиком локальный (§7).

---

## 3. База данных — миграция v12

Три правила схемы: (а) никаких FK в общие таблицы (только `goal_id` в свои),
(б) идемпотентность системных событий за счёт `UNIQUE(goal_id, milestone)`,
(в) расширение метрик — без миграций (нет CHECK на `metric`, энум живёт в приложении).

```sql
-- v12: goals module (isolated)
CREATE TABLE goals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  metric       TEXT    NOT NULL DEFAULT 'bankroll',   -- application-level enum, no CHECK
  target_units INTEGER NOT NULL CHECK (target_units > 0),
  currency     TEXT    NOT NULL DEFAULT 'USD',
  deadline     TEXT,                                   -- YYYY-MM-DD, optional
  status       TEXT    NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','achieved','failed')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  achieved_at  TEXT,
  failed_at    TEXT
);

CREATE TABLE goal_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
  content    TEXT    NOT NULL,
  milestone  INTEGER,                                 -- 50|75|100 for kind='system', NULL for 'user'
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(goal_id, milestone)
);
CREATE INDEX idx_goal_entries_goal ON goal_entries(goal_id, created_at);
```

Комментарии к выбору:
- `target_units` — минимальные единицы валюты (минуты-фиат), как весь проект.
  Для метрики `bankroll` эффективно валютой всегда USD (тотал в шапке приложения — USD),
  но колонка `currency` есть на будущее с валидацией `validateCurrency`-allowlist'ом.
- `UNIQUE(goal_id, milestone)` — гарантия «милстоун пишется один раз» независимо от числа
  реконсиляций (SQLite пропускает NULL в UNIQUE — личные записи не конфликтуют).
- Статус хранится (а не выводится каждый раз), чтобы `achieved_at/failed_at` и записи ленты
  оставались историей; «достигнуто» проставляется ровно один раз по факту пересечения.
- Каскад `ON DELETE CASCADE` — удаление цели чистит ленту без ручных DELETE.
- Индекс ленты — по `(goal_id, created_at)` для чтения таймлайна.

`user_version` пинается на **12**; тест `db.test.ts` обновляется (пин + наличие колонок +
UNIQUE-поведение + cascade).

---

## 4. Сервер: поток данных (лекция на 10 строк)

```
 (shared tables, read-only)                  (goals tables, write)
 ┌─ balance_entries ─┐
 ├─ tournaments ─────┤   SELECT (own SQL)
 ├─ exchange_rates ──┴───────► goals.metrics.collectGoalsFacts()
 ├─ rooms ──────────────────►      GoalsFacts (snapshot)
                                        │
                               metricResolver(metric, facts)   ← registry («как считаем %»)
                                        │ progressUnits | null
                  goals.reconcile.reconcileGoal(g)
                                        │
             │ progress >= target → status='achieved' + milestone(100) entry
             │ deadline < today  → status='failed'  + system entry
             │ crossed 50/75%    → milestone entries (UPSERT по UNIQUE)
             ▼
        goals.db (own writes only)      ◄── goals.service (публичное API)
```

### 4.1 `collectGoalsFacts(): GoalsFacts` (goals.metrics.ts)
Read-only снэпшот, собирается одним проходом:
- `latestBalances: {roomId, amount, currency, date}[]` — `JOIN` последней записи на рум
  (семантика идентична `totalCurrentUsd` в шапке — прогресс цели и банкролл-бейдж не расходятся);
- конверсия в USD — через `convertToUsd(amount, currency, date, roomId)` (день заморожен,
  рум-оверрайды учтены — листовой хелпер, без импорта сервисов);
- (под будущие метрики) агрегаты турниров: локальный мини-`aggregate` суммы профита/бай-инов/
  числа строк по диапазону — тем же листовым `convertToUsd`.

### 4.2 Реестр резолверов
```ts
export type MetricResolver = (facts: GoalsFacts) => { progressUnits: number | null; targetUnits: number }
export const METRIC_RESOLVERS: Record<GoalMetric, MetricResolver> = { bankroll: bankrollResolver }
```
- `bankrollResolver`: сумма `latestBalances` в USD; `targetUnits` из цели (в USD);
  `progressUnits = null` при неконвертируемой строке (как `totalCurrentUsd` → `null`),
  процента нет → UI показывает «курс недоступен» вместо цифры.
- `percent(goal) = progressUnits === null ? null : round(progressUnits / targetUnits * 100)`.

### 4.3 `reconcileGoal(g)` (goals.reconcile.ts) — lazy, идемпотентно
Вызывается внутри `getDb()`-транзакции (`withTransaction`, по конвенции проекта) на каждой
цели при чтении списка. Шаги:
1. `facts = collectGoalsFacts()`; `progress = resolver(facts)`.
2. Если `status='active'` и `progress >= target` → `status='achieved', achieved_at=now`,
   UPSERT `goal_entries(kind='system', milestone=100, 'Цель достигнута')`.
3. иначе если `status='active'` и `deadline` и `deadline < today` → `status='failed', failed_at=now`,
   UPSERT `goal_entries(kind='system', milestone=NULL, 'Дедлайн истёк — цель не выполнена')`.
4. иначе для `percent` в `[50, 75]`, не пересечённых ранее (макс-записанный milestone < target):
   UPSERT `goal_entries(kind='system', milestone, «Пройдена половина пути»/«75% пути»)`,
   только если `status='active'` (чтобы провал не дописывал «радостные» милстоуны).

Результат каждой реконсиляции (персист) — `{ progressUnits, percent, status }`.

Идемпотентность: повторные чтения не пишут дублей (UNIQUE-ключи + статусные guard'ы). Никаких
запланированных задач — только на чтение.

---

## 5. API (маршруты services/goals → routes/goals.ts)

| Метод/путь | Тело/Query | Ответ | Эффект |
|---|---|---|---|
| `GET /api/goals` | — | `{ goals: GoalListItem[] }` (каждый: поля + `progressUnits`, `percent`, `status`, `entries[]`) | lazy-реконсиляция всех, далее read |
| `POST /api/goals` | `{ metric, targetUnits, currency?, deadline? }` | `{ goal: Goal }` | create + реконсиляция одной |
| `POST /api/goals/:id/entry` | `{ content }` (1..500, обязателен) | `{ entry: GoalEntry }` | user-запись в ленту |
| `POST /api/goals/:id/close` | `{ outcome: 'failed' }` | `{ goal: Goal }` | явный провал (achieved — только авто) |
| `DELETE /api/goals/:id` | — | `{ ok: true }` | cascade-удаление ленты |

Валидации (зеркало стиля проекта): `HttpError(400)` на неверные `targetUnits` (не-целое/≤0),
`currency` (allowlist `validateCurrency`), `deadline` (`isValidDayKey`), `content` (пусто/>500);
`404` на чужой/отсутствующий `id`.

`GET /api/goals` возвращает `entries` целиком (объёмы мизерные) — одного round-trip хватает
и для списка, и для раскрытия таймлайна.

---

## 6. Граф зависимостей (что НЕ должно появиться)

```
          App (client) ──► React.lazy ──► client/src/goals/*
                                          │
                                          └─► lib/api.request (листовая обёртка fetch)
                                              lib/types (только TabId — не наружу типов целей)

   routes/goals.ts ──► services/goals/* ──► { db.js, rates/convert.js, lib/{date,errors,money}.js }
         ▲                  │
         │                  └─► (read-only) balance_entries / tournaments / exchange_rates / rooms
         │
   app.ts (регистрация)      // НИКТО не импортирует services/goals/*
```

Anti-corruption-правила (обязательны к соблюдению при реализации):
- В `services/goals/*` не допускаются импорты `balances.js`, `sessions.js`, `statistics.js`,
  `tournaments.js`, `rooms.js`, `funds.js`, `pending.js`.
- Ни в одном существующем сервисе/роуте не появляются импорты `goals*` (кроме `routes/goals.ts`
  и `app.ts` регистрации).
- Никаких `CREATE`/`INSERT`/`UPDATE`/`DELETE` по общим таблицам в модуле целей.

---

## 7. Фронтенд: структура и стейт

### 7.1 Подключение (App.tsx)
- `TabId` + `TABS` получают `{ id: 'goals', label: 'Цели' }` (между «Турниры» и «Статистика»);
  localStorage-валидация таба работает автоматически (по TABS).
- `const GoalsPage = lazy(() => import('./goals/GoalsPage'))` + `<Suspense fallback={…скелет…}>`.
- Вокруг `pages[activeTab]` — `<AnimatePresence mode="wait">` + `motion.div key={activeTab}`.
  exit-переходы: не-гоулы `{opacity:0, duration:0}` (табы остаются мгновенными), «Цели» —
  `{opacity:0, scale:0.985, duration:250ms, ease-out}` (амбиент растворяется). Вход page —
  обычный фейд 180ms. `MotionConfig reducedMotion="user"` на уровне страницы.

### 7.2 `GoalsPage` → `useGoals` (весь стейт локальный, глобальный контекст не трогаем)
- `useGoals()` держит: `goals: Goal[]`, `loading/error`, `expandedId: number | null`,
  `creatorOpen`, и optimistic-мутации `addEntry/closeGoal/deleteGoal/createGoal`
  (с rollback по ошибке — паттерн, как `ErrorBoundary`/`usePoll` в проекте).
- Никакого Context/глобального store: страница подгружается лениво, данные нужны только ей;
  обновление прогресса — свежая lazy-реконсиляция при каждом `GET`.
- Refresh-триггеры: mount + после любой мутации. Фоновый polling не нужен (прогресс меняется
  только от действий на других вкладках; при возврате на «Цели» данные свежие).

### 7.3 Компоненты и их анимации (архитектура уровня)
- `GoalsBackground` — `fixed inset-0 -z-10 pointer-events-none` (indigo/violet/emerald блобы
  `blur-3xl`, alpha 0.05–0.10). Анимируется вместе со страницей: вход/выход — через
  exit-переход `motion.div` из §7.1; внутри — только фейд-проявление 1.2s `ease-out` один раз.
- `GoalCreator` — конструктор фразы: чанк-сегменты «Я хочу [метрика▾] в размере [сумма]
  [до даты]». `MetricPicker` — popover с `transform-origin` от триггера и `layoutId`-морфом
  активной пилюли. Кнопка «Создать» — `:active scale(0.97)` (все кнопки).
- `GoalCard` — стекло (`bg-white/4 backdrop-blur border-white/8 shadow-2xl shadow-black/50`),
  `layout`-проп для раскрытия, hover (только `pointer:fine`) `translateY(-2px)+scale(1.002)`
  200ms `ease-out`, клик — toggle `expandedId`.
- `GoalRing` — `<motion.circle>` `strokeDashoffset` спринг (`{type:'spring', duration:0.8,
  bounce:0.15}`), прерываемый; трек — `slate-700`, активный — emerald-300; `role="progressbar"`,
  `aria-valuenow=percent`. `PercentCounter` — `useSpring`-счётчик цифр (только opacity/transform).
- `AchievedHalo` — одноразовое гало при `status='achieved'` (opacity 0→0.15→0, 1.6s), кольцо
  замыкается. `failed` — монохром, без анимаций (кроме монтажного фейда), текст «Цель закрыта».
- `GoalTimeline`/`TimelineEntry` — раскрытие через полученный `layout` карточки; записи входят
  стаггером 40ms (одна оркестровка на открытие); `user` — стеклянный пузырь с акцент-рейлом,
  `system` — пунктирная линия + тихая иконка; `EntryComposer` инпут мотает вниз ленты
  (фокус-кольцо `focus-visible`).

Технические оговорки по доставке `motion`:
- `AnimatePresence` в App.tsx тянет ядро `motion` в главный бандл (это ок: оно троешится
  до ~30–40 kB gzip); объёмные компоненты фичи — в lazy-чанке «Цели».
- `client/src/lib/api.ts`: экспортируем `request<T>()` (единственное изменение; текущий код не
  ломается — чистый ре-экспорт функции).

---

## 8. Расширение метрик (как НЕ раздуть)

Новая метрика («накопленный профит», «кол-во турниров», «ROI») = 1 строка в
`METRIC_RESOLVERS` + 1 значение энума `GoalMetric`. Схема не меняется (`metric` без CHECK),
другие резолверы не трогаются. Резолвер читает уже собранный `GoalsFacts` или расширяет
снэпшот полем. Всё — внутри `services/goals/`, без внешних изменений.

---

## 9. План тестов (витренер)

- `server/tests/goals.test.ts` — юнит: create/validate (400), банкролл-прогресс с замороженным
  курсом дня (рум-оверрайд учтён), `null`-прогресс при неконвертируемой валюте, milestones
  50/75/100 пишутся один раз (идемпотентность повторной реконсиляции), достижение ставит
  `achieved_at`+entry(100), дедлайн `failed_at`+entry(NULL), user entry 1..500, close failed,
  cascade-удаление, статусные guard'ы (провал не дописывает радостные милстоуны).
- `server/tests/goals-route.test.ts` — э2е через `app.inject`: GET (повторный вызов не дублирует
  милстоуны), POST create, POST entry (400 пусто/500+), close, delete 404.
- `db.test.ts` — пин **12**, колонки, `UNIQUE(goal_id, milestone)` c пропуском NULL, cascade.
- Клиент: vitest для `useGoals` optimistic-rollback + `GoalRing`/`PercentCounter` (чистые функции
  математики прогресса), сборка-проверка `React.lazy`+Suspense.
- Механика метрик — покрыта тестами денежной математики (никаких float; проценты — целые в
  единицах /100, как в проекте).

## 10. Открытые решения (ждут подтверждения до кода)

1. Милстоуны **50/75/100** — ок, или добавить «до дедлайна N дней»?
2. Метрика v1 — только `bankroll`; расширение (профит/ROI/кол-во) — сразу или бэклог?
3. `UNIQUE(goal_id, milestone)` допускает ровно один system-милстоун на значение — терпим
   для v1 (при сложных линейках милстоунов потребует вторичный ключ).
4. Клиентская фича живёт в `client/src/goals/` (не в общих pages/components) — подтверждаешь
   дивергенцию ради изоляции?