# Todo: Poker CRM

## Phase 1: Foundation

- [x] Task 1: Scaffolding проекта (client + server + TS + Tailwind + vitest + eslint + npm-скрипты dev/build/start/test/backup)
  - Acceptance: `npm run dev` стартует фронт и сервер; `npm run build` собирает; `npm test` зелёный
  - Verify: `npm run build && npm test`
  - Files: весь корень проекта (package.json, tsconfig, vite config, server/index.ts)
  - Size: M

- [x] Task 2: SQLite схема + миграции (rooms, exchange_rates, transactions, balance_entries, tournaments, notifications) + утилиты денег/даты
  - Acceptance: все таблицы создаются миграцией; утилиты денег (целые минимальные единицы) и дат покрыты тестами
  - Verify: `npm test` (тесты миграций/утилит)
  - Files: server/src/db.ts, server/src/lib/money.ts, server/src/lib/date.ts, tests
  - Size: M

### Checkpoint: Foundation
- [x] `npm run build` собирается, `npm test` зелёный

## Phase 2: Core vertical slices

- [x] Task 3: Румы — CRUD API + вкладка «Румы» (название, валюта кассы, валюта турниров)
  - Acceptance: создать/редактировать/удалить рум; вкладка отображает список и форму
  - Verify: `npm test` + мануально в браузере
  - Files: server/src/routes/rooms.ts, server/src/services/rooms.ts, client/src/pages/Rooms.tsx и т.д.
  - Size: M

- [x] Task 4: Курсы — open.er-api.com (EUR/USD) + scraper PokerDom (USD/RUB, строка USD, валидация, ретраи, 12ч, персистентное уведомление)
  - Acceptance: при старте сервера и устаревании >12ч курс обновляется; берётся строка USD, а не первое число; при провале — уведомление в БД, показывается на сайте и не исчезает до закрытия/успеха
  - Verify: `npm test` (scraper и refresh мокнуты) + мануально (сбой инжектится)
  - Files: server/src/services/rates/*, notifications маршрут, client баннер
  - Size: L (делим при реализации на подзадачи)
  - Notes: Chromium 1243 (нужен playwright 1.63) не докачался (CDN виснет); работает fallback в pokerdon.ts — любой установленный chromium-{rev} через executablePath (на машине 1228). Живой smoke: USD/RUB=89.3316, EUR/USD=1.1624. er-api URL: open.er-api.com/v6/latest/EUR.

- [x] Task 5: Транзакции — депозит/вывод/перевод (+комиссия), вкладка «Депозиты и выводы», не влияют на профит
  - Acceptance: операция создаётся с типом/суммой/комиссией/датой/комментарием; не входит в профит; список и фильтры
  - Verify: `npm test` (математика потоков) + мануально
  - Files: server/src/routes/transactions.ts, server/src/services/funds.ts, client/src/pages/Transactions.tsx
  - Size: M
  - Notes: поток: in = amount, out = amount+fee (профит-инвариант delta−(in−out) держится); flows группируются по (room, currency, direction); E2E: in=70000/out=10250, deposit-out→400.

- [x] Task 6: Балансы/сессии — запись баланса по руму за день, профит по румам и суммарно, вкладки «Балансы» и «Сессии»
  - Acceptance: баланс по руму/дате записывается; профит = дельта − (приход − уход); сессия группирует день; «вне игры» вычисляется
  - Verify: `npm test` (формула) + мануально
  - Files: server/src/services/balances.ts, server/src/routes/balances.ts, client сессии
  - Size: M
  - Notes: ВСЁ конвертируется в USD (rates/convert.ts: direct→inverse→via-USD, заморозка по дате + fallback на последний известный курс когда на день нет курса). Профит сессии = delta (в USD по курсу дня) − (in − out). «Вне игры» = всё введённое в банкролл (in−out за всё время) − текущие балансы в USD. E2E: PokerDom $100, RedStar $176.68, банкролл $3641.04.

- [x] Task 7: Турниры — поп-ап «Заполнить турниры», расхождение >5%, «списать на казино»
  - Acceptance: строки байин+результат динамически добавляются; пустая строка не считается; профит каждого турнира = результат − байин; расхождение >5% показывает варианты
  - Verify: `npm test` (профит, расхождение) + мануально
  - Files: server/src/services/tournaments.ts, client popup-компонент
  - Size: M
  - Notes: profiles в USD по курсу дня. Сверка: |sessionProfit − (турниры + казино)| / max(...) >5% → варианты «Поправить баланс» (дельта = турниры+казино+(in−out)), «Списать на казино» (остаток в casino_writeoffs, USD, UNIQUE(room,date), миграция v3), или правка строк. E2E: session 4000 vs турниры 34 → сработал, adjust→0, writeoff casino=3966→0. Кнопки: в «Балансах» (у строки) и в «Сессиях» (у дня).

### Checkpoint: Core Features
- [x] E2E-флоу: рум → баланс → турниры → сессия с профитом; расхождение подсвечивается
  - Verified: live smoke — PokerDom delta без турниров → flagged (09-09 remainder 10000, 09-10 remainder 2000); RedStar депозит+турнир покрывают дельту → remainder 0, flagged=false; sessions и timeline в USD.

## Phase 3: Statistics & polish

- [x] Task 8: Статистика — график профита как SharkScope, календарь активности
  - Acceptance: кумулятивный график по всем турнирам (каждый влияет); календарь с подсветкой <15 красный / 15–20 оранжевый / >20 зелёный
  - Verify: `npm test` (агрегаты) + мануально
  - Files: server/src/services/statistics.ts, server/src/routes/statistics.ts, client/src/pages/Stats.tsx
  - Size: M
  - Notes: timeline = каждая турнирная строка точкой (#1..#N, profit = result−buyin в USD по курсу дня, cumulative). Календарь = count турниров/день, дни без турниров не окрашены; пороги client-side: <15 красный, 15–20 оранж, >20 зелёный. График — КАСТОМНЫЙ SVG (пользователь выбрал вместо Recharts, без новых зависимостей): сегменты emerald/red по знаку, ноль пунктиром, тултип по hover, компактные $k-лейблы оси. E2E: 4 точки (#1 +34, #2 −34, #3 −112, #4 +4650), месяц 4538, другой месяц 0.

- [x] Task 9: Dashboard-интеграция + тёмная полировка UI
  - Acceptance: кнопка «Заполнить турниры» при смене баланса; строка «вне игры»; баннер о неудаче курса; тёмный UI согласно frontend-design + emil-design-eng
  - Verify: мануально визуально + `npm run build`
  - Files: client/src/app, client/src/styles, компоненты
  - Size: M
  - Notes: после сохранения баланса — notice с кнопкой «Заполнить турниры»; в «Сессиях» бейджи «расхождение» (amber, клик→поп-ап с нужным румом) и «N турн.» (clean); REСТ endpoint /api/tournaments/reconcile-summary (flags по диапазону, чистые дни пропущены); «вне игры» и rate-баннер уже были (Task 4/6). Тёмный UI выровнен (кнопки/карточки/бейджи/пустые состояния).

### Checkpoint: Complete
- [x] Все acceptance criteria из SPEC.md выполнены
- [x] Готово к ревью пользователем

## Phase 4: Rate & rooms hardening (2026-09-16)

- [x] Task 10: Chromium восстановлен (chromium-1243 + headless-shell через Google storage, т.к. cdn.playwright.dev виснет); fallback на системные Chrome/Edge в `pokerdon.ts` (перебор кандидатов без падения на первом)
  - Verify: live scrape USD/RUB 88.41; `npx playwright install chromium` не нужен
  - Files: server/src/services/rates/pokerdon.ts, server/tests/pokerdon.test.ts
- [x] Task 11: Курсы — вторая ссылка `plk7pokerdom.com/poker` (первая 30с → вторая), парсер по строке с `₽` (не первая цифра), refresh при старте + каждые 4 часа (было 12ч hourly), `maybeRefreshRates` удалён
  - Verify: тесты rates-parse/refresh; live `/api/rates/refresh` → ok
  - Files: server/src/services/rates/{pokerdon,parse,refresh}.ts, server/src/index.ts
- [x] Task 12: Баг DELETE 415 — `Content-Type` только при наличии body (фикс затронул rooms/transactions remove, notifications dismiss)
  - Files: client/src/lib/api.ts
- [x] Task 13: Шаблоны румов — `rate_source` (миграция v4), `templates.ts` (Покердом/RedStar, детект по названию), дропдаун «Шаблон» в форме (привязывает только источник курса), колонка «Курс», валюты → только RUB/USD/EUR
  - Verify: 77 серверных тестов зелёные; live API (create с rateSource, allowlist KZT→400)
  - Files: server/src/db.ts, server/src/services/{templates,rooms}.ts, server/src/routes/rooms.ts, client/src/{pages/Rooms.tsx,lib/api.ts,lib/types.ts,components/TournamentPopup.tsx}, server/tests/{db,rooms,templates}.test.ts

## Phase 5: UX полное поле + палитра + объёмные блоки (2026-09-16)

> Формат отчётов пользователю с этого момента: СТРОГО по каждому файлу `[Файл] -> [код] -> [что] -> [почему]`, маркер `// ... остальной код без изменений ...`, без простыней. Не тот формат → отклонение без чтения.

- [x] Task 14: RoomNameCombobox — «Название» и «Шаблон» объединены в одно умное поле (кастомный автокомплит, не datalist). Выбор шаблона вставляет английское имя (`PokerDom`/`RedStar` — теперь и `label`, и `insertName` на англ.) и подтягивает `rate_source`; произвольное имя → `rateSource = null`. Автодетект «Похоже на…» удалён. Клик/фокус → список, фильтр по вводу, клавиатура ↑↓/Enter/Esc, закрытие по клику вне
  - Verify: build/lint/тесты зелёные (77+1); live API: templates отдаёт insertName
  - Files: server/src/services/templates.ts (label+insertName англ.), server/src/routes/rooms.ts, server/tests/rooms.test.ts, client/src/components/RoomNameCombobox.tsx (новый), client/src/pages/Rooms.tsx, client/src/lib/types.ts
- [x] Task 15: Сохранение активной вкладки в `localStorage` (ключ `poker-crm-tab`), инициализация из него с валидацией значения → F5 не сбрасывает вкладку
  - Files: client/src/App.tsx
- [x] Task 16: Уход от чистого чёрного — глобальная палитра `zinc-*` → `slate-*` во всех UI-файлах; `body { background:#0f172a (slate-900); color:#e2e8f0 (slate-200) }`. Контраст: secondary text slate-400 на slate-900 ≈ 4.9:1 (WCAG AA)
  - Verify: grep `zinc` в client → пусто
  - Files: client/src/index.css + все pages/components (механический replaceAll)
- [x] Task 17: Поверх того же фона внедрён паттерн Elevated Cards: карточки/формы → `bg-slate-800/80 border-slate-700 shadow-lg shadow-black/40`; модалка → `bg-slate-800 shadow-2xl shadow-black/60`; инпуты → `bg-slate-900/50 border-slate-700 shadow-inner focus:border-slate-500`; мелкие бейджи/пилюли → `border-slate-700`. Тело страницы/slate-900 не трогали
  - Verify: build/lint/тесты зелёные
  - Files: client/src/pages/{Balances,Sessions,Rooms,Transactions,Stats,Placeholder}.tsx, client/src/components/{TournamentPopup,RoomNameCombobox}.tsx

## Phase 6: Инцидент + умный запуск (2026-09-16, поздний вечер)

- [x] Task 18: «Failed to fetch» — первопричина: консоль закрыта → dev-стек (Vite+Fastify) погиб, клиент без сети. Код/API/CORS НЕ виноваты (всё 200, CORS `origin:true`, Vite-proxy `/api`). Фикс = скрипт фонового запуска
- [x] Task 19: `start.bat` + `start.ps1` (корень, ps1 в UTF-8 с BOM): проверка портов 3001/5173 → не запущены: тихий фон-старт (hidden cmd, переживает закрытие терминала) + автобраузер на :5173; запущены: меню [1] Перезапустить [2] Остановить [3] Выйти. Остановка СТРОГО по `OwningProcess` порта (никакого `taskkill /im node.exe` — на машине ИИ-агент). Логи `logs/{server,client}.log/.err.log`. Живой тест: детект, рестарт, health
  - Files: start.bat, start.ps1, AGENTS.md (команда + граница «только PID-порты»)

## Phase 7: Статистика-дашборд + переводы между румами (2026-09-16, ночь)

- [x] Task 20: Балансы — формат ввода суммы: `type="text"`, группировка тысяч пробелом (`\B(?=(\d{3})+(?!\d))`), `cleanInput` (только цифры/одна точка), в стейте чистая строка для `parseUnits`
  - Verify: build/lint/тесты зелёные
  - Files: client/src/pages/Balances.tsx
- [x] Task 21: Статистика — полный дашборд: KPI-карточки, `grid-cols-2` (календарь + «ТУРНИРОВ ЗА ДЕНЬ» бар-чарт с цифрами), полная ширина «ПРОФИТ» кумулятивный лайн-чарт (per-tournament серия `tournamentProfitSeries`, таблица `tournamentCountByDay`) — кастомный SVG
  - Verify: сервер 95 тестов ✓, живой UI
  - Files: server/src/services/statistics.ts, server/tests/statistics.test.ts, client/src/lib/types.ts, client/src/pages/Statistics.tsx
- [x] Task 22: Переводы — `destination_room_id` (миграция v6), forced `direction='out'`, получатель кросс-конвертируется в cashCurrency рума по курсу дня, две ноги в `flowTotals`/`roomFlowsUsd` (перевод профит-нейтрален), рекомпьют обеих комнат при create/update/delete
  - Verify: сервер 104 теста ✓ (funds переписан, balances новый describe «transfers between own rooms» 5 тестов, db v6); live: перевод $10→900₽ по курсу 90, профит не трогает
  - Files: server/src/db.ts, server/src/services/{funds,balances}.ts, server/tests/{funds,balances,db}.test.ts
- [x] Task 23: UI транзакций — форма: «Откуда/Куда» для перевода (список румов кроме отправителя), «Рум/Направление» для депозита/вывода, валюта из `selectedRoom.cashCurrency`, дата=TODAY, поле «Комиссия» возвращено, удалены поля «Дата»/«Валюта». Таблица: перевод янтарным `⇄` без минуса, колонка «Комиссия» (`w-[100px]`), `colSpan=9`
  - Verify: build/lint/тесты зелёные (104+1); пользователь подтвердил работу переводов живьём
  - Files: client/src/pages/Transactions.tsx, client/src/lib/types.ts, client/src/lib/api.ts

## Phase 8: Цветовое кодирование румов (2026-09-16, следующая задача)

- [x] Task 24: Миграция v7 — `rooms.color` (TEXT, DEFAULT `#f1f5f9`) + одноразовый UPDATE по имени для существующих румов (Bybit→slate-100, GG→amber-200, PokerDom→emerald-300, RedStar→rose-300)
  - Verify: build/lint/тесты; `db.test.ts` пинит 7, колонка `color` есть
  - Files: server/src/db.ts, server/tests/db.test.ts
- [x] Task 25: Backend — `color` в `Room`/`RoomRow`, `validateColor` (`^#[0-9a-f]{6}$`, default slate-100), create/update сохраняют цвет, роуты POST/PUT принимают `color`
  - Verify: тесты rooms (store/default/update/invalid 400) — итого 107 серверных
  - Files: server/src/services/rooms.ts, server/src/routes/rooms.ts, server/tests/rooms.test.ts
- [x] Task 26: Клиент — `Room.color` + `ROOM_COLORS` + `DEFAULT_ROOM_COLOR`; `RoomPayload.color`; форма румов: пикер цвета
  - Files: client/src/lib/types.ts, client/src/lib/api.ts, client/src/pages/Rooms.tsx
- [x] Task 27: Глобально — имя рума красится цветом: Балансы (карточка), Сессии (таблица строк), Транзакции (ячейка рума, `→ получатель`, селекты формы/фильтра — selected value), попап турниров (селект), таблица Румов. Статистика имён румов не выводит
  - Verify: build ✓, lint ✓, сервер 107 + клиент 1 ✓
  - Files: client/src/pages/{Balances,Sessions,Transactions}.tsx, client/src/components/TournamentPopup.tsx
- [x] Task 28: Фидбек по пикеру — `ROOM_COLORS` 8 → **20** мягких цветов (Tailwind 200–300: lime-200 салатовый, sky/cyan-200 небесный, pink-200 розовый, indigo-200 индиго, violet-200 сиреневый, fuchsia-200 и др.; существующие цвета румов сохранены); форма: свотч-лента заменена на дропдаун-триггер (кружок `form.color` + стрелка, `relative` контейнер, панель `z-10 absolute mt-2 ... p-3` с сеткой `grid-cols-5`, клик по свотчу → выбор + закрытие, клик вне — через `mousedown`/`colorPickerRef`)
  - Verify: build ✓, lint ✓, сервер 107 + клиент 1 ✓
  - Files: client/src/lib/types.ts, client/src/pages/Rooms.tsx

## Phase 9: Статистика — фильтр по румам (2026-09-16)

- [x] Task 29: Backend — `sessionStats(dateFrom, dateTo, roomIds?)`, `tournamentProfitSeries(dateFrom, dateTo, roomIds?)`, `tournamentCountByDay(dateFrom, dateTo, roomIds?)` с `AND room_id IN (...)`; профит сессий пересчитывается как сумма только выбранных румов (`day.rooms.filter`); роут `/api/statistics/sessions` парсит `?roomIds=1,2,3`
  - Verify: сервер 111 тестов ✓ (4 новых: фильтр турниров/дней, сумма по выбранным румам, сессия при одном выбранном руме, пустая серия чужих румов)
  - Files: server/src/services/statistics.ts, server/src/routes/statistics.ts, server/tests/statistics.test.ts
- [x] Task 30: Клиент — `api.statistics.sessions(dateFrom, dateTo, roomIds?)` (сериализация `.join(',')`); UI: стейт `selectedRoomIds` (пусто = «Все румы»), кнопка «Все румы» + пилюли румов (цвет рамки/текста из `room.color`), перезагрузка данных по смене румов
  - Files: client/src/lib/api.ts, client/src/pages/Statistics.tsx
  - Фидбек пользователя ещё не получен — проверить глазами фильтры.

## Phase 10: Recharts + ROI math (2026-09-16, фидбек пользователя)

> Пользователь: самописные SVG-графики «отвратительные», без осей; ROI проигнорирован. Переход на Recharts и расчёт ROI/бай-инов.

- [x] Task 31: recharts 3.10.1 установлен (`client` workspace)
  - Files: client/package-lock, client/package.json
- [x] Task 32: Statistics.tsx — кастомные `<svg>`-чарты `TournamentsBarChart`/`ProfitLineChart` удалены; Recharts: `ResponsiveContainer`+`BarChart` (XAxis/YAxis/Tooltip/Bar) для «Турниров за день» (h-[350px]) и `LineChart`+`CartesianGrid`/`Line` (cumulativeUsd, amber, dots) для «Профит» (h-[400px]); тултипы в тёмной палитре #1e293b/#334155; значения оси Y в долларах (min-единицы /100, sign-aware $-формат)
  - Verify: build ✓, lint ✓, Vite transform 200, live API
  - Files: client/src/pages/Statistics.tsx
- [x] Task 33: ROI и Ср. бай-ин — расчёт в `sessionStats` (`tournamentAggregate`: totalBuyinUsd/totalProfitUsd, `averageBuyinUsd = totalBuyinUsd/count`, `roiPercent = profit/buyin×100`), поля в `SessionStatsResult`, карточки выводят реальные значения (ROI — зелёный/красный с `%`, бай-ин — в USD); заглушки `—` остались только при заведомо null
  - Verify: сервер **115 тестов ✓** (2 новых: числа ROI/avg на чистой математике USD-рума + фильтр по румам), клиент 1 ✓
  - Files: server/src/services/statistics.ts, server/tests/statistics.test.ts, client/src/lib/types.ts, client/src/pages/Statistics.tsx
- [x] AGENTS.md: стек обновлён (Recharts, кастомный SVG удалён), Open Items — ROI-заглушки сняты
- Live: `/api/statistics/sessions` отдаёт averageBuyinUsd 397 ($3.97), roiPercent -23.2

## Phase 11: Статистика — пропорции графиков + агрегация по месяцам (2026-09-16, фидбек пользователя)

> Пользователь: календарь и гистограмма разъезжаются; ПРОФИТ увеличить на 30%; цифры на столбиках; агрегация дней→месяцев на длинных периодах.

- [x] Task 34: Календарь и гистограмма — единая жёсткая высота `h-[400px]` на обоих карточках (гистограмма была 350, подтянута к календарю БЕЗ «+30%»). Календарь переведён на flex-col: шапка/статы `shrink-0`, сетка дней `flex-1 auto-rows-fr` (ячейки растягиваются равномерно на 5/6 строк в любой месяц — «идеально влезает» всегда), день недели отдельной строкой
  - Files: client/src/pages/Statistics.tsx
- [x] Task 35: ПРОФИТ — высота `h-[400px]` → `h-[520px]` (+30%)
  - Files: client/src/pages/Statistics.tsx
- [x] Task 36: Цифры над столбиками — `LabelList` из recharts внутри `<Bar dataKey="count">` (`position="top" fill="#f1f5f9" fontSize={12}`), top-margin поднят до 20 (метки не обрезаются)
  - Files: client/src/pages/Statistics.tsx
- [x] Task 37: Умная агрегация — `TournamentsBarChart` принимает `periodDays` (реальная длина выбранного диапазона dateTo−dateFrom+1); если >31 дня → группировка по `YYYY-MM` (count суммируется, ось X = «Сен 2026» через `MONTHS_SHORT_RU`), иначе — по дням как было. `XAxis interval="preserveStartEnd"` (первый/последний тик всегда видны)
  - Verify: build ✓, lint ✓, сервер 115 ✓, клиент 1 ✓; Vite HMR 200 (LabelList/h-[520px]/auto-rows-fr/periodDays в трансформации)
  - Files: client/src/pages/Statistics.tsx

## Phase 12: UX-ревью ввода турниров — рефакторинг попапа + редактирование (2026-09-16)

- [x] Task 38: TournamentPopup переработан — селекты «Рум»/«Валюта» удалены (окно получает `room: Room` + `date` пропсами, заголовок `Турниры — {имя} — {дата}`); backdrop-close удалён (только «Закрыть»); колонки «Бай-ин»/«Результат» отдельными заголовками; кнопки разделены на «Проверить» (preview без сохранения) и «Сохранить» (POST bulk + закрытие)
  - Files: client/src/components/TournamentPopup.tsx, client/src/pages/{Balances,Sessions}.tsx
- [x] Task 39: Умные строки — 5 пустых по умолчанию; авто-добавление пустой строки при заполнении последней (`next.every(isFilled)`); стабильные `key` через `crypto.randomUUID()` (фокус не прыгает); `tabIndex={-1}` у ✕ и «Закрыть»; пустые строки игнорируются, заполнен только бай-ин → результат 0
  - Files: client/src/components/TournamentPopup.tsx
- [x] Task 40: Backend — `POST /api/tournaments/preview` (`previewDayReconcile`, общий `computeReconcile`, вынесен `parseLines`); `tournamentsExistMap` + `hasTournaments` в `/api/balances/current`
  - Verify: сервер 117 тестов ✓ (+2: preview без персиста, tournamentsExistMap)
  - Files: server/src/services/tournaments.ts, server/src/routes/{tournaments,balances}.ts, client/src/lib/{api,types}.ts, server/tests/tournaments.test.ts
- [x] Task 41: Балансы — кнопка «Заполнить турниры» скрыта, если на (рум, дата) уже есть турниры (`!latest.hasTournaments`)
  - Files: client/src/pages/Balances.tsx
- [x] Task 42: Сессии — кнопка «изменить» в строке рума + заголовочные бейджи/«Турниры» открывают попап; попап при монтировании подтягивает сохранённые турниры + 1 пустую строку
  - Files: client/src/pages/Sessions.tsx
- [x] Task 43: Сталайнерии «изменить» — отдельный последний столбец таблицы (пустой `<th>` + `<td className="text-right">`), кнопки в ровную правую линию
  - Files: client/src/pages/Sessions.tsx
- [x] Task 44: Аудит исторических курсов — подтверждено: конверсия идёт строго по `date` из контекста сессии (`convertToUsd`/`convertCross` → дневной замороженный курс из `exchange_rates`, fallback только на последний ИЗВЕСТНЫЙ сорт; `new Date()`/`dayKey()` только в refresh (запись нового курса на текущий день) и статусе уведомлений). Регрессионный тест: прошлый день не подхватывает более новый курс
  - Verify: сервер 118 тестов ✓ (+1: frozen day rate против newer)
  - Files: server/tests/tournaments.test.ts
- [x] Проверено: build ✓, lint ✓, сервер 118 ✓, клиент 1 ✓

## Phase 13: Стабилизация (аудит + recoverability) (2026-09-16, финальная задача)

> Аудит по 4 векторам (SQLite durability / Node crash-handling / утечки / клиентская стабильность) → план из 8 пунктов + пункт 9 от пользователя утверждён → реализовано.

- [x] Task 45: `PRAGMA synchronous = NORMAL` в `db.ts` + `withTransaction<T>(fn)` с SAVEPOINT-вложенностью (`tx_N`, счётчик `transactionDepth`; корень BEGIN/COMMIT, вложенные SAVEPOINT/RELEASE с `ROLLBACK TO`+`RELEASE` при ошибке)
  - Verify: сервер 120 тестов ✓ (+2 в db.test.ts: commit/rollback верхнего уровня; вложенность — откат внутренней тянет внешнюю)
  - Files: server/src/db.ts, server/tests/db.test.ts
- [x] Task 46: Многошаговые записи — только через `withTransaction`: `balances.recomputeRoomBalances`, `funds.create/update/deleteTransaction`, `tournaments.replaceDayTournaments`
  - Files: server/src/services/{balances,funds,tournaments}.ts
- [x] Task 47: Node/Fastify crash-handling в `index.ts` — флаг `shuttingDown`, `shutdown(exitCode)`, обработчики `uncaughtException`/`unhandledRejection` (лог `app.log.error({err})`), `.catch` на оба вызова `refreshAllRates` (startup + 4h интервал); `pokerdon.getBrowser` сбрасывает `browserPromise=null` при отказе запуска, `closeBrowser` через `catch(()=>null)`
  - Files: server/src/index.ts, server/src/services/rates/pokerdon.ts
- [x] Task 48: Клиентская стабильность — `api.ts`: таймаут 15с (`AbortController` + `AbortSignal.any`), сообщение «Сервер не ответил в течение 15 секунд»; `ErrorBoundary` (fallback bg-slate-900 + «Перезагрузить страницу»); `usePoll.ts` (рекурсивный `setTimeout`, следующий тик после завершения предыдущего, guard на unmount); health в App каждые 30с, BankrollBadge/NotificationsBanner переведены с `setInterval` на `usePoll` (пункт 9)
  - Verify: build ✓, lint ✓, сервер 120 + клиент 1 ✓
  - Files: client/src/lib/api.ts, client/src/components/ErrorBoundary.tsx (новый), client/src/lib/usePoll.ts (новый), client/src/App.tsx
- [x] Проверено: `npm run build` (client+server) ✓, `npm run lint` ✓, сервер **120 тестов (15 файлов)** ✓, клиент **1 тест** ✓

## НА СЛЕДУЮЩЕЙ СЕССИИ

> Блок устарел: пункты ниже закрыты Фазами 14–17 (см. ниже по файлу) и спринтом «Аудит+рефакторинг». Актуальное состояние — Phase 17 + `tasks/session-log.md` (запись «закрытие дня 2026-09-17»). Сохраняю как архив, не удаляю.

- [ ] Проверить глазами разделение импортов по шаблону рума: PokerDom → только текст, GG → только архив, RedStar/кастомный → только ручной ввод (Phase 16 доп.)
- [ ] Проверить глазами Phase 16: вставка реального отчёта PokerDom в попап турниров → preview с конвертацией, «Сохранить» (дедуп при повторной вставке), удаление ✕
- [ ] Посмотреть глазами «Статистику»: графики Recharts (оси, тултипы, тёмная тема), карточки ROI и «Ср. бай-ин» с реальными цифрами — фидбек
- [ ] Проверить глазами Phase 11: календарь и гистограмма вровень (h-[400px] оба), ПРОФИТ выше (h-[520px]), цифры на столбиках, пресет «За год» → бары по месяцам («Сен 2026»), «За месяц/неделю/день» → по дням — фидбек
- [ ] Проверить визуально фильтр по румам (Task 30 — фидбек ещё не получен) и цветовой кодинг (Tasks 24–28)
- [ ] Проверить глазами Phase 12: попап турниров (заголовок, колонки, «Проверить»/«Сохранить», 5 строк + авто-добавление, Tab-навигация, скрытие кнопки на Балансах, «изменить» в Сессиях) — фидбек
- [ ] Open item (давно не решён): Production single-port — `@fastify/static` установлен, НЕ подключён — вопрос пользователю.
- [ ] Open item: удалить осиротевшие `client/src/components/ProfitChart.tsx` и `client/src/pages/Placeholder.tsx`? — вопрос пользователю.
- [ ] Обновить план Фазы 13 в plan.md, если он туда перенесён (устаревшее: better-sqlite3/React 18 в plan.md уже помечены).
- [ ] При новом фидбеке: отчёт ТОЛЬКО в формате `[Файл]->[код]->[что]->[почему]`, маркеры `// ...`, без простыней.

## Phase 14: GG-импорт турниров + CNY (2026-09-16, первый батч)

> Задачи: 1) CNY прямой кросс без ЦБ РФ + ручной курс на рум; 2) парсер $0/¥0 жёстко как число; 3) даты турниров — из файла. Порядок: отчёт → код первого батча.

- [x] Отчёт Задачи 1 и 2: файлы с нулевым кэшем — 6 шт (`#311146578 $0`, `#311148763 ¥0`, `#311150859 $0`, `#311155449 $0`, `#313685521 $0`, `#313686053 $0`); гарантия `result: 0` (якорь `You received a total of` + регэксп + проверка «число», не truthiness); CNY — `open.er-api.com/v6/latest/USD` (проверено живьём: CNY=6.726834), без рубля и ЦБ
- [x] Миграция v8 (`db.ts`): `tournaments +name/rank/entrants/tournament_id` + `CREATE UNIQUE INDEX (room_id, tournament_id)` (дедуп переимпорта, NULL суточные не мешают); таблица `rate_overrides (room_id, from, to, rate, UNIQUE)`; `user_version = 8`
- [x] `ggimport.ts`: парсер GG-отчёта — 5 полей (name/buyin/result/rank/entrants) + дата `Tournament started` + `tournament_id`; символы `$→USD`, `¥→CNY`, `€→EUR`, `₽→RUB`, fallback на валюту рума; `GgParseError` на отсутствие якоря; тесты на 11 реальных файлах архивов
- [x] CNY-фид: `eras.fetchCnyUsdRate` (latest/USD, plausibility 1–15), `refresh.refreshCnyUsd` + `KIND_CNY_USD_FAILED` + `RefreshResult.cnyUsd` + `RatesStatus.cnyUsd`; `rooms.validateCurrency` +CNY; `money.formatMinUnits` +¥ (сервер и клиент); клиент `COMMON_CURRENCIES` +CNY
- [x] Оверрайд курса: `rates/overrides.ts` (get/set/delete/list + валидация), `convert.resolveCrossScaled` — приоритет ручной > замороженный день > последний; `roomId` прокинут в convertToUsd/convertCross (tournaments, statistics, funds, sessions, balances, routes/balances); CRUD `routes/rates.ts` (GET/PUT/DELETE `/api/rates/overrides`)
- [x] Шаблон «GG» в `templates.ts` (rateSource `er-api`), детект «gg»/«ggpoker»/«джиджи»; `RATE_SOURCE_LABEL` = «EUR/USD и CNY/USD (er-api)»
- [x] Дальше (на согласование зависимостей): endpoint `POST /api/tournaments/import-gg` (`@fastify/multipart` + `adm-zip`), распределение по датам из файла, upsert по `(room_id, tournament_id)`, UI «Загрузить архив» в попапе турниров, вкладка «Турниры»

## Phase 14: GG-импорт турниров + CNY (второй батч — эндпоинт, сейв, UI)

> Правила пользователя (жёсткие): 1) импорт stateless (распарсенный ZIP в RAM, в БД только по «Сохранить»); 2) стоп-кран X/Y файлов (красный баннер + блокировка сохранения); 3) атомарный upsert по `tournament_id`; 4) мульти-даты из файла + интерполяция баланса для дня без записи; 5) ¥→CNY, конверсия по дате самого турнира.

- [x] Установлены `@fastify/multipart` + `adm-zip` (+`@types/adm-zip`) в `server` workspace; `app.ts` регистрирует multipart (лимиты: 1 файл, 20 МБ, 5 полей)
- [x] `ggimport.parseGgZipArchive(buffer, fallbackCurrency)` — распаковка ZIP в памяти, фильтр `*.txt`, `parseGgFile/buffer → {tournaments, failed[{fileName,error}], totalTxtFiles}`; не-zip → `GgParseError`; НИЧЕГО не пишет в БД
- [x] `tournaments.ts`: `TournamentRow` +name/rank/entrants/tournamentId (SELECT/mapRow); `replaceDayTournaments` удаляет ТОЛЬКО ручные строки (`tournament_id IS NULL`) — риск переимпорта не затирает импортированные; `previewDayReconcile` принимает `imports` (строки дня своей даты); новый `saveDayBatch(roomId, modalDate, lines, imports)` — manual заменяет ручные строки модальной даты, импорт distributes по своим датам и upsert'ится `ON CONFLICT(room_id, tournament_id) DO UPDATE`, дедуп по tournamentId, после tx → `recomputeRoomBalances`, возвращает rows + reconcile по всем затронутым датам
- [x] `balances.recomputeRoomBalances` — набор `dates` теперь включает `DISTINCT tournament dates`; на турнирный день без транзакций создаётся авто-запись carry-forward (интерполяция баланса), в результате сессия дня сходится и помечается на сверку
- [x] `routes/tournaments.ts`: `POST /api/tournaments/import-gg` (multipart: поле roomId + файл; `req.parts()`; GgParseError→400; ответ `{tournaments, totalTxtFiles, successfullyParsed, failed}`); `/bulk` расширен опциональным `imports` → `{rows, reconcile, days}`; `/preview` — тоже `imports`
- [x] Клиент: `types.ts` — `TournamentRow` новые поля, `TournamentImportEntry`, `GgImportResult`/`GgImportFailure`, `RATE_SOURCE_LABEL` +CNY; `api.ts` — `request` с `timeoutMs` и пропуском `Content-Type` для `FormData`; `tournaments.importGg(roomId, file)` (FormData, таймаут 30с), `save`/`preview` принимают `imports`
- [x] UI `TournamentPopup.tsx`: секция «Импорт из архива GG» (file input), список распарсенных турниров (дата/имя/байин/результат/место), счётчик «Разобрано X из Y», красный баннер при `parsed < total` (текст пользователя verbatim) + блокировка «Сохранить»/«Поправить баланс»/«Списать на казино», «Убрать импорт»; сохранённые импортированные строки при открытии попапа показываются read-only
- [x] Тесты: `tournaments.test.ts` +8 (upsert/дедуп, мульти-даты, интерполяция авто-баланса, ручной не затирает импорт, CN¥ по дате турнира, валидация до записи, preview только день); новый `import-gg.test.ts` — 6 э2е (stateless!, X/Y партил, fallback CNY, non-zip 400, unknown room 404, нет файла 400) через `app.inject` + самодельный multipart + adm-zip
- [x] Проверено: `npm run build` ✓ (client+server), `npm run lint` ✓, сервер **162 теста (17 файлов)** ✓, клиент **1 тест** ✓

## Phase 14: Инженерный аудит — 3 «белых пятна» закрыты (2026-09-16)

> Вопросы аудита: 1) как удалять импортированные турниры; 2) TZ-безопасность даты в парсере; 3) что с UI после сохранения мульти-дат. Ответы: 2 — дата строгая подстрока `YYYY/MM/DD` из текста (без `new Date` на таймстампе), TZ не влияет; 3 — попап закрывается после «Сохранить», при повторном открытии `list` фильтрует только свою дату → чужие дни не показываются (+добавлена подсказка о распределении дат); 1 — была недоработка → исправлено:

- [x] Сервер — `tournaments.deleteImportedTournament(roomId, tournamentId)`: DELETE по `(room_id, tournament_id)` + `recomputeRoomBalances` (авто-интерполяция на день без турниров снимается); 400 на не-целое id, 404 на отсутствующий
- [x] Роут — `POST /api/tournaments/delete-import` (body `{roomId, tournamentId}` → `{ok:true}`)
- [x] Клиент — `api.tournaments.deleteImport(roomId, tournamentId)`; попап: `savedImportIds` (какие импорты уже в БД), таблица импортов показывается при `imports.length > 0` (не только при свежем parse — ранее сохранённые импорты были невидимы), колонка ✕ (для сохранённых → deleteImport + `onChanged()`, для разобранных → локальное удаление), подсказка «Турниры из архива распределятся по датам из отчётов: …», «Убрать импорт» только для несохранённых
- [x] Тесты: `tournaments.test.ts` +4 (`imp` вынесен на уровень модуля; удаление по id из любого дня, авто-баланс снимается, 400/404), `import-gg.test.ts` +3 (успешный delete + рекомпьют, 400 не-целое, 404 неизвестное)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **169 тестов (17 файлов)** ✓, клиент **1 тест** ✓

## Phase 14: Финальный батч — вкладка «Турниры» (2026-09-16)

> ТЗ строгое: фильтры+KPI (как Статистика), сводная таблица (правило А: по имени для импортов; правило Б: по лимиту для ручных), accordion-детализация, сортировка.

- [x] Сервис — `statistics.tournamentSummary(dateFrom, dateTo, roomIds?)`: всё в USD по замороженному кросс-курсу дня (overrides учтены); правило А — группы по `name` (название, сыграно, бай-ин USD, профит USD, ROI, лучшее место = min rank, ср. участников = mean entrants); правило Б — ручные строки (name IS NULL) группируются по `(currency, buyin)`, лейбл «Турниры за 250 RUB»; KPI (count/totalBuyinUsd/totalProfitUsd/roiPercent), `blank` если часть строк не сконвертировалась; счётчик всегда полный, суммы USD — только от конвертируемых
- [x] Роут — `GET /api/tournaments/summary?dateFrom&dateTo&roomIds=1,2` (валидация диапазона, 400 при отсутствии/инверсии, парсинг roomIds)
- [x] Клиент — `types.ts` (TournamentSummary/TournamentGroup/TournamentDetailRow), `api.tournaments.summary(dateFrom, dateTo, roomIds?)`
- [x] Страница `Tournaments.tsx`: пресеты (За день/неделю/месяц/год + кастом), пилюли румов (паттерн Статистики), 4 KPI-карточки («Сыграно турниров», «Общий профит», «ROI», «Сумма бай-инов»), сортируемая таблица (по умолчанию профит ↓; сортировка по названию/сыграно/бай-ин/профит/ROI с ▲▼), аккордеон по клику — детали группы (Дата/Рум/Место/Профит), пустое состояние «Нет турниров за период»
- [x] Вкладка — `App.tsx`: TabId 'tournaments', лейбл «Турниры» (между «Депозиты и выводы» и «Статистика»)
- [x] Тесты: `statistics.test.ts` +6 (агрегация именованных с лучшим местом/ср. участниками/ROI, ручные по лимиту с лейблом и по-строчным округлением USD, кросс-курсы USD/RUB/EUR/CNY по датам, фильтр по румам/диапазону, инверсия 400, blank при неконвертируемой строке), `import-gg.test.ts` +3 (эндпоинт: KPI+группы, 400 без диапазона/инверсия, roomIds фильтр)
- [x] Live-проверка на реальных данных: 16 турниров, ROI −23.2, группы по лимитам EUR/USD/RUB корректны
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **178 тестов (17 файлов)** ✓, клиент **1 тест** ✓

## Phase 15: Патч GG-парсера — Re-entry + мульти-архивы (2026-09-17)

> Боевой архив дал `parsed 13/14`: файл `#312073697` содержит не стандартную строку результата, а `You made 1 re-entries and received a total of $0.` Старый заякоренный `RESULT_RE` её не находил. Плюс ТЗ: учитывать ре-энтри в бай-ине и разрешить загрузку нескольких архивов подряд.

- [x] `parseGgFile` — `RESULT_RE` → `/^You (?:made (\d+) re-entr(?:y|ies) and )?received a total of\s*(.+)$/`: группа 1 = количество ре-энтри (undefined для стандарта), группа 2 = сумма (индекс сдвинут с 1 на 2)
- [x] Математика бай-ина — `finalBuyin = baseBuyin * (1 + reEntries)`: `reEntries=0` → без изменений, `1` → ×2, `2` → ×3; базовый бай-ин по-прежнему из строки `Buy-in:`
- [x] Тесты `ggimport.test.ts` +6: база без ре-энтри (250), ×2 (500), ×3 (750), выплата ре-энтри как число (850), реальный отчёт `#312073697` (buyin 500, result 0, rank 2679, entrants 4276, USD), регрессия стандартного отчёта (250/997)
- [x] UX `TournamentPopup` — append вместо перезаписи: `setImports((prev) => [...prev, ...new.filter(не в seen по tournamentId)])` (дедуп по `tournamentId` в стейте, повторный тот же архив не дублирует строки); `savedImportIds` больше не сбрасывается на каждой загрузке
- [x] Статистика по архивам — `archiveStats: {fileName,total,parsed,failed}[]`: кумулятивные счётчики по всем загруженным архивам в окне, повторная загрузка того же файла заменяет его запись (не суммируется дважды); `importBlocked` — если любой архив пуст или `parsed < total`; баннер «нет файлов»/«формат не совпадает» по совокупности; ошибка загрузки больше не стирает уже разобранный список
- [x] Проверено: `npm run build` ✓ (client+server, exit 0), `npm run lint` ✓, сервер **184 теста (17 файлов)** ✓, клиент **1 тест** ✓

## Phase 16: Импорт турниров из текста PokerDom (2026-09-17)

> ТЗ: вставка текста из буфера (не архив); парсер дат «16 сент., 14:00»; хэш `название + дата/время + бай-ин`; без никнейма и рейка; preview → «Сохранить» (stateless, дедуп по хэшу, как GG).

- [x] Парсер `server/src/services/pokerdomimport.ts` — `parsePokerDomText(text, fallbackCurrency)`: блоки «дата/название/формат/бай-ин/[Вхождение #N]/строка результата»; `DATE_RE` (русские месяцы, `[а-яё]*[.,\s]+` — точка после «сент.»); `Вхождение #N` → бай-ин ×N; `tournamentId = |hash|(name|дата время|бай-ин)` (время в хэше — иначе два разных запуска одного турнира в один день получат одинаковый id и затирались бы upsert'ом); место/результат из последней строки; валюта всегда RUB; `PokerDomParseError`
- [x] Тесты `server/tests/pokerdomimport.test.ts` — 13: реальный отчёт 11 турниров (failed ∅), метаданные, стабильные ID + уникальность с учётом времени, ре-паст даёт тот же id, `Вхождение #2`→×2, блок без «Вхождения», нулевой результат, пробелы в тысячах, сбор ошибок при сломанном блоке, мусорные строки игнорируются, одновременные турниры, мульти-дни
- [x] Роут `POST /api/tournaments/import-pokerdom` (JSON `{roomId, text}`, stateless, 400 пустой текст, 404 чужой рум) + `import-gg.test.ts` +5 э2е (парсинг stateless, стабильные id, дедуп через `/bulk` upsert 3→3, 400/404)
- [x] Клиент: `types.ts` — `PokerDomImportResult`/`PokerDomImportFailure`; `api.tournaments.importPokerDom(roomId, text)`
- [x] UI `TournamentPopup.tsx` — карточка «Импорт из текста PokerDom (вставка из буфера)»: textarea + «Вставить и разобрать», зелёный счётчик «Разобрано турниров: N», янтарный список несобранных блоков, строки мержатся в общий preview с дедупом по `tournamentId` (сброс на открытии попапа)
- [x] Проверено: `npm run build` ✓ (client+server), `npm run lint` ✓, сервер **202 теста (18 файлов)** ✓ (pokerdomimport 13 + import-gg 5), клиент **1 тест** ✓; live: `import-pokerdom` 2/2 через Node-fetch (PowerShell консоль искажает кириллицу — артефакт консоли, не кода)
- [x] Условный рендеринг по шаблону рума — `client/src/lib/templates.ts` (зеркало серверного `detectRoomTemplate`: pokerdom/redstar/gg по имени, алиасы как в `templates.ts`); `TournamentPopup` гейтит секции: GG-архив → только шаблон `gg`, текст PokerDom → только `pokerdom`, прочие румы (в т.ч. RedStar) → только ручной ввод; общая preview-таблица разобранных строк вынесена из GG-карточки на верхний уровень (видны строки обоих импортов)
- [x] Тест клиента `client/tests/templates.test.ts` — 4: распознавание PokerDom (латиница/кириллица/суффикс), GG, RedStar отдельным шаблоном, null для кастомных/пустых
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **202 теста (18 файлов)** ✓, клиент **5 тестов (2 файла)** ✓, Vite transform TournamentPopup 200

## Phase 17: Спринт «Архитектурный аудит + безопасный рефакторинг» (2026-09-17)

> Аудит по 6 векторам (read-only) → план утверждён → 3 этапа реализовано, Этап 4 в бэклог. Полный отчёт — в `tasks/session-log.md` (запись «закрытие дня»).

- [x] Этап 1 (бэкенд, стейбл-рефакторинг): миграция v9 — уникальный индекс `idx_tournaments_date_room (date, room_id)` (база СЕЙЧАС СУЩЕСТВУЕТ, поездка по строкам ДО индекса); `saveDayBatch` и `deleteImportedTournament` обёрнуты в `withTransaction` (ранее за пределами tx); тест индекса в `db.test.ts`; AGENTS.md → v9
  - Verify: сервер 202 теста ✓ (19 файлов), build/lint ✓
  - Files: server/src/db.ts, server/src/services/{tournaments,balances}.ts, server/tests/db.test.ts
- [x] Этап 2 (фронтенд, мульти-клик/гонки): `TournamentPopup.tsx` — `busyRef` (атомарный lock против двойных кликов `handleFile`/`handleParseText`/`removeImport`/`preview`/`save`/`saveThen`) + `mountedRef` (cleanup effect, защита `setState` после unmount); `Sessions.tsx` — `refreshSeq` (useRef-счётчик инвариантности ответа) + `mountedRef` против гонок `reconcileSummary` при смене диапазона
  - Verify: build/lint ✓, сервер 202 ✓, клиент 5 ✓
  - Files: client/src/components/TournamentPopup.tsx, client/src/pages/Sessions.tsx
- [x] Этап 3 (Стратегия/Фабрика для импорта турниров): контракт `ITournamentParser` (`services/parsers/types.ts`: `TournamentParserInput` zip|text, `TournamentParseResult {tournaments, successfullyParsed, failures, totalSources}`, `TournamentParseError`); адаптеры `ggParser` (accepts 'zip') и `pokerdomParser` (accepts 'text', USD-конверсия перенесена в парсер); реестр `services/parsers/registry.ts` + `resolveTournamentParser(room)` по `detectRoomTemplate`; единый `POST /api/tournaments/import/:roomId` вместо `/import-gg` + `/import-pokerdom` (501 если парсера нет, 400 на `TournamentParseError`); клиент — единые `TournamentImportResult`/`TournamentImportFailure`, api.ts URL `/tournaments/import/${roomId}`, попап на `failures`/`source`/`totalSources`
  - Verify: build/lint ✓, сервер **207 тестов (19 файлов)** ✓ (+5: import-gg 501, registry 4), клиент 5 ✓
  - Files: server/src/services/parsers/*, server/src/services/{ggimport,pokerdomimport}.ts, server/src/routes/tournaments.ts, client/src/{lib/types.ts,lib/api.ts,components/TournamentPopup.tsx}, server/tests/{import-gg,tournament-parser-registry}.test.ts
- [ ] Этап 4 (виртуализация списков терниров) — **В БЭКЛОГ**: отложен техлидом при текущих объёмах данных (преждевременная оптимизация). Включить, когда число турниров начнёт заметно тормозить рендер.
- [x] Код-ревью Этапов 2–3 пройдено техлидом («реализация блестящая, техдолг закрыт»). Спринт завершён ✔

## Phase 18: «Ожидание импорта турниров» — аудит + персистентный маркер + расхождения в транзакциях (2026-09-17)

> ТЗ: кнопка-ожидание переживает F5/рестарт; старый pending умирает при новом балансе; пропущенный импорт — поправка банкролла без поломки статистики. Step 7 от пользователя — осиротевшие расхождения в «Депозиты и выводы» со «Списать». Backfill отменён. Подробности — `tasks/session-log.md` (запись «Аудит + Шаги 1–7»).

- [x] Миграция v10 (`db.ts`): `pending_imports (id, room_id REFERENCES rooms ON DELETE CASCADE, date, created_at, UNIQUE(room_id, date))` + `idx_pending_imports_room_date`; пустая на создание; `db.test.ts` пинит 10 + UNIQUE/CASCADE
- [x] `services/pending.ts`: `reconcilePendingImports(roomId)` (DELETE все pending рума → маркер ⇔ на `MAX(date)` manual-записи нет турниров), `pendingImportPairs()`, `listPendingImports()`; внутри `withTransaction`
- [x] Ток-пойнты: `balances.upsertBalance` обёрнут в `withTransaction` + reconcile; `saveDayBatch`/`deleteImportedTournament`/`replaceDayTournaments` — reconcile в своих tx
- [x] `GET /api/balances/current` → `pendingImport`; `Balances.tsx` — `savedFor` удалён, кнопка = `latest.pendingImport`, дата = `latest.date`
- [x] «Депозиты и выводы»: `orphanedDiscrepancies` (flagged, remainder≠0, без pending) + `writeoffDiscrepancy` (обязательный комментарий ≤500, `storeCasinoWriteoff` upsert) в `services/tournaments.ts`; роут `GET /api/transactions?includeDiscrepancies=1` + `POST /api/transactions/writeoff-discrepancy`; UI `Transactions.tsx` — янтарные строки + ⚠(SVG) + «Списать» + модал с комментарием
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **226 тестов (21 файл)** ✓ (+9 pending, +8 transactions-discrepancy, +2 db v10), клиент **5 тестов (2 файла)** ✓
- [x] AGENTS.md актуализирован (v10, pending, transactions-роуты, 21 файл); session-log запись

## Phase 19: Подготовка к продакшену — мёртвый код + production single-port (2026-09-17)

> Решение: ручное UI-тестирование пропущено (не засоряем боевую базу фейками), полагаемся на тесты. Цель — закрыть 2 open item'а.

- [x] Удалены `client/src/components/ProfitChart.tsx` и `client/src/pages/Placeholder.tsx` — grep по `client/src` нашёл только self-ссылки, импортов в App.tsx/прочих нет
- [x] `server/src/app.ts`: `CreateAppOptions { logger?, serveClient? }`, статика через `@fastify/static` (ключ гейтится `NODE_ENV==='production'`), путь `fileURLToPath(new URL('../../client/dist/', import.meta.url))`, guard на существование `index.html`, SPA-fallback в `setNotFoundHandler`: GET/HEAD не-`/api` → `index.html`, всё прочее → JSON 404
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **226 (21 файл)** + клиент **5 (2 файла)** ✓
- [x] Live single-port на 3111 (dev 3001/5173 не трогаем): health 200, `/` 200 html, asset 200, `/tournaments` 200 html (SPA), `/api/nonexistent` 404 JSON; процесс остановлен Stop-Process по PID
- [x] AGENTS.md: `npm run start` → «клиент + API», app.ts описание, Open Items починены (single-port/осиротевшие сняты); session-log запись

## Phase 20: Кошельки/биржи (rooms.is_wallet) — миграция v11 (2026-09-17)

> Кошелёк — владелец баланса без турниров. Флаг `is_wallet` управляет pending-инвариантом и списками румов в игровых вкладках; в «Балансах»/«Депозитах» отображается как обычно.

- [x] Миграция v11 (`db.ts`): `ALTER TABLE rooms ADD COLUMN is_wallet INTEGER NOT NULL DEFAULT 0` + `UPDATE rooms SET is_wallet = 1 WHERE LOWER(TRIM(name)) = 'bybit'`; `runMigrations` экспортирован для upgrade-теста; `db.test.ts` пинит 11 + тест апгрейда v10→v11 (Bybit/bybit → 1, PokerDom → 0)
- [x] `services/rooms.ts`: `isWallet` в `Room`/`RoomRow`/`mapRow`/`createRoom`/`updateRoom`, `validateIsWallet` (boolean|0/1, дефолт false); `updateRoom` обёрнут в `withTransaction` + `reconcilePendingImports` (пометка кошельком сразу снимает маркер); `routes/rooms.ts` — `isWallet` в Body POST/PUT
- [x] `services/pending.ts`: `reconcilePendingImports` — DELETE маркера, затем early-return для `is_wallet` (кошелёк маркер не получает)
- [x] Клиент: `Room.isWallet`, `RoomPayload.isWallet`; `Rooms.tsx` — чекбокс «Кошелек» + бейдж; `Tournaments.tsx`/`Statistics.tsx`/`Sessions.tsx` — `rooms.filter(r => !r.isWallet)` (в «Сессиях» фильтр-пилюль нет: список румов питает цвет и попап турниров)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **232 теста (21 файл)** ✓ (+6: db v11-апгрейд, rooms 2, pending 3), клиент **5 тестов (2 файла)** ✓
- [x] AGENTS.md актуализирован (v11, блок «Кошельки», pending, db.ts, rooms, 21 файл); session-log запись

## Phase 21: Баг-фикс «Лучший/Худший день» в «Сессиях» + аудит «Статистики» (2026-09-17)

> Виджеты «Сессий» брали экстремум по одному руму, а не по дню. В «Статистике» аналогичные метрики уже считались по дням — подтверждено аудитом, код не менялся.

- [x] `client/src/pages/Sessions.tsx`: `summary` («Лучший/Худший день») переведён с `sessions[].rooms[].profitUsd` на дневной `SessionDay.totalUsd` (`flatMap` + отсев `null`); `total` не изменился, т.к. сумма дневных тоталов = сумма по румам
- [x] Аудит `server/src/services/statistics.ts`: `bestSessionUsd`/`worstSessionUsd` уже берутся из дневных `profitUsd` (по одной `SessionStat` на день, `profitUsd = day.totalUsd` или сумма выбранных румов) — изменений не требовалось
- [x] Regression-тест `statistics.test.ts`: многорумный день (PokerDom +$40.00 + RedStar +€2.00=+$2.20) → `bestSessionUsd = 4220`, `worstSessionUsd = -3000` (прежний покомнатный расчёт дал бы 4000)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **233 теста (21 файл)** ✓ (+1), клиент **5 тестов (2 файла)** ✓

## Phase 22: «Цели» — первый вертикальный срез (архитектура DDD-модуля, миграция v12) (2026-09-17)

> Архитектурный план утверждён: `docs/architecture/goals-module.md` (модуль-лист, read-only факты + lazy-реконсиляция, метрики bankroll+distance, милстоуны 50/75/100, UNIQUE-милстоуны, изолированная папка `client/src/goals/`). Полные решения — в `tasks/session-log.md` (запись «Цели»).

- [x] Этап A: зависимость `motion` в `client` (одобрена пользователем, единственная новая); миграция v12 — `goals` (metric без CHECK, status CHECK, target_units>0) + `goal_entries` (kind CHECK, UNIQUE(goal_id, milestone), CASCADE); `db.test.ts` пинит 12 + UNIQUE/CASCADE/status-CHECK тест
- [x] Этап B: `services/goals/{types,db,metrics,reconcile,service}.ts` — `collectGoalsFacts` (latest-балансы→USD + COUNT турниров, read-only SQL), реестр `METRIC_RESOLVERS` (bankroll, distance), `reconcileGoal` в `withTransaction` (милстоуны 50/75/100 идемпотентно через entryExists, auto-achieved, fail по дедлайну, blank при нехватке курсов); роут `routes/goals.ts` + регистрация в `app.ts`; тесты `goals.test.ts` + `goals-route.test.ts` (19)
- [x] Этап C: `client/src/goals/` — `goals.types.ts`, `goals.api.ts` (через экспортированный `request`), `metrics.ts` (зеркало label/форматов, склонение «турнир/а/ов», группировка тысяч), `useGoals.ts` (локальный стейт, error-state на мутациях); компоненты `GoalsBackground` (indigo-эмбиент), `GoalRing` (SVG-кольцо с motion, pathLength=1), `GoalCard` (фраза, статус, таймлайн 50/75/100, заметки), `GoalCreator` (метрика/цель/дедлайн); `App.tsx` — вкладка «Цели» между «Турниры» и «Статистика», `React.lazy` + `Suspense` + `AnimatePresence mode="wait"` (exit 250ms у «Целей», 0ms у остальных) + `MotionConfig reducedMotion="user"`
- [x] Проверено: `npm run build` ✓ (GoalsPage отдельный чанк 14.4 kB — lazy работает), `npm run lint` ✓ (0 warning), сервер **253 теста (23 файла)** ✓ (+19, +1 db v12), клиент **13 тестов (3 файла)** ✓ (+8 цели)

## Phase 23: «Цели» Slice 2 — Премиальный UX, Анимации и Таймлайн (2026-09-17)

> Принят Slice 1. ТЗ Slice 2: тестовые библиотеки (одобрены), layout-раскрытие карточки, лента дневника (системные милстоуны + user-заметки, плавное появление), PercentCounter на useSpring, AchievedHalo, эмбиент на всю высоту при скролле. Подробности — `tasks/session-log.md` (запись Phase 23).

- [x] Зависимости: `jsdom`, `@testing-library/react` 16, `@testing-library/dom`, `@testing-library/user-event` (devDeps `client`); `vite.config.ts` — vitest jsdom + `pretendToBeVisual` + `setupFiles`; `tests/setup.ts` — auto-cleanup + стабы matchMedia/ResizeObserver/scrollTo
- [x] `PercentCounter.tsx` — useSpring-счётчик процента (raw 0 → value в useEffect, `useTransform(round)`, `<motion.span>{display}</motion.span>`); `GoalRing` выводит через него цифру
- [x] `AchievedHalo.tsx` — пульсирующее emerald-свечение (repeat Infinity 2.8s + blur), `data-testid`, reduced → статика; подключён в `GoalCard`
- [x] `GoalsBackground.tsx` — `absolute inset-0 min-h-[100vh]` вместо `fixed` (тянется на всю высоту при скролле)
- [x] `useGoals.ts` — `expandedId` + `toggleExpanded`; `GoalsPage` передаёт в GoalCard
- [x] `GoalCard.tsx` — свертываемая карточка: шапка-button (aria-expanded) с шевроном, `layout`-раскрытие, «Дневник»+`GoalTimeline`+`EntryComposer`+«Завершить» в AnimatePresence-секции, `AchievedHalo` сверху
- [x] `GoalTimeline.tsx`/`TimelineEntry.tsx` — лента с градиент-рейлом, цветные точки (system/user/milestone/время цели), стаггер-вход, AnimatePresence для плавного появления новых записей
- [x] `EntryComposer.tsx` — вынесенный инпут заметки (локальный стейт, очистка при успехе, `role="alert"`)
- [x] Тесты клиента: `goals-card.test.tsx` (раскрытие/сворачивание, submit заметки, halo только у achieved), `goals-ui.test.tsx` (GoalTimeline empty/system+user, PercentCounter доезд до 42)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **253 (23 файла)** ✓, клиент **20 (5 файлов)** ✓
- [x] AGENTS.md актуализирован (v12 + services/goals + client/src/goals + тестовая среда jsdom); session-log запись

## Phase 24: Изоляция «Mystery Battle Royale» (MBR) — готово (24.1–24.5)

> детальный план: `tasks/plan-mbr-isolation.md`. MBR (hyper-turbo, 18-max, только GG) не
> влияет на MTT-статистику, кроме графика профита; отдельный блок во вкладке «Турниры».
> ⚠ Миграция v13 уже занята `goals.title` (Phase 25) — MBR стартует с **v14** + бэкфилл
> 20 строк (GG, 2026-09-16). Флаг `tournaments.is_mbr`; реконсиляция
> и профит-график остаются всё-инклюзивными.

- [x] Task 1: Миграция v14 — `tournaments.is_mbr` (default 0) + бэкфилл `UPDATE ... WHERE TRIM(name) LIKE 'Mystery Battle Royale%'`; пин 13→14 + апгрейд-тест v13→v14
- [x] Task 2: `isMbrByName()` + `saveDayBatch` проставляет флаг (импорты; upsert-ветка) + `is_mbr` в `TournamentRow`/SELECT
- [x] Task 3: `statistics.ts` — SQL-хелпер c `mbr: 'all'|'mtt'|'mbr'`; `is_mbr=0`: tournamentCount, avgBuyin/ROI, tournamentCountByDay, activityCalendar, tournamentSummary; profitSeries — all
- [x] Task 4: `GET /api/tournaments/summary` → `{ summary, mbr }`
- [x] Task 5: pending-маркер (`AND is_mbr=0`) + `tournamentsExistMap` (кнопка «Заполнить турниры»)
- [x] Task 6: goals `collectGoalsFacts` — COUNT турниров с `is_mbr=0` (distance)
- [x] Task 7: клиент — `MbrSummary` + тип ответа `{summary, mbr}` в `types.ts`/`api.ts`
- [x] Task 8: `Tournaments.tsx` — блок «Mystery Battle Royale» (шапка: сыграно/профит/ROI/ср. место; таблица разбивки по бай-инам) под основной таблицей
- [x] Slice «MBR UI Refinement»: `tournamentMbrKpi` — убран ABI, добавлен `avgPosition` (`AVG(rank)`) + `breakdown` по бай-инам `[{ buyin, count, profit, roi, avgPosition }]`; клиентский блок — 4 метрики (сыграно/профит/ROI/ср. место) + таблица по лимитам
- [x] Проверено: build/lint, сервер+клиент тесты (server **277/23**, client 30/5); live-проверка цифр (count 37 MTT / 20 MBR, MBR buyin $22, profit −$1.25, ROI −5.68%, ср. место) — после Tasks 5–8 + миграции живой БД

## Phase 25: «Цели» Slice 3 — трекинг времени и кастомные цели (2026-09-17)

> ТЗ: индикация времени в GoalCard (дедлайн → «Осталось X дней»/«Дедлайн истек», без дедлайна → «В процессе: X дней»);
> метрика «Своя» (custom goals): миграция v13 — `goals.title`, `target_units` форсируется 1, авто-реконсиляции нет;
> глобальная семантика закрытия: `POST /api/goals/:id/close` принимает `{ outcome: 'failed' | 'achieved' }`
> («Завершить» = failed, у custom дополнительно акцентная «Выполнена» = achieved); бинарное кольцо с иконкой-мишенью вместо 0%.
> Подробности — `tasks/session-log.md` (запись Phase 25).

- [x] Миграция v13: `ALTER TABLE goals ADD COLUMN title TEXT` (`db.ts`); пин 12→13 в `db.test.ts` (2 места) + апгрейд-тест v12→v13 (колонка title, старые строки title NULL)
- [x] Сервер: `goals/types.ts` — `GoalMetric`+'custom', `GoalCloseOutcome`, `Goal.title`; `db.ts` — `GoalRow.title`/`mapGoal`/`insertGoal`; `metrics.ts` — resolver `custom` (label «Своя», current 0, achievedContent «Цель достигнута»); `reconcile.ts` — early-return для custom (binary-прогресс, без авто-фейла по дедлайну); `service.ts` — `validateTitle`/`validateOutcome`, `createGoal` (custom: title обязателен, targetUnits=1), `closeGoal(id, outcome)` (achieved → entry milestone 100, failed → «Цель не достигнута», settleGoal)
- [x] Route `goals.ts`: `:id/close` — Body `{ outcome }`; `:id` POST — проброс `title`
- [x] Сервер-тесты: `goals.test.ts` (close с outcome, manual fail, invalid outcome, custom suite: требует title, targetUnits=1, binary-прогресс, нет авто-реконсиляции, achieved/failed вручную), `goals-route.test.ts` (close outcome, 400 без/невалидного, custom create) → **262 (23 файла)**
- [x] Клиент types/api/useGoals: `custom` + `title` в `Goal`; `GoalInput.title?`; `close(id, outcome)` в api/useGoals
- [x] `metrics.ts`: custom-ветки (`goalPhrase`→title/«Своя цель», target/current label → ''), `pluralDays`, `dayKey`, `daysBetween`, `goalTimeLabel` (deadline/elapsed, overdue-флаг)
- [x] `GoalRing` — `binary`: трек + emerald-дуга при achieved + иконка-мишень вместо проценалки (aria «Бинарная цель»)
- [x] `GoalCard` — строка тайм-индикатора (rose при overdue, « · до ДД.ММ.ГГГГ»), скрыт прогресс-бар у custom, кнопки: авто → «Завершить» (failed), custom → «Выполнена» (achieved) + «Завершить» (failed)
- [x] `GoalCreator` — вкладка «Своя», инпут «Название цели» (обязателен, ≤100), `{ metric:'custom', targetUnits:1, title, deadline }`
- [x] Клиент-тесты: `goals-card.test.tsx` (тайм-индикаторы, 1 кнопка у авто с outcome failed / 2 у custom с обоими исходами, бинарное имя), `goals-metrics.test.ts` (custom-фразы + хелперы дней с явным today) → **30 (5 файлов)**
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **262 (23 файла)** ✓, клиент **30 (5 файлов)** ✓
- [x] AGENTS.md актуализирован (v13, custom goals/title, close outcome); session-log запись

## Slice «Performance Refactoring» (2026-09-18) — Приоритеты 1, 2, 4 аудита

> Источник: диагностический аудит Node.js/SQLite-производительности (5 критериев, замеры на синтетике
> 20 000 турниров / 400 дней). В работу взяты Приоритеты 1 (курсы), 2 (N+1 сессий), 4 (защита транзакций/запросы);
> Приоритет 3 (DB-guard `closeGoal`, `BEGIN IMMEDIATE`) и Приоритет 5 (пагинация, пауза halo) — не взяты.
> UI не трогали; изменения только в серверной логике.

- [x] Task 1: `rates/convert.ts` — `withRateCache(fn)` (request-scoped мемоизация `resolveCrossScaled`, split на `resolveCrossScaled`/`resolveUncached`); обёрнуты тяжёлые функции `statistics.ts` (`tournamentTimeline`, `activityCalendar`, `tournamentAggregate`, `tournamentSummary`, `tournamentMbrKpi`, `sessionStats`) и read-only сканы `tournaments.ts` (`reconcileSummary`, `orphanedDiscrepancies`)
- [x] Task 2: N+1 в `sessionsInRange` устранён — `flowsUsdRange(dateFrom, dateTo, roomIds?)` в `balances.ts` (3 range-запроса: non-transfer, sender-ноги, receiver-ноги + карта `cash_currency`), `buildRoomProfit(entry, prev, flows)`, prev-баланс один раз на рум через `getBalanceBefore(roomId, dateFrom)`, вся функция в `withRateCache`. `roomFlowsUsd` сведён к обёртке над `flowsUsdRange`
- [x] Task 3: `services/tournamentScope.ts` — `MbrScope`, `mttOnly(column)`, `mbrOnly(column)`, `scopeClause(scope, column)`; `mttOnly` применён в `pending.ts`, `goals/db.ts` (`collectGoalsFacts`), `statistics.ts`, `tournaments.ts`; локальные `MbrScope`/`mbrClause` из `statistics.ts` удалены; `tournamentSummary(..., mbr)` сделан обязательным
- [x] Task 4: `tournamentsExistMap` — `SELECT DISTINCT room_id, date ... AND is_mbr = 0`; `db.ts#withTransaction` — doc-контракт «только синхронный колбэк» + runtime-guard на `Promise`-результат (быстрый фейл вместо порчи вложенности)
- [x] Тесты: обновлены вызовы `tournamentSummary` под обязательный scope (`statistics.test.ts`); добавлены async-guard `withTransaction` (`db.test.ts`), мемоизация/сброс `withRateCache` (`rates-convert.test.ts`)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **279 (23 файла)** ✓, клиент **30 (5 файлов)** ✓
- [x] Замер: синтетика 365 дней × 3 рума (1 200 записей, RUB) — старый N+1 `sessionsInRange` **146.7 мс** → новый батч **49.9 мс** (~2.9×, in-memory)

## Слайс «Casino Transactions» (2026-09-18) — тип операции `casino` + миграция v15

> ТЗ: добавить тип `casino` с корректной математикой баланса (знаковые выигрыши/проигрыши), валидацией,
> UI-вводом минуса и цветной индикацией. Casino — гейминг-P&L, а не внешний поток.

- [x] Миграция v15 (`db.ts`): reбилд `transactions` — type-CHECK += `'casino'`, amount-CHECK sign-aware (`casino <> 0`, остальные `> 0`), `CHECK (type<>'casino' OR fee=0)`; `INSERT ... SELECT` сохраняет строки, индекс пересоздан; пины 14→15 + апгрейд-тест v14→v15; фикстуры v10/v12/v13 дополнены `transactions`
- [x] `services/funds.ts` — `TransactionType`/`TRANSACTION_TYPES` += casino; validate: ненулевой integer, `fee=0`, без destination, `direction` из знака; `flowTotals` исключает casino
- [x] `services/balances.ts` — `recomputeRoomBalances` прибавляет casino signed; `flowsUsdRange` исключает casino из внешних потоков
- [x] `services/tournaments.ts` — `casinoWriteoffUsd` → `casinoUsd` (writeoffs + явные casino-транзакции); реконсиляция и `adjustBalanceToTournaments` учитывают casino
- [x] `services/sessions.ts` — casino-день считается игровым (сессия с профитом казино)
- [x] Клиент: `types.ts` (тип/лейбл «Казино» + `casinoUsd`), `money.ts#parseUnits({signed})`, `Transactions.tsx` (дропдауны, ввод минуса, подсказка направления, бейдж, `+/-` со цветом, выигрыш/проигрыш, netChangeUsd), `TournamentPopup.tsx` (метка «Казино»)
- [x] Тесты: server +7 (funds 3, balances 2, tournaments 1, db 1), client +4 (`money.test.ts` — новый файл)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **286 (23 файла)** ✓, клиент **34 (6 файлов)** ✓; живая БД — миграция v15 применена, данные сохранены

## Hotfix-аудит «MBR Financials» (2026-09-18) — деньги MBR в сессиях/сверке

> Правило: MBR вне классических MTT-метрик (count/AFS/ABI/цели), но ВНУТРИ всех денежных
> расчётов — профит сессии, сверка балансов, профит-график. Аудит 4 пунктов «железного правила».

- [x] `services/sessions.ts#sessionsInRange` — gaming-набор без фильтра `is_mbr` (MBR-only день — игровой), профит балансовый → MBR учтён
- [x] `services/tournaments.ts` — `reconcileDay`/`reconcileSummary`/`orphanedDiscrepancies`/`tournamentProfitUsd` видят все строки (без scope)
- [x] `services/statistics.ts#sessionStats` — деньги (`sessions`, `profitSeries`) `'all'`; `mttOnly` только на не-денежных метриках
- [x] Регресс-тесты: `tournaments.test.ts` «keeps MBR money in the day reconcile»; `statistics.test.ts` «MBR-only day as a gaming session»
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **288 (23 файла)** ✓ (+2), клиент **34 (6 файлов)** ✓; прод-код не менялся (поведение уже соответствовало правилу)
- [x] Решено (пользователь, 2026-09-18): pending-семантику оставить как есть — MBR-only день НЕ снимает «ожидание импорта» (Task 5 плана MBR-изоляции в силе)

## Слайс «Logical Day Boundary» (2026-09-18) — сдвиг начала игровых суток

> ТЗ: ночная сессия после полуночи не должна рваться на два календарных дня. Пользователь
> задаёт «начало игровых суток» (0..12), турнир, стартовавший раньше порога, пишется в прошлый день.

- [x] Миграция v16 (`db.ts`): таблица `settings` (key-value) + сев `day_start_hour = '0'`; пин 15→16 (5 мест в `db.test.ts`), список таблиц дополнен, апгрейд-тест v15→v16
- [x] `services/settings.ts` — `getDayStartHour`/`setDayStartHour`/`getSettings`; валидация целое 0..12 (`HttpError 400`), дефолт 0 при отсутствии/порче строки, запись через `withTransaction`
- [x] `lib/date.ts#addDays` — UTC-сдвиг `YYYY-MM-DD` на N дней (без TZ-дрейфа)
- [x] `services/parsers/types.ts` — `TournamentParserContext.dayStartHour?`
- [x] `services/ggimport.ts` — `DATE_RE` захватывает час старта; `parseGgFile`/`parseGgZipArchive`/`ggParser` принимают `dayStartHour`; при `hour < dayStartHour` дата сдвигается на −1 день (порог строгий)
- [x] `routes/tournaments.ts` — перед парсингом читает `getDayStartHour()` и кладёт в контекст
- [x] `routes/settings.ts` — `GET /api/settings` + `PUT /api/settings { dayStartHour }` (регистрация в `app.ts`)
- [x] Клиент: `types.AppSettings`, `api.settings.get/update`, `components/SettingsModal.tsx` (`SettingsModal` + `GearIcon`), шестерёнка в правом углу шапки `App.tsx`, селект 00:00–12:00 с сохранением
- [x] Тесты: server `settings.test.ts` (+6: сервис 3, API 3), `import-gg.test.ts` (+3: 04:00→17-е при 6, вечер/граница 06:00 не сдвигаются, дефолт 0 не сдвигает), `db.test.ts` v16; client `settings-modal.test.tsx` (+2)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **298 (24 файла)** ✓ (+10), клиент **36 (7 файлов)** ✓ (+2); сдвиг только на импорте, исторические даты не переписываются

## Слайс «Fix UI Zero Balance Bug» (2026-09-18) — инпут баланса сбрасывался в 0.00

> Симптом: во вкладке «Балансы» (секция озаглавлена «Румы») после «Записать» инпут баланса мгновенно
> показывал `0.00` (пустое поле с плейсхолдером), F5 возвращал правильную цифру. Крупный баланс и
> банкролл в шапке были корректны — «ноль» был только в инпуте.

- [x] `client/src/pages/Balances.tsx` — `saveRoom`: вместо `setDrafts(prev => ({...prev, [id]: ''}))` (пустая строка — не `null`/`undefined`, поэтому `??` не откатывался на сохранённое значение) теперь `await refresh()` и удаление ключа из `drafts`, затем `emitBalancesChanged()`; инпут снова берёт значение из свежего `latest.amount`
- [x] Регресс-тест `client/tests/balances.test.tsx` (+1): ввод 1234.56 → «Записать» → инпут остаётся `1 234.56` (до фикса падал с `expected '' to be '1 234.56'`)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **309 (24 файла)** ✓, клиент **37 (8 файлов)** ✓

## Слайс «Top Navigation UI Polish» (2026-09-18) — вёрстка шапки

- [x] `App.tsx`: лейбл вкладки «Депозиты и выводы» → «Транзакции» (TabId/роут без изменений)
- [x] `whitespace-nowrap` + `shrink-0` на логотипе, health-индикаторе, банкролле, nav, кнопках; `shrink-0` на правой группе и шестерёнке
- [x] `gap-6` у шапки, `gap-3` у правой группы, `gap-1.5` в nav → навигация дышит, шестерёнка у правого края
- [x] AGENTS.md: актуальные упоминания таба обновлены на «Транзакции»
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **298 (24 файла)** ✓, клиент **36 (7 файлов)** ✓; бэкенд не тронут

## Слайс «Auto-Adjust Balances on Transaction» (2026-09-18) — итерация 2: ручной баланс снова абсолютный

> ТЗ: при добавлении транзакции баланс рума подстраивается автоматически; после сохранения
> обновляются банкролл в шапке и балансы во вкладке «Румы». Ручной пересчёт не нужен.
> Итерация 1 (v17, снимок `base_amount + эффекты tx.id > base_tx_id`) отклонена пользователем:
> пересчёт ручных записей поломал историю сессий и дал жёлтые «Расхождения» за прошлые дни.
> Итерация 2: модель упрощена — ручной баланс абсолютный, подгонка только side-effect-хуком.

- [x] Миграция v18 (`db.ts`): `UPDATE balance_entries SET amount = base_amount WHERE source='manual' AND base_amount IS NOT NULL` — возврат ручных сумм, искажённых v17; колонки `base_amount`/`base_tx_id` оставлены в схеме, но мертвы (код их не читает/не пишет); пин 17→18 (6 мест в `db.test.ts`) + апгрейд-тест v17→v18
- [x] `services/balances.ts`: `recomputeRoomBalances` в manual-ветке берёт `amount`/`currency` КАК ЕСТЬ (carry-forward), не пересчитывает; `upsertBalance` пишет только `(room_id,date,amount,currency,source)`; новый `shiftManualBalanceOnDay(roomId, date, effectUnits, currency)` — сдвигает ТОЛЬКО manual-запись ровно на дату транзакции (иначе no-op, день остаётся на авто-интерполяции), конверсия через `convertCross`; `recomputeAllBalances()` — пересборка `source='auto'` на старте (`index.ts`)
- [x] `services/funds.ts` — `TransactionShape`/`legsOf`/`applyBalanceLegs`: create (+1), update (откат −1 + новая +1), delete (−1); эффект ноги: `casino`→`amount`, `transfer`→`−(amount+fee)` (получатель `+amount`), иначе `in`→`amount`/`out`→`−(amount+fee)`. Двойного счёта нет (правило «только дата транзакции»), инвариант `profit = delta − (in − out)` держится на всей истории
- [x] Клиент (без изменений с итерации 1): `Rooms.tsx` — колонка «Баланс» + `onBalancesChanged`; `Balances.tsx` подписан; `BankrollBadge` (`App.tsx`) слушает; `Transactions.tsx` эмитит событие
- [x] Тесты: `balances.test.ts` — переписан describe «auto-adjust a manual balance on a same-day transaction» (9: депозит, казино+профит сессии, обе ноги перевода, удаление, правка, второй txn того же дня, **регрессия «не двигает ручные на других днях»**, идемпотентный recompute, carry-цепочка); снятая семантика снапшота → 120; `db.test.ts` v18-восстановление; живая БД — `user_version 18`, `amount<>base_amount` у ручных = 0
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **309 (24 файла)** ✓, клиент **36 (7 файлов)** ✓

## Слайс «Import Robustness & MBR Pending Fix» (2026-09-21) — запись восстановлена (не была залогирована)

> Устойчивость импорта турниров: рекурсия во вложенные архивы, лимит JSON-тела, длинный клиентский
> таймаут загрузки/сейва, корректная блокировка сохранения при частичном разборе. Плюс MBR-only
> день снимает pending-маркер (решение пользователя 2026-09-18 было пересмотрено).

- [x] `server/src/services/ggimport.ts` — рекурсивная распаковка вложенных `.zip` (лимит `MAX_ZIP_DEPTH = 4`), `parseGgZipArchive` ходит во вложенные архивы
- [x] `server/src/app.ts` — `bodyLimit: 20 * 1024 * 1024` для JSON (`/bulk` с multi-day imports)
- [x] `client/src/lib/api.ts` — `UPLOAD_TIMEOUT_MS = 60_000` для `/import` и `/bulk` (загрузка архива и сейв турниров не режутся 15с-таймаутом)
- [x] `client/src/components/TournamentPopup.tsx` — `importBlocked` учитывает `failed.length > 0` (частичный разбор блокирует сохранение)
- [x] `server/src/services/pending.ts` — `reconcilePendingImports` снимает pending при любом сыгранном турнире (в т.ч. MBR-only день); distance-цели (`goals/db.ts collectGoalsFacts`) остаются MTT-only
- [x] AGENTS.md актуализирован (ggimport-рекурсия, bodyLimit, 60с-таймаут, pending-семантика)

## Слайс «PokerDom Session Edit Visibility» (2026-09-21) — текущий

> ТЗ: в попапе «Заполнить турниры» ранее импортированные из текста PokerDom-турниры должны
> отображаться как редактируемые строки формы. Диагностика показала, что дословный «пустой модал»
> не воспроизводится; по уточнению у пользователя выбран вариант «текстовые турниры — редактируемые строки».
> Полный отчёт — `tasks/session-log.md` (запись 2026-09-21).

- [x] `server/src/services/tournaments.ts` — `parseRemovedImportIds(ids)` + параметр `removedImportIds: number[] = []` в `saveDayBatch`; освобождённые id удаляются в транзакции ДО upsert-импортов (re-paste того же отчёта «выигрывает» как импорт)
- [x] `server/src/routes/tournaments.ts` — `/api/tournaments/bulk` принимает `removedImportIds?: number[]` (не-массив → 400)
- [x] `client/src/lib/api.ts` — `save(..., removedImportIds)` шлёт список освобождённых id
- [x] `client/src/components/TournamentPopup.tsx` — для шаблона `pokerdom` все сохранённые турниры дня (manual + hashed-text) грузятся в редактируемые строки; id трекаются в `removedImportIds` и отправляются при сохранении; повторная вставка текста/архива дедупится; GG-ветка без изменений (read-only)
- [x] Тесты: сервер `tournaments.test.ts` +4, `import-gg.test.ts` +2 (injection `/bulk`); клиент новый `tournament-popup.test.tsx` (4)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **320 (24 файла)** ✓, клиент **41 (9 файлов)** ✓
- [x] AGENTS.md актуализирован (PokerDom-редактор, `removedImportIds`, client/tests 9 файлов)

## Слайс «Цели 2.0 — Чеклисты» (2026-09-21) — миграция v19

> Т/З: в цели можно добавить чеклист задач, который тянет цель к завершению. Для метричных целей
> (bankroll/distance) работает AND-гейт: достижение только когда метрика 100% И все пункты отмечены;
> прогресс-бар остаётся по главной метрике; milestone 100 не эмитится, пока чеклист не закрыт.
> Для custom с чеклистом — прогресс по чеклисту, achievement content «Все пункты выполнены».
> Привычки (Фаза C) — НЕ трогать (решено отложить). Полный отчёт — `tasks/session-log.md`.

- [x] Миграция v19 (`db.ts`): `ALTER TABLE goals ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'` (JSON-колонка, не таблица); пин 18→19 (7 мест в `db.test.ts`) + тест v12 (`checklist` в схеме) + апгрейд-тест v18→v19 + фикстуры v14–v18 дополнены таблицей `goals` (v19 ALTERs goals, тесты перескакивают v12)
- [x] `services/goals/types.ts` — `ChecklistItem { id, text, done }`, `Goal.checklist`; `db.ts` — `GoalRow.checklist`, `parseChecklist` (fallback `[]`), `updateChecklist`
- [x] `services/goals/service.ts` — `validateChecklist` (0–50, id 1–36 уникальные, text 1–200 trim, done boolean; иначе 400), `setChecklist` (settled → 400, `withTransaction` + `reconcileGoal`)
- [x] `services/goals/reconcile.ts` — AND-гейт: `reached = isCustom ? checklistDone : hasChecklist ? metricReached && checklistDone : metricReached`; custom без чеклиста — бинарный early-return; фейл по дедлайну только когда трекается; milestone 100 не эмитится при незакрытом чеклисте
- [x] `routes/goals.ts` — `PUT /api/goals/:id/checklist` body `{ items }` → `{ goal }` (полный replace)
- [x] Клиент: новый `components/GoalChecklist.tsx` (добавить/отметить/удалить, `crypto.randomUUID()`); `goals.types.ts`/`goals.api.ts` (`setChecklist`), `useGoals.ts` (мутация + локальный патч), `metrics.ts` (`checklistProgressLabel`), `GoalCard.tsx` (секция «Чеклист», `binary={isCustom && !hasChecklist}`, custom-лейбл прогресса, «Выполнена» только custom без чеклиста), `GoalsPage.tsx` wiring
- [x] Тесты: сервер `goals.test.ts` +9 (валидация/trim/отказ settled/custom-прогресс/auto-achieved/дедлайн-fail/AND-гейт distance 10/10 без milestone 100/метрика+незакрытый чеклист/blank без фейла), `goals-route.test.ts` +4 (PUT); клиент `goals-card.test.tsx` +5 (Harness контролируемый, aria-label «Добавить пункт»), `goals-metrics.test.ts` +1 (падежи 1/2/4/21/22)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **334 (24 файла)** ✓ (+10), клиент **47 (9 файлов)** ✓ (+6)
- [x] AGENTS.md актуализирован (migration v19, `checklist` в goals, серверные тесты 24 файла)

## Слайс «Трекер привычек. Фаза C+D» (2026-09-21) — миграция v20

> Т/З: вкладка «Привычки» — месячный трекер: таблица привычек × дней месяца, статус дня
> (сделано/пропущено/пусто) кликом по ячейке, навигация по месяцам (без будущих), удаление
> привычки — soft-delete (архив). Полный отчёт — `tasks/session-log.md`.

- [x] Миграция v20 (`db.ts`): `habits` (name NOT NULL, created_at, archived_at), `habit_logs` (FK на habits БЕЗ ON DELETE — история не теряется, UNIQUE(habit_id,date), индекс по date); пин 19→20 + тесты схемы/апгрейда в `db.test.ts`
- [x] `lib/date.ts` — `isValidMonthKey`, `currentMonthKey`, `monthStart`, `monthEnd` (концовка через `new Date(y, m, 0).getDate()`)
- [x] `services/habits/{types,db,service}.ts` — `HabitWithLogs.logs: Record<date,status>`; видимость привычки на месяце M ⇔ `archived_at IS NULL OR archived_at > monthEnd(M)` (прошлые месяцы показывают архивные с логами; текущий — скрывает; `created_at`-фильтр отклонён после падения тестов); `requireHabit` 404; `upsertLog`/`deleteLog`; `archiveHabit` идемпотентен; FK без каскадов — одной транзакцией нельзя потерять историю
- [x] `routes/habits.ts` + регистрация в `app.ts`: `GET /api/habits?month=YYYY-MM` (валидация regex, дефолт текущий месяц), `POST /api/habits {name}` (trim 1..100), `PUT /api/habits/:id/log {date,status:'done'|'missed'|null}` (null = пусто/удалить лог), `DELETE /api/habits/:id` (soft-archive). Endpoint переименования НЕ делаем (нет в Т/З)
- [x] Серверные тесты: новые `habits.test.ts` + `habits-route.test.ts` (валидации, set/clear лога, архив-видимость текущий/прошлые месяцы, логи только запрошенного месяца)
- [x] Клиент `client/src/habits/`: `habits.types.ts`, `habits.api.ts` (через `request` из `lib/api`), `metrics.ts` (`monthDays`/`dayLabel`/`monthLabel`/`addMonths`/`currentMonthKey`), `useHabits.ts`
- [x] Компоненты: `MonthNavigator` (◀ месяц ▶, next disabled при `next > current`), `HabitPopover` (fixed-позиционирование по `getBoundingClientRect`, 3 опции done/missed/empty, текущий статус подсвечен, Esc/клик вне закрывает), `HabitTracker` (overflow-x-auto, sticky-колонка имени z-10, weekend-подсветка, «✕» только на текущем месяце + двухшаговый confirm «Точно?»)
- [x] `HabitsPage.tsx` — форма «Новая привычка» (aria-label «Название новой привычки», кнопка «Добавить»), empty-state, empty-day «·»; вкладка `habits` в `App.tsx` между «Цели» и «Статистика» (TabId + TABS + lazy: `dist/assets/HabitsPage-*.js` 9.88 kB)
- [x] Клиентский тест новый `habits.test.tsx` (5): пусто→создание с trim (инпут очищается), done через popover (aria-label ячейки `${name}, ${day} ${weekday}`, PUT с `{date,status}`), missed→empty (status null, «·»), двухшаговый архив (DELETE), навигатор (prev меняет label + GET `?month=`, next disabled на текущем); без jest-dom — `textContent`
- [x] Проверено: `npm run build` ✓ (client tsc+vite + server tsc), `npm run lint` ✓, сервер **350 (26 файлов)** ✓ (+16), клиент **52 (10 файлов)** ✓ (+5)
- [x] AGENTS.md актуализирован (v20, `server/src/services/habits/` + `routes/habits.ts` + 2 тест-файла, `client/src/habits/**` + календарь)

## Слайс «Habit Tracker UI Polish & Header Fix» (2026-09-21)

> Т/З: (1) `HabitTracker` выходит за границы `max-w-5xl` почти на всю ширину экрана — месяц
> помещается без/с минимальным скроллом, левая sticky-колонка имён выровнена с контентом;
> (2) починить наложение в шапке («Банкролл» налез на сумму после добавления вкладки).
> Полный отчёт — `tasks/session-log.md`.

- [x] Breakout-обёртка в `HabitsPage.tsx`: `<div style={{ marginRight: 'calc(24px - (100vw - 100%) / 2)' }}>` вокруг `HabitTracker` — правая граница таблицы растягивается до `100vw−24px`, левая колонка имён остаётся на линии контента (marginLeft = 0); при узких экранах (main = viewport) формула даёт 0 и таблица держит обычную ширину
- [x] `HabitTracker.tsx` — пусто-состояние перенесено в `HabitsPage.tsx` (полотно не растягивает карточку «Привычек пока нет»); день-колонки `min-w-9` → `min-w-8` (32px) — полный месяц уже на ~1168px
- [x] `index.css` — `html { overflow-x: clip }`: отрицательный `vw`-margin не создаёт горизонтальный скролл страницы из-за скроллип-полосы Windows (управление скроллом остаётся у `overflow-x-auto` самой таблицы)
- [x] Шапка (`App.tsx`): контейнер `flex-wrap ... gap-x-4 gap-y-2`; левая группа `shrink-0` (убрано `min-w-0` — раньше она сжималась и контент перекрывал nav); правая группа и `<nav>` — `flex-wrap` (вкладки переносятся, «Транзакции»/«Статистика» не режутся); кнопки вкладок `px-3` → `px-2.5`, `shrink-0`; `BankrollBadge` — `ml-6` → `ml-2`, внутренние спаны `shrink-0` (запрет wrap для банкролла)
- [x] Проверено: `npm run build` ✓ (client + server tsc), `npm run lint` ✓, сервер **350 (26 файлов)** ✓, клиент **52 (10 файлов)** ✓
- [x] AGENTS.md актуализирован (flex-wrap шапки, breakout-обёртка + `overflow-x: clip`)

## Слайс «Fix Broken Layouts» (2026-09-21, откат кривого breakout)

> Т/З: на широких мониторах верстка сломана — (1) асимметричный трекер (растянут только правый
> край до `100vw`, левый прибит к `max-w-5xl`), (2) шапка в две строки (вкладки переносятся,
> хотя по бокам пусто). Полный отчёт — `tasks/session-log.md`.

- [x] **Единый контейнер `max-w-7xl`** вместо `max-w-5xl`: `App.tsx` (шапка, главная колонка, баннер уведомлений) + корни страниц `Transactions.tsx` / `Statistics.tsx` / `Sessions.tsx` (имели собственный `max-w-5xl` — двойное вложение)
- [x] **Удалён однобокий breakout** из `HabitsPage.tsx` (`marginRight: calc(24px - (100vw - 100%)/2)`) — таблица снова рендерится напрямую в контенте; `index.css` → удалён `html { overflow-x: clip }` (привносился только ради `vw`-breakout)
- [x] **Шапка в одну строку**: контейнер шапки `max-w-7xl` (~1232px контента против ~1180px суммарной ширины логотип+health+банкролл+8 вкладок+шестерёнка) → перенос невозможен на десктопе/ultrawide; `flex-wrap` оставлен только как fallback для узких экранов; кнопки вкладок `px-3` → `px-2` (запас)
- [x] Трекер центрирован и симметричен: 31 день × `min-w-8` (992px) + sticky-имя (176px) ≈ 1168px < 1232px контента `max-w-7xl` — месяц помещается без скролла, колонки не разъезжаются
- [x] Проверено: `npm run build` ✓ (client + server tsc), `npm run lint` ✓, сервер **350 (26 файлов)** ✓, клиент **52 (10 файлов)** ✓
- [x] AGENTS.md актуализирован (единый `max-w-7xl`, breakout удалён)

## Слайс «Goals History & Confirmation» (2026-09-21) — миграция v21

> Т/З: (1) подтверждение перед закрытием/удалением цели; (2) крестик не удаляет цель, а переводит
> её в неактивный статус `closed` (история сохраняется); (3) вкладка «История» в «Целях» с read-only
> рендером завершённых целей и замороженным снимком прогресса на момент завершения.
> Полный отчёт — `tasks/session-log.md`.

- [x] Миграция v21 (`db.ts`): пересборка `goals` + `goal_entries` — CHECK статуса `('active','achieved','failed','closed')`, новые колонки `closed_at`/`final_percent`/`final_units`; порядок (rename → create → copy → пересбор `goal_entries` → drop) сохраняет `goal_entries` без каскадов; пин 20→21 + апгрейд-тест v20→v21
- [x] `services/goals/types.ts` — `GoalStatus` += `'closed'`, `GoalTerminalStatus`, `GoalCloseOutcome` += `'closed'`, `Goal` += `closedAt`/`finalPercent`/`finalUnits`, `GoalSnapshot`
- [x] `services/goals/db.ts` — `GoalRow`/`mapGoal` += новые колонки; `settleGoal(id, status, snapshot)` пишет статус + дату (по колонке статуса) + снимок; `deleteGoalRow` удалён (hard-delete устранён)
- [x] `services/goals/reconcile.ts` — экспортирован `computeProgress`; `withSnapshot` отдаёт `finalPercent`/`finalUnits` для терминальных; терминальные цели — ранний возврат (без milestones/auto-settle); auto-achieve/fail пишут снимок
- [x] `services/goals/service.ts` — `closeGoal` принимает `'closed'` (запись «Цель закрыта» + снимок); `validateOutcome` += `'closed'`; `deleteGoal` удалён; `routes/goals.ts` — `DELETE /api/goals/:id` удалён
- [x] Клиент: `goals.types.ts`/`goals.api.ts`/`useGoals.ts` (closed, снимок, `remove`/`deleteGoal` удалены), `metrics.ts` (`STATUS_LABELS.closed` = «Закрыта» + helper `historyDate`)
- [x] Новый `components/ConfirmDialog.tsx` (портал в `document.body`, Esc/клик-вне, `role="dialog" aria-modal`, tone `danger`/`default`)
- [x] `GoalCard.tsx` — prop `readOnly`, confirm для крестика («В историю» → `closed`), «Выполнена» (`achieved`) и «Завершить» (`failed`); терминальные скрывают крестик/композер/кнопки и показывают `STATUS_LABELS[status] · дата`; `GoalChecklist.tsx` — `readOnly`
- [x] `GoalsPage.tsx` — табы «Активные»/«История» со счётчиками; история = `status !== 'active'`, сортировка по `historyDate` desc, `readOnly`, пустые состояния
- [x] Тесты: сервер `db.test.ts` (пин 21 + v21-тест + `goal_entries` в апгрейд-фикстурах), `goals.test.ts` (close вместо delete + заморозка снимка), `goals-route.test.ts` (POST `/:id/close` + 404 на DELETE); клиент `goals-card.test.tsx` (confirm/cancel/read-only), `goals-metrics.test.ts` (`closed`), новый `goals-history.test.tsx`
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **352 (26 файлов)** ✓ (+2), клиент **57 (11 файлов)** ✓ (+5)
- [x] AGENTS.md актуализирован (v21, `closed`/снимок, `outcome: 'failed' | 'achieved' | 'closed'`, DELETE убран, `ConfirmDialog`/табы/`historyDate`)

### Следующее
- [ ] Пользовательская проверка глазами: вкладка «Цели» — подтверждение закрытия, «История» (read-only, снимок прогресса)
- [ ] Пользовательская проверка глазами: вкладка «Привычки» — создать/проставить статусы/архив/навигация по месяцам
- [ ] Пользовательская проверка глазами: попап турниров PokerDom-рума — hashed-строки в форме, правка/сохранение конвертирует в ручные строки без дублей
- [ ] Бэклог: виртуализация списков турниров (Этап 4 спринта «Аудит+рефакторинг») — отложена до роста объёмов

## Слайс «Goal Outcomes & Persistent Notifications» (2026-09-21) — миграция v22

> Т/З: (1) убрать статус `closed` — у цели только два исхода: `achieved`/`failed`; (2) крестик
> открывает диалог выбора исхода; (3) завершённые цели показываются несгораемым тостом, пока
> пользователь не подтвердит (`acknowledged_at`); только после подтверждения цель уходит в «Историю».
> Полный отчёт — `tasks/session-log.md`.

- [x] Миграция v22 (`db.ts`): `ALTER TABLE goals ADD COLUMN acknowledged_at TEXT` + бэкфилл `UPDATE goals SET acknowledged_at = datetime('now') WHERE status != 'active'`; пин 21→22 + апгрейд-тест v21→v22
- [x] `services/goals/types.ts` — `GoalStatus` без `closed` (`active|achieved|failed`), `GoalCloseOutcome = 'achieved'|'failed'`, `Goal` += `acknowledgedAt`
- [x] `services/goals/db.ts` — `GoalRow.status: string` + `acknowledged_at`; `normalizeStatus` (легаси `closed`→`failed`) в `mapGoal`; `settleGoal(id, status, snapshot, acknowledged=false)` пишет `acknowledged_at`; новый `acknowledgeGoalRow(id)` (404 при 0 changes)
- [x] `services/goals/service.ts` — `validateOutcome` только `achieved`/`failed`; `closeGoal` без ветки `closed` и с авто-`acknowledge` (ручное закрытие сразу в историю); новый `acknowledgeGoal(id)` (400 на активную)
- [x] `routes/goals.ts` — `POST /api/goals/:id/acknowledge`
- [x] Клиент: `goals.types.ts` (без `closed`, += `acknowledgedAt`), `goals.api.ts` (`acknowledge`), `useGoals.ts` (`acknowledge` + подписка/эмит `goals-changed`), `metrics.ts` (без `closed`, `historyDate` с fallback `failedAt ?? closedAt`, `goalOutcomeTitle`), `lib/events.ts` (`goals-changed`)
- [x] Новый `components/GoalOutcomeDialog.tsx` («Итог цели»: Выполнена/Провалена/Отмена)
- [x] `GoalCard.tsx` — крестик открывает `GoalOutcomeDialog`; убраны ветки `closed` в чипе/полосе прогресса
- [x] `GoalsPage.tsx` — роутинг по `acknowledgedAt` (активные = `active` или неподтверждённые), `readOnly = status !== 'active'`
- [x] Новый `components/GoalToasts.tsx` (несгораемые тосты, поллинг 30с + `goals-changed`) + ленивое монтирование в `App.tsx`
- [x] Тесты: сервер `db.test.ts` (пин 22 + v22-тест бэкфилла), `goals.test.ts` (manual-close + acknowledge), `goals-route.test.ts` (acknowledge + `closed` → 400); клиент `goals-card.test.tsx`, `goals-history.test.tsx`, `goals-metrics.test.ts`, новый `goal-toasts.test.tsx`
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **357 (26 файлов)** ✓ (+5), клиент **62 (12 файлов)** ✓ (+5)
- [x] AGENTS.md актуализирован (v22, два исхода, `acknowledged_at`, тосты)

### Следующее
- [ ] Пользовательская проверка глазами: вкладка «Цели» — диалог исхода по крестику, несгораемый тост до подтверждения, переход в «Историю» после
- [ ] Пользовательская проверка глазами: вкладка «Привычки» — создать/проставить статусы/архив/навигация по месяцам
- [ ] Пользовательская проверка глазами: попап турниров PokerDom-рума — hashed-строки в форме, правка/сохранение конвертирует в ручные строки без дублей
- [ ] Бэклог: виртуализация списков турниров (Этап 4 спринта «Аудит+рефакторинг») — отложена до роста объёмов

## Слайс «Bulletproofing & Code Hardening» (2026-09-21)

> Т/З: аудит устойчивости 24/7 фонового демона по 6 векторам — SQLite durability, graceful
> shutdown (БД + headless Chromium без зомби), защитная валидация JSON/дат/ID, сбой сети при
> старте ПК, гонки/циклы во фронтенд-хуках, edge-case тесты. Полный отчёт — `tasks/session-log.md`.

- [x] **П.1 (уже закрыт, проверено)** — `db.ts` уже держит `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`; правок не требуется
- [x] **П.2** — `db.ts#closeDb()` (WAL-checkpoint `TRUNCATE` + `db.close()`, идемпотентно, сброс `transactionDepth`); `index.ts#shutdown` закрывает БД в `finally`, обёрнут в try/catch + watchdog `setTimeout(5с) → process.exit`, добавлен `SIGBREAK`
- [x] **П.3** — `lib/http.ts#parseId` требует строгий `^\d+$` для строк (раньше `Number()` пропускал `'1e3'`, `'0x10'`, `'1.0'`, `' 1'`, `'+1'`); `parseChecklist`/`isValidDayKey`/`isValidMonthKey`/валидаторы habits уже были защитными — проверено
- [x] **П.4 (уже закрыт, проверено)** — `rates/refresh.ts` изолирует каждый источник (`runWithNotification` + try/catch), `index.ts` глушит `.catch`; сбой сети при старте ПК не роняет приложение, только персистентное уведомление
- [x] **П.5** — `GoalToasts.tsx#load` глотает ошибку (устранён unhandled rejection из подписки `goals-changed`, который уходил в `unhandledRejection` → `shutdown(1)`); `useHabits.ts#load` получил guard последовательности + mounted (гонка при быстрой навигации по месяцам перезаписывала свежий месяц старым ответом)
- [x] **П.6** — новый `server/tests/http.test.ts` (`parseId` валидные/мусорные); `db.test.ts` — `closeDb` (checkpoint/close/идемпотентность/данные после переоткрытия); `client/tests/goal-toasts.test.tsx` — падающий фоновый запрос не даёт unhandled rejection (хук `unhandledRejection` без `@types/node`)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **360 (27 файлов)** ✓ (+3), клиент **63 (12 файлов)** ✓ (+1)
- [x] WAL после закрытия: тест `closeDb` ассертит, что `-wal` непустой до закрытия и усечён до 0 байт после — «хвост WAL» закрыт на уровне теста
- [x] AGENTS.md актуализирован (WAL/busy_timeout, `closeDb` + watchdog + SIGBREAK, строгий `parseId`, 27 серверных тест-файлов, guard'ы `GoalToasts`/`useHabits`)

### Следующее
- [ ] Пользовательская проверка глазами (накопилось): «Цели» (исход/тост/история), «Привычки» (статусы/архив/навигация), попап турниров PokerDom-рума
- [ ] Проверить живьём: остановка сервера (`start.ps1` → «Остановить») не оставляет зомби-Chromium
- [ ] Бэклог: виртуализация списков турниров (Этап 4 спринта «Аудит+рефакторинг») — отложена до роста объёмов

## Слайс «Привычки 2.0 — цвет, редактор, история, редизайн» (2026-09-21) — миграция v23

> Т/З: современный минималистичный редизайн всей вкладки «Привычки» («фундаментальнее, но
> невесомее»), плюс функции: переименование привычки (карандаш рядом с «✕»), эмодзи в названии,
> цвет привычки при создании (красит имя), «История» архивных привычек с возвратом из архива.
> Скиллы: `frontend-design` + `emil-design-eng`. Полный отчёт — `tasks/session-log.md`.

- [x] **Сервер** — `lib/color.ts` (`DEFAULT_COLOR` + `validateColor`, общий с румами); миграция **v23** (`habits.color`, дефолт `#f1f5f9`); `habits/{types,db,service}`: `color`, `updateHabit(id,{name?,color?})`, `restoreHabit`, `listHabitHistory` + `HabitStats`, `charCount` по код-поинтам
- [x] **Роуты** — `GET /api/habits/history`, `PUT /api/habits/:id`, `POST /api/habits/:id/restore`, `POST /api/habits {name,color}`
- [x] **Серверные тесты** — `db.test.ts` (пины 22→23, новый тест v23, habits-таблица в setup тестов v21/v22), `habits.test.ts` (цвет/код-поинты/rename/history/restore), `habits-route.test.ts` (новые роуты + 400/404)
- [x] **Клиент** — `habits.types.ts`/`habits.api.ts`/`metrics.ts`/`useHabits.ts` под color+history+update+restore; новые `components/icons.tsx`, `ColorPicker.tsx`, `HabitEditor.tsx`, `HabitHistory.tsx`
- [x] **Редизайн** — `HabitTracker` (стеклянная карта `rounded-2xl` + многослойная тень, зарезервированная панель действий без layout-shift, имя красится `h.color`, подсветка колонки «сегодня», hairline-разделители); `HabitsPage` (табы «Трекер»/«История», стеклянный композер `input + ColorPicker + Добавить`)
- [x] **Клиентские тесты** — `habits.test.tsx` (+4: цвет при создании, лимит по код-поинтам, rename через редактор, история+возврат)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **368 (27 файлов)** ✓ (+8), клиент **67 (12 файлов)** ✓ (+4)
- [x] AGENTS.md актуализирован (v23, `lib/color.ts`, habits color/update/restore/history, палитра общая с румами)
- [x] **Баг-фикс (фидбек)** — архивная привычка больше не видна **ни на одном** месяце (`listActiveHabitRows`, `archived_at IS NULL`) — раньше прошлые месяцы показывали архивные, из-за чего после пересоздания одноимённой привычки был дубль; попап выбора цвета поднят над календарём (`relative z-20` на композере — `backdrop-blur` создавал stacking context ниже карточки сетки)
- [x] Баг-фикс проверен: `npm run build` ✓, `npm run lint` ✓, сервер **369 (27 файлов)** ✓, клиент **67 (12 файлов)** ✓ (+тест «no duplicate on past months» и проверка открытия/закрытия попапа)

### Следующее
- [ ] Пользовательская проверка глазами: вкладка «Привычки» — табы, цвет при создании (попап над календарём), карандаш (rename+recolor с предпросмотром), архив→история→возврат, лимит имени с эмодзи, отсутствие архивных в прошлых месяцах
- [ ] Пользовательская проверка глазами (накопилось): «Цели» (исход/тост/история), попап турниров PokerDom-рума
- [ ] Проверить живьём: остановка сервера (`start.ps1` → «Остановить») не оставляет зомби-Chromium
- [ ] Бэклог: виртуализация списков турниров (Этап 4 спринта «Аудит+рефакторинг») — отложена до роста объёмов

## Слайс «Привычки — смена уже выставленного статуса» (2026-09-21)

> Т/З (фидбек): «нельзя поменять уже выставленный день — нажимаешь на галочку/крестик, и ничего».
> Полный отчёт — `tasks/session-log.md`.

- [x] **Первопричина** — попап выбора статуса рендерился `position: fixed` **внутри** карточки трекера, у которой `backdrop-blur-xl` (создаёт containing block для fixed-потомков) + `overflow-hidden` (обрезает) → попап вставал относительно карточки и уезжал за границы, клики не доходили
- [x] `HabitPopover.tsx` — `createPortal(..., document.body)`; пропсы `x`/`cellTop`/`cellBottom` вместо `y`; `useLayoutEffect` измеряет `getBoundingClientRect()` и клампит в вьюпорт с флипом вверх (`GAP=6`, `EDGE=8`); `visibility: hidden` до замера (без мигания); `aria-pressed` на опциях
- [x] `HabitTracker.tsx` — `Anchor` = `{ habitId, date, x, cellTop, cellBottom }`, `onClick` заполняет `rect.left/top/bottom`; типографика имени `text-sm` → `text-[15px] font-medium`
- [x] Тест `client/tests/habits.test.tsx` — «changes a status that was already set and keeps flipping it» (done → «Пропущено» → ✕ → «Сделано» → ✓, проверка тела PUT) + guard на портал (`screen.getByRole('dialog').parentElement === document.body`) — 10 тестов
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, клиент **74 (13 файлов)** ✓

## Слайс «Цели — ручной порядок (drag & drop)» (2026-09-21) — миграция v24

> Т/З: «хочу перетаскивать цели, чтобы они не сбрасывались после перезагрузки». Решено: тянется вся
> карточка, кроме полей/кнопок; «История» — без drag (сортировка по дате завершения). Скиллы:
> `emil-design-eng` + `frontend-ui-engineering`. Полный отчёт — `tasks/session-log.md`.

- [x] **Миграция v24** (`db.ts`) — `ALTER TABLE goals ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0` + бэкфилл под прежний порядок (`created_at DESC, id DESC`) + `CREATE INDEX idx_goals_sort ON goals(sort_order, id)`; пин 23→24 + апгрейд-тест v23→v24 (в v23-фикстуру добавлена таблица `goals`, иначе `no such table`)
- [x] **Сервер** — `services/goals/types.ts` (`Goal.sortOrder`); `db.ts` (`GoalRow.sort_order`, `mapGoal`, `listGoalRows` → `ORDER BY sort_order, id`, `insertGoal` пишет `MIN(sort_order)-1` = новая цель сверху, `setGoalSortOrder`); `service.ts` (`validateOrderIds` + `reorderGoals(ids)` = `[...ids, ...rest]` → `0..N-1` в `withTransaction`); роут `PUT /api/goals/order { ids }`
- [x] **Клиент** — `goals.types.ts` (+`sortOrder`), `goals.api.ts` (`reorder`), новый `order.ts` (`applyGoalOrder` — пермутация среди слотов занятых id, неизвестный/дубль → список как есть; `moveGoalId` для клавиатуры), `useGoals.ts` (`applyOrder` — локальное превью; `reorder` — оптимистично + PUT + откат через `reload()`)
- [x] **UI** — `GoalsPage.tsx`: активная вкладка — `Reorder.Group` (`as="ul"`, `values` = активные id, `onReorder` → превью, `commitOrder` на `onDragEnd` → `reorder`, `moveGoal` для Alt+↑/↓); `GoalCard.tsx`: при `sortable` корень — `Reorder.Item` с `dragListener={false}` + `useDragControls` (drag стартует с `onPointerDown` карточки), `data-no-drag` на верхнем правом кластере и раскрытых деталях, `draggedRef` гасит клик-после-drag на заголовке, `whileDrag` scale, `cursor-grab`, слабый грип-индикатор
- [x] Тесты: сервер `goals.test.ts` +6 (персист/префикс/новая-сверху/отбой payload/идемпотентность+сохранность прогресса/пустой список), `goals-route.test.ts` +2 (`PUT /api/goals/order`, 400 на мусор); клиент новый `goals-order.test.tsx` (`applyGoalOrder`, `moveGoalId`, reorder по Alt+стрелка с проверкой тела запроса, край списка)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **378 (27 файлов)** ✓ (+9), клиент **74 (13 файлов)** ✓ (+6 → новый файл)
- [x] AGENTS.md актуализирован (v24, `sort_order`/`reorderGoals`/`PUT /api/goals/order`, `order.ts`, `Reorder.Group`/`Reorder.Item`)

### Следующее
- [ ] Пользовательская проверка глазами: «Цели» — перетаскивание карточек (вся карточка, кроме полей/кнопок), порядок переживает F5 и рестарт сервера, Alt+↑/↓, «История» без drag
- [ ] Пользовательская проверка глазами: вкладка «Привычки» — смена уже выставленного статуса дня (попап теперь порталом), табы, цвет/карандаш/архив/возврат
- [ ] Пользовательская проверка глазами (накопилось): «Цели» (исход/тост/история), попап турниров PokerDom-рума
- [ ] Проверить живьём: остановка сервера (`start.ps1` → «Остановить») не оставляет зомби-Chromium
- [ ] Бэклог: виртуализация списков турниров (Этап 4 спринта «Аудит+рефакторинг») — отложена до роста объёмов

## Слайс «Привычки — ручной порядок строк (drag & drop)» (2026-09-21) — миграция v25

> Т/З: «взять привычку, поднять её выше/ниже, чтобы порядок не сбивался после перезагрузки».
> Парно к слайсу «Цели — ручной порядок»; общий хелпер вынесен в `client/src/lib/reorder.ts`.
> Скиллы: `emil-design-eng` + `frontend-ui-engineering`. Полный отчёт — `tasks/session-log.md`.

- [x] **Миграция v25** (`db.ts`) — `ALTER TABLE habits ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0` + бэкфилл под прежний алфавитный вид (`name COLLATE NOCASE, id`) + `CREATE INDEX idx_habits_sort ON habits(sort_order, id)`; пины 24→25 (13 мест) + апгрейд-тест v24→v25 (в v24-фикстуру добавлена таблица `habits`, иначе `no such table`); проверено на копии реальной БД — порядок совпал с алфавитным, `habit_logs` целы
- [x] **Сервер** — `services/habits/types.ts` (`Habit.sortOrder`); `db.ts` (`HabitRow.sort_order`, `mapHabit`, `listActiveHabitRows` → `ORDER BY sort_order, id`, `insertHabit` пишет `MIN(sort_order)-1` = новая сверху, `setHabitSortOrder`); `service.ts` (`reorderHabits(ids)` = `[...ids, ...rest]` → `0..N-1` в `withTransaction`; известны только активные привычки — архивный id даёт 400); роут `PUT /api/habits/order { ids }` (перед `PUT /api/habits/:id`)
- [x] **Общий клиентский хелпер** — новый `client/src/lib/reorder.ts` (`applyItemOrder<T extends {id:number}>`/`moveItemId`); `client/src/goals/order.ts` стал тонкой обёрткой над ним (тест `goals-order.test.tsx` не менялся)
- [x] **Клиент** — `habits.types.ts` (+`sortOrder`), `habits.api.ts` (`reorder`), `useHabits.ts` (`applyOrder` — локальное превью; `reorder` — оптимистично + PUT, при ошибке `load(month)`; ответ сервера в стейт не применяется)
- [x] **UI** — `HabitTracker.tsx`: `Reorder.Group as="tbody"` + приватный `HabitRow` = `Reorder.Item as="tr"` (`dragListener={false}` + `useDragControls`, drag с `onPointerDown` строки, исключения `button/a/input/select/textarea/[data-no-drag]`, грип-кнопка с `data-drag-handle`, строка `group relative` + `bg-slate-700` в имя-ячейке при drag, `draggedRef` гасит клик-после-drag, Alt+↑/↓ на грипе → `moveItemId`); `icons.tsx` (+`GripIcon`); `HabitsPage.tsx` — `draggedOrder` (ref обязан быть до early-return), `handleReorder`/`commitOrder`/`moveHabit`
- [x] Тесты: сервер `habits.test.ts` +3, `habits-route.test.ts` +1, `db.test.ts` — пины + тест v25; клиент `habits.test.tsx` +1 (Alt+↑ на грипе → `{ids:[2,1]}` и новый порядок строк; без Alt и на краю списка запроса нет)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **383 (27 файлов)** ✓, клиент **75 (13 файлов)** ✓
- [x] AGENTS.md актуализирован (v25, `sort_order`/`reorderHabits`/`PUT /api/habits/order`, `lib/reorder.ts`, `Reorder.Group as="tbody"`)

### Следующее
- [ ] Пользовательская проверка глазами: «Привычки» — перетаскивание строк (вся строка, кроме кнопок/полей), порядок переживает F5 и рестарт сервера, Alt+↑/↓, «История» без drag, новая привычка встаёт сверху
- [ ] Пользовательская проверка глазами: «Цели» — перетаскивание карточек (вся карточка, кроме полей/кнопок), порядок переживает F5 и рестарт сервера, Alt+↑/↓, «История» без drag
- [ ] Пользовательская проверка глазами (накопилось): «Цели» (исход/тост/история), «Привычки» (смена статуса/цвет/архив/возврат), попап турниров PokerDom-рума
- [ ] Проверить живьём: остановка сервера (`start.ps1` → «Остановить») не оставляет зомби-Chromium
- [ ] Бэклог: виртуализация списков турниров (Этап 4 спринта «Аудит+рефакторинг») — отложена до роста объёмов
- [ ] Открытый вопрос: нужна ли кнопка «Удалить навсегда» в «Истории» привычек (чтобы удаление архивной привычки делалось из UI, а не правкой БД)

## Слайс «Курс: авто-ретрай + grace-период уведомлений» (2026-09-23)

> Симптом: после включения ПК (автозапуск) сверху сайта мелькнуло «PokerDom курс не обновился».
> Диагностика: автозапуск и стартовый refresh сработали штатно (курсы за 2026-09-23 обновлены
> в 09:47:30); уведомление — остаток вчерашнего (22.09 21:09) сбоя `USD rate not found on page`,
> снятый успехом стартового обновления через ~9 сек. Пробел: частичный сбой не ретраился —
> следующая попытка только через 4 часа, поэтому «хвост» висел до следующего открытия ПК.
> Каденция «раз в 4 часа» уже была (`setInterval` + `STALE_AFTER_MS = 4h`) — требование выполнено.
> Скилл: `debugging-and-error-recovery`. Полный отчёт — `tasks/session-log.md`.

- [x] `server/src/services/rates/refresh.ts` — **авто-ретрай**: `autoRefresh()` = `refreshAllRates()` + при частичном сбое `scheduleRetry()` (бэкофф `RETRY_BASE_MS` 30с → ×2 → макс `RETRY_MAX_MS` 15мин, guard по уже заведённому таймеру), при полном успехе `cancelRetry()` (снимает таймер + сбрасывает бэкофф); таймер вызывает `void autoRefresh().catch(…)`; `resetRateRefreshState()` для тестов
- [x] **Grace-период уведомлений** — `runWithNotification` ведёт `consecutiveFailures[kind]`; уведомление в БД создаётся только при `>= NOTIFY_AFTER_FAILURES` (3) подряд неудачах одного источника (сообщение дополнено «Повторные попытки выполняются автоматически.»); успех сбрасывает счётчик и снимает уведомление через `resolveKind` — кратковременные сбои (сеть при загрузке ПК, одиночный blip скрейпа) не мелькают в баннере
- [x] `server/src/index.ts` — старт и 4-часовой интервал переведены на `autoRefresh` (лог дополнен CNY/USD), лог ошибок без изменений
- [x] `server/src/routes/rates.ts` — `POST /api/rates/refresh` → `autoRefresh()` (ручной сбой тоже заводит ретрай)
- [x] Тесты `server/tests/rates-refresh.test.ts`: счётчики сбрасываются в `beforeEach` через `resetRateRefreshState()`; 4 существующих кейса перестроены под grace (тихо после 1–2 неудач, уведомление с 3-й, восстановление снимает); новый describe «autoRefresh retry scheduling» (fake timers): бэкофф 30с→60с→120с, уведомление на 3-й неудаче, успех снимает таймер и уведомление, полный успех до срабатывания таймера отменяет ретрай
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **385 (27 файлов)** ✓ (+2), клиент **75 (13 файлов)** ✓; живьём после правки tsx watch перезапустил сервер — `Rates on startup: PokerDom=ok, EUR/USD=ok, CNY/USD=ok`, `/api/notifications` пусто, `stale:false`
- [x] AGENTS.md актуализирован (блок «Курсы»: авто-ретрай + grace-период, index.ts/`autoRefresh`, `.catch` на `autoRefresh`, rates-тесты)

## Слайс «Pending-маркер: явный сейв снимает кнопку импорта» (2026-09-23)

> Симптом: «Заполнить турниры» для GG не пропадала, хотя баланс поправлен и турниры сохранены.
> Диагностика (живая БД): GG — manual баланс 23.09 (2845), маркер `pending_imports` на 23.09
> (`created_at 09:30:37`), турниров на 23.09 нет (последние 19/20.09). Причина: играл в прошлые
> дни, баланс записал только сегодня; архив покрыл прошлые дни (не сегодняшние турниры) →
> `reconcilePendingImports` в `saveDayBatch` после сейва снова ставил маркер на MAX(manual) дату.
> Старый тест «сейв на старый день не снимает маркер нового дня» кодировал именно это поведение.
> Решение: явный сейв = отмашка. `saveDayBatch` при ≥1 записанном турнире снимает маркер рума
> через `clearPendingImport`, пустой сейв откатывается на `reconcilePendingImports`. Маркер
> взводится заново следующей записью баланса (`upsertBalance`), поэтому цикл «поправил баланс →
> импортировал → сохранил → играл → поправил баланс → импортировал» работает.
> Полный отчёт — `tasks/session-log.md`.

- [x] `server/src/services/pending.ts` — новый экспорт `clearPendingImport(roomId)` (DELETE маркера рума, внутри `withTransaction`)
- [x] `server/src/services/tournaments.ts` — `saveDayBatch`: `if (cleaned.length > 0 || deduped.length > 0) clearPendingImport(roomId); else reconcilePendingImports(roomId)`; docstring обновлён
- [x] `server/tests/pending.test.ts` — переписан кейс «сейв на старый день» (теперь снимает маркер нового дня); добавлены «пустой сейв сохраняет маркер» и «новая запись баланса после сейва взводит маркер заново»
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **387 (27 файлов)** ✓ (+2), клиент **75 (13 файлов)** ✓; живьём tsx watch перезапустил сервер (PID 11688), маркер GG@23.09 снят прямым DELETE (чистая бухгалтерия), `/api/balances/current` → GG `pendingImport:false`, 23.09 реконсилится чисто (casino-writeoff −465, остаток 0, расхождений нет)
- [x] AGENTS.md актуализирован (блок «Ожидание импорта турниров»)

### Следующее
- [ ] Пользовательская проверка глазами: автозапуск после перезагрузки ПК — уведомление не мелькает; при искусственно прерванном источнике уведомление появляется только после 3 неудач и исчезает при восстановлении
- [ ] Накопленное (см. выше): глазами «Привычки»/«Цели»/попап турниров, живьём graceful shutdown, виртуализация списков турниров — бэклог

## Слайс «Пакетная загрузка архивов GG + фикс петли «Списать на казино»» (2026-09-24)

> Симптомы: 1) импорт турниров не даёт загрузить больше двух отчётов за раз (нужен батч 3–5
> файлов, ~150+ турниров); 2) после «Списать» в «Депозитах и выводах» система бесконечно
> генерирует новое расхождение — петля. RCA петли (формула): `R = S − T − (X + W_old)`, а
> `storeCasinoWriteoff` делал upsert ЗАМЕНОЙ `W := R` → `R' = W_old ≠ 0` при повторном списании
> (первое закрывало, т.к. `W_old = 0`). Фикс: писать кумулятив `R + W_old` + `currency = excluded.currency`
> + ранний return при `R = 0`. Мульти-загрузка: `<input multiple>` + `handleFiles` (последовательный
> цикл, per-file try/catch, дедуп по `tournamentId`). Полный отчёт — `tasks/session-log.md`.

- [x] `server/src/services/tournaments.ts` — helper `writeoffUsd(roomId, date)` (переиспользован в `casinoUsd`); кумулятивная сумма в `writeoffCasinoRemainder`/`writeoffDiscrepancy`; ранний return при `amount === 0`; upsert с `currency = excluded.currency`
- [x] `client/src/components/TournamentPopup.tsx` — `multiple` на input, мгновенная очистка `value`, `handleFile` → `handleFiles(files)`: последовательный цикл, per-file try/catch (сбой одного файла не теряет остальные, ошибки в `error`), дедуп по `tournamentId`+`removedImportIds`, лейбл «Выбрать архивы»
- [x] `server/tests/transactions-discrepancy.test.ts` — тест второго списания переписан: `amount = 150_00` (кумулятив) + день закрыт (`discrepancies` пуст)
- [x] `server/tests/tournaments.test.ts` — новый «accumulates casino write-offs instead of alternating into an infinite flag» (writeoff → правка баланса → повторный → сумма растёт, день закрыт)
- [x] `client/tests/tournament-popup.test.tsx` — два новых: мульти-выбор 3 файлов (3 запроса по порядку, дедуп дублей, «Разобрано 3 из 3») и сбой второго файла (первый сохранён + `b.zip: …` в error)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **388 (27 файлов)** ✓ (+1), клиент **76 (13 файлов)** ✓ (+2)
- [x] AGENTS.md актуализирован? — блоки про `casino_writeoffs`/writeoff и импорт GG в AGENTS.md не требуют правок (кумулятивный write-off — внутренняя реализация `services/tournaments.ts`; мульти-файл — UI-деталь)

## Слайс «Reconciliation: списание как умная пружина» (2026-09-25)

> Симптом: «фантомное» расхождение возвращалось после ретроспективного импорта турниров
> или правки балансов. RCA (доказан репро-тестом и на живой БД): `casino_writeoffs.amount`
> — «замороженный» скаляр, который никогда не пере-пиннивался, поэтому
> `R_reported = W_true − W_stale` (дрейф, а не реальная нехватка). Кейс A: списали 4000,
> ретроспективно импортировали реальный турнир +4000 → `S=4000, T=4000, W=4000`,
> настоящая нехватка 0, но `remainder=-4000` (100% фантом на сходящемся дне). Кейс C:
> правка баланса ДРУГОГО дня сдвигает carry-forward базу → `remainder=-2000` (знак
> перевёрнут). Живая БД: GG 2026-09-23 `W_stored=+1170`, `W_true=+705`, `R=−465`.
> **Фикс слайса 2026-09-24 (кумулятивное накопление) неверен** — он усугублял дрейф.
> Решение пользователя: «plug с авто-репином» — списанный день закрыт навсегда,
> эффективное значение write-off вычисляется на лету как `S − T − X`. Миграции БД нет.

- [x] `server/src/services/tournaments.ts` — удалены `writeoffUsd`/`casinoUsd`; добавлены `isCasinoWriteoff(roomId, date)` (маркер = наличие строки; `amount` больше не участвует в математике) и `casinoTransactionsUsd(roomId, date)` (явные `type='casino'` в USD по курсу дня); `computeReconcile`: при write-off `casinoUsd = S − T`, `remainder = 0`, `discrepancyPct = 0` (без `flagged`), иначе `R = S − T − X` с порогом 5%; `writeoffCasinoRemainder`/`writeoffDiscrepancy` — пишут сам остаток, ранний return при `0` (комментарий сохраняется)
- [x] `server/tests/tournaments.test.ts` — тест «accumulates casino write-offs…» переписан в «keeps a written-off day closed after a balance edit instead of re-pinning it» (запись в БД не переписывается; после правки баланса `remainder=0`; повторное списание — no-op)
- [x] `server/tests/transactions-discrepancy.test.ts` — тест «overwrites the write-off when the remainder changes…» переписан в «keeps a written-off day closed and preserves the comment after a balance edit»; новый интеграционный describe **«Mixed Ledger Update»** (7 шагов: флаг → списание с комментарием → ретроспективный импорт турнира → правка баланса другого дня → правка баланса того же дня → поздняя casino-транзакция → `adjust-balance`+повторное списание — день не переоткрывается ни разу, комментарий цел)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `tsc --noEmit` ✓, сервер **389 (27 файлов)** ✓ (+1), клиент **76 (13 файлов)** ✓
- [x] П.2 «пакетная загрузка» — **уже реализован** в слайсе 2026-09-24 (`<input multiple>` + `handleFiles`); хард-лимита на число файлов нет, `limits: { files: 1 }` в `app.ts` — per-request контракт multipart (клиент шлёт по одному файлу), накопленные турниры склеиваются дедупом по `tournamentId` и уходят одним `/bulk`. Изменений не потребовалось

### Следующее
- [ ] Пользовательская проверка глазами: «Депозиты и выводы» — списанный день не краснеет после ретроспективного импорта турниров и после правки балансов (в т.ч. баланса другого дня); комментарий списания виден после переоткрытия попапа
- [ ] Накопленное (см. выше): глазами «Привычки»/«Цели»/попап турниров, живьём graceful shutdown, виртуализация списков турниров — бэклог

## Слайс «Import Flow Write-Off Sync: атомарное списание в окне импорта» (2026-09-29)

> Симптом пользователя: «нажал “Списать” в окне импорта — турниры сохранились, но расхождение
> НЕ списалось и висит в разделе “Транзакции” как незакрытое».
> **RCA по живой БД (read-only инспекция `data/poker-crm.sqlite` + живой `/api/transactions?includeDiscrepancies=1`):**
> списание модальной даты **отработало штатно** — в `casino_writeoffs` есть строки
> PokerDom@2026-09-29 (−2992) и GG@2026-09-29 (−1742), созданные в 16:17/16:20 локально, комментарий
> «Авто-списание: …». Висят **другие** дни — GG@2026-09-25 (+1750) и PokerDom@2026-09-25 (+2989),
> у которых запись баланса `source='auto'`: carry-forward играет транзакции, но НЕ результаты турниров,
> поэтому `S = X` (проигрыш в казино) и `R = S − T − X ≡ −T` — расхождение **равно профиту турниров**,
> т.е. это артефакт интерполяции, а не недостача. Списывать нечего: баланса за день нет.
> Сама заявленная в слайсе дыра тоже реальна и закрыта: кнопка «Списать» в попапе была **двумя**
> неатомарными запросами (`POST /bulk`, затем `POST /writeoff-casino`) — сбой второго оставлял
> «турниры сохранены, день открыт» (ровно описанный пользователем класс отказа).

- [x] `server/src/services/tournaments.ts` — выделено единое write-off-ядро `applyCasinoWriteoff(roomId, date, comment)` (валидация `blank`, ранний return при `amount === 0` c сохранением комментария, `storeCasinoWriteoff`, повторный `reconcileDay`); `writeoffCasinoRemainder` и `writeoffDiscrepancy` переписаны на него (каждый в своём `withTransaction`); `saveDayBatch(..., { writeoffCasino })` зовёт ядро для модальной даты ВНУТРИ своей транзакции (после `recomputeRoomBalances`/pending) — несводимый день роняет весь батч
- [x] `server/src/routes/tournaments.ts` — `POST /api/tournaments/bulk` принимает `writeoffCasino?: boolean` (валидация типа) и возвращает уже закрытый `reconcile` модальной даты
- [x] `client/src/lib/api.ts` — `api.tournaments.save(..., writeoffCasino = false)` шлёт флаг в тело; мёртвый `api.tournaments.writeoffCasino` удалён (эндпоинт на сервере остался)
- [x] `client/src/components/TournamentPopup.tsx` — `saveThen('writeoff')` = один `save(..., true)` и показ закрытого дня из ответа; `saveThen('adjust')` по-прежнему добирает баланс отдельным `adjustBalance` (ему нужны сохранённые турниры)
- [x] `server/tests/import-writeoff.test.ts` — новый интеграционный файл (4 теста): списание одним запросом (турниры + маркер + пустые discrepancies), обычный сейв без флага оставляет день открытым, **откат всего батча** при несводимом дне, паритет с кнопкой «Транзакций» (reconcile и amount/currency совпадают, отличается только комментарий)
- [x] `client/tests/tournament-popup.test.tsx` — два теста: «Списать на казино» = один `save(..., true)` без `adjustBalance` и с показом закрытого дня; обычный «Сохранить» — пять аргументов
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **393 (28 файлов)** ✓ (+4), клиент **78 (13 файлов)** ✓ (+2); временный `server/tests/_scratch.test.ts` удалён
- [x] AGENTS.md актуализирован (атомарный `writeoffCasino` в `/bulk`, общее ядро `applyCasinoWriteoff`, правило «только по ручному балансу», счётчики тестов)

## Срез «Auto-Balance Discrepancy Suppression» (2026-09-29)

> Решение пользователя: **вариант A** — на день с авто-интерполированным балансом расхождение не
> считается вообще. Причина: `source='auto'` — это carry-forward, он играет транзакции, но НЕ
> результаты турниров, поэтому `S = X` и `R ≡ −T` — 100% фантом, нечем честно закрыть (измеренного
> баланса не существует). Подавление, а не запрет: как только баланс за день записан вручную, день
> начинает сверяться по-настоящему.

- [x] `server/src/services/sessions.ts` — `RoomProfit.source: 'manual' | 'auto'` (копируется из `BalanceEntry` в `buildRoomProfit`): реконсиляция видит, что за балансом стоит измерение или интерполяция
- [x] `server/src/services/tournaments.ts` — в `computeReconcile` после «уже списан» добавлена ветка `session.source === 'auto'` → `remainderUsd = null`, `discrepancyPct = null`, `flagged = false`, `blank = 'нет ручного баланса за день — сверить не с чем, запиши его в «Балансах»'`; числа (`sessionProfitUsd`/`tournamentProfitUsd`/`casinoUsd`) сохраняются. Порядок проверок: нет курса → нет баланса → **уже списан** (умная пружина не должна сломаться) → авто-баланс → расчёт
- [x] `client/src/components/TournamentPopup.tsx` — при `blank` попап показывает причину вместо зелёного «сходится» (и не предлагает «Списать»/«Поправить баланс», т.к. `flagged=false`)
- [x] `server/tests/transactions-discrepancy.test.ts` — describe «auto-interpolated balance: no phantom discrepancy», 3 теста: (1) день с `source='auto'` → `remainderUsd=null`, `discrepancyPct=null`, `flagged=false`, `blank` про ручной баланс, `discrepancies` пуст; (2) тот же день → бейдж в `reconcile-summary` не amber, `writeoff-casino` = 400 и **ничего не пишет** в `casino_writeoffs`; (3) `upsertBalance` того же дня → `manual`, `remainder=100_00`, `flagged=true`, день появляется в `discrepancies` и только теперь списывается. Красный тест подтверждён: без ветки `auto` падают 2 из 3
- [x] `client/tests/tournament-popup.test.tsx` — тест «объясняет, почему нечего сверять»: `blank` показан, «сходится» нет, кнопок «Списать»/«Поправить баланс» нет
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, сервер **396 (28 файлов)** ✓ (+3), клиент **79 (13 файлов)** ✓ (+1)
- [x] Живая проверка на БД пользователя: `GET /api/transactions?includeDiscrepancies=1` → **0** строк (было 2); `reconcile` за 25-е у GG и PokerDom → `flagged=false, remainder=null, blank=<причина>`; закрытый 29-е у GG по-прежнему `remainder=0`. `reconcile-summary` за 25-е отдаёт 10/12/1 турниров без флага → в «Сессиях» нейтральный чип «N турн.»

## Срез «Зеркала PokerDom: POKERDOM_MIRRORS + последовательный fallback» (2026-09-30)

> Задача пользователя: список зеркал вынести в переменную окружения (актуальное + старое),
> при обрыве/таймауте/DNS-ошибке не падать, а пробовать следующее зеркало по порядку, писать
> в лог уровнем debug/info причину по каждому зеркалу, прерываться на первом успехе и выдать
> одну финальную ошибку, если недоступны все.

- [x] `server/src/services/rates/pokerdon.ts` — `DEFAULT_POKERDOM_MIRRORS` (`pd-play-x7wq3.com/poker`, затем `plk7pokerdom.com/poker`) + экспортируемая `resolvePokerDomUrls(raw = process.env.POKERDOM_MIRRORS)`: split по запятой, trim, фильтр `^https?://\S+$`, дедуп по порядку, пусто/мусор → дефолты
- [x] Там же — `MirrorLog`/`defaultMirrorLog` (`console.info`, префикс `[rates] PokerDom mirror unavailable <url>: <причина>`) и `scrapeFromMirrors(page, urls, log)`: `goto` + `waitForSelector(USD)` + парсинг в одном try на зеркало, `return` на первом успехе, агрегированная ошибка «Все зеркала PokerDom недоступны (N): url — причина; …»
- [x] `scrapeUsdRub` переведён на `scrapeFromMirrors` (внешний цикл `ATTEMPTS = 3`, бэкофф 5с/10с, закрытие browser context и обёртка ошибки сохранены); мёртвый `openPage` удалён, добавлен `errorMessage`
- [x] `server/tests/pokerdon.test.ts` — +8 тестов: 3 на разбор `POKERDOM_MIRRORS` (список/trim+дедуп/мусор → дефолты) и 5 на fallback (таймаут первого зеркала, `ERR_NAME_NOT_RESOLVED`, страница без `USD`, short-circuit после успеха, агрегированная ошибка со всеми причинами). Файл: 12 тестов ✓
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` ✓ — сервер **404 (28 файлов)** (+8), клиент **79 (13 файлов)** без изменений
- [x] Живая проверка: `POST /api/rates/refresh` → `{"ok":true,"usdRub":true,"eurUsd":true,"cnyUsd":true}`. Попутно подтвердилось в логе, что fallback нужен по делу: первый холодный заход на `pd-play-x7wq3.com` отвалился по `page.waitForSelector: Timeout 180000ms exceeded`, зеркало было помечено в логе, а курс в итоге записался (`87,2784` на 2026-09-30). Прямая проверка всех трёх адресов (`wer7`/`plk7`/`pd-play`) сейчас отдаёт курс за 2–3с
- [x] Срез «Scraper Fail-Fast Timeout» (решение пользователя): `TEXT_WAIT_MS` 180с → **30с**, ровно как `PAGE_TIMEOUT_MS`. Замер на живом коде: зеркало без блока `USD` понижается за 30с, следующее отвечает, весь проход `34с` вместо `184с+`; живой refresh после правки — `{"ok":true,…}`. Худший случай всего цикла (2 зеркала × 3 попытки) — ≈6 мин вместо 18
- [x] Проверено после обеих правок: `npm run build` ✓, `npm run lint` ✓, `npm test` ✓ — сервер **404 (28 файлов)**, клиент **79 (13 файлов)**

## Срез «Boot Storm & Network Delay Audit» (2026-09-30)

> Проблема: при старте через «Автозагрузку» Wi-Fi/DNS поднимаются с задержкой, и мгновенный старт
> Node + скрайпера ловит «сеть недоступна» вхолостую и бьётся за CPU. Задача: пауза только для
> `-Background`, аудит Node-точки входа на предмет фатального падения без сети и сохранение
> идемпотентности автозапуска.

- [x] `start.ps1` — пауза `Start-Sleep -Seconds $bootDelaySeconds` (15с) **только** в ветке `-Background`, перед старом; хелпер `Write-AutostartLog` пишет в `logs/autostart.log` в UTF-8 (старые строки остались в legacy-кодировке — не перекодировались)
- [x] `start.ps1` — новая `Start-Background` вместо инлайн-блока: проверка портов уехала **после** паузы и под именованным мьютексом `PokerCRM-Autostart` (`WaitOne(5с)`, затем `WaitOne(70с)`) → двойной автозапуск не плодит копии, но если первый упал, второй поднимает сервисы сам
- [x] Аудит `server/src/index.ts` + `services/rates/refresh.ts` + `rates/eras.ts` — **правок не потребовалось**: фатального пути нет (сеть не участвует в `getDb()`/`recomputeAllBalances()`/`createApp()`/`listen()`; единственный `exit(1)` — незанятый порт), каждый источник курсов обёрнут в `runWithNotification` → `ENOTFOUND`/`ERR_INTERNET_DISCONNECTED` дают `false` + `scheduleRetry()` (30с→15мин), оба вызова `autoRefresh` с `.catch`; контракт уже закреплён тестом `server/tests/rates-refresh.test.ts` (тишина до 3 неудач → уведомление → бэкофф → снятие на успехе)
- [x] Живая проверка скрипта: одиночный `-Background` → `15,7s` и строка «сервисы уже подняты — повторный автозапуск не создаю»; **два параллельных** `-Background` → оба пережили паузу, выстроились по мьютексу, порты 3001/5173 остались с теми же PID (`23648`/`17688`), exit code 0/0 — копий не появилось
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` ✓ — сервер **404 (28 файлов)**, клиент **79 (13 файлов)**, без изменений в коде сервера

## Спринт «Hall of Fame» (2026-09-30)

> Задача: пожизненные рекорды на вкладке «Статистика» — бэкенд-агрегация (SQL), один JSON-endpoint,
> современная сетка карточек со скелетоном и empty-state, интеграционные тесты. Три записи рекордов
> **намеренно считаются по разным источникам денег** (см. решения ниже), счётчики разводят MTT и MBR.

- [x] `server/src/services/hallOfFame.ts` (новый) — `hallOfFame(roomIds?)`: `careerSpan()` (один `MIN/MAX` по `balance_entries` + `tournaments` + `transactions`), `tournamentRows`/`casinoRows`/`roomNamesById` (по одной выборке на источник, без N+1), всё под `withRateCache`; `sessionsInRange(span)` переиспользуется как есть
- [x] Решения по деньгам (главное в этом спринте):
  - `topSession`/`lifetimeProfitUsd` — **только `source='manual'`**: авто-интерполяция играет транзакции, но не результаты турниров, поэтому её профит — фантом и рекордом быть не может (то же правило, что в реконсиляции)
  - `topTournament` — `result − buyin` по курсу дня, MBR **включён** (это реальный выигрыш)
  - `topDay` — `турниры + casino` за день; сессионный профит **не прибавляется** — дельта баланса уже содержит результаты турниров (иначе двойной счёт)
  - запись с неположительным профитом = `null` + пояснение в `blank`; ничьи отдаются самой ранней строке (дата, затем id), чтобы рекорд не мигал
  - `tournamentCount` = MTT (правило изоляции MBR), `mbrCount` — отдельной плашкой: на живой базе MBR (117) больше MTT (103), спрятать его за одним числом было бы враньём
- [x] `server/src/routes/statistics.ts` — `GET /api/statistics/hall-of-fame?roomIds=` → `{ hall }`, парсинг id тот же, что у `/sessions` (мусорные отбрасываются)
- [x] `server/tests/hall-of-fame.test.ts` (новый, 11 тестов) — пустая БД; лучший рум-день, а не сумма дня; авто-день с казино не становится рекордом; «нет ни одного прибыльного дня»; лучший турнир с местом и дневным курсом; день = турниры + казино; рум не назван при нескольких румах; счётчики игровых дней/MTT/MBR; фильтр `roomIds` + пустой фильтр = все; неконвертируемая строка (CNY) даёт `blank`, но считается; маршрут через `app.inject`
- [x] `client/src/lib/types.ts` — `HallRecord` + `HallOfFameStats` (зеркало сервера); `client/src/lib/api.ts` — `api.statistics.hallOfFame(roomIds?)`
- [x] `client/src/components/HallOfFame.tsx` (новый) — 3 карточки-рекорда (молния/кубок/пламя + сумма `tabular-nums` + название/рум в цвете рума + дата + `detail`), полоса счётчиков (профит за карьеру с подписью «только дни с записанным балансом», дни игры, турниры + «+ N MBR отдельно»), скелетон `animate-pulse` c `role="status"`, empty-state, янтарная строка `blank`
- [x] `client/src/pages/Statistics.tsx` — секция над KPI-карточками периода (зал славы пожизненный, период его не сужает), собственный `useEffect` на `selectedRoomIds`, цвета румов из уже загруженного `rooms`
- [x] `client/tests/hall-of-fame.test.tsx` (новый, 4 теста) — скелетон, empty-state, полный набор рекордов (суммы, даты, `detail`, цвет рума), частичный набор + `blank` + «+ N MBR отдельно»
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` ✓ — сервер **415 (29 файлов)**, клиент **83 (14 файлов)**; живой `GET /api/statistics/hall-of-fame` на реальной базе: `topSession $51.04 (PokerDom, 17.09)`, `topTournament $37.38 (RedStar)`, `lifetime −$222.69`, 10 дней игры, 103 MTT + 117 MBR, `topDay` = `null` (в septябре не было дня с положительным игровым P&L) и `blank: null` — карточка честно показывает «рекорда пока нет»; фильтр `?roomIds=7,junk,0` отдаёт только RedStar

> **Откат 2026-09-30 (см. спринт ниже):** отдельный блок удалён как дублирующий виджеты и
> перегруженный пустыми стейтами; в KPI-ряд переехали `Турниров + N MBR отдельно` и `Лучший турнир`.

## Спринт «Hall of Fame Rollback & KPI Integration» (2026-09-30)

> UX-аудит: «Зал славы» дублировал существующие виджеты и перегружал интерфейс пустыми стейтами.
> Решение: удалить отдельный блок, интегрировать `mbrCount` и `topTournament` в классический KPI-ряд.

- [x] Rollback фронта: удалены `client/src/components/HallOfFame.tsx` и импорт/рендер в `client/src/pages/Statistics.tsx`
- [x] Rollback бэка: удалены `server/src/services/hallOfFame.ts` и роут `GET /api/statistics/hall-of-fame` + импорт в `server/src/routes/statistics.ts`
- [x] Бэк-статистика: в `server/src/services/statistics.ts` расширен `SessionStatsResult` полями `mbrCount` и `topTournament: TopTournament | null`, `tournamentAggregate` стал собирать `topTournament` (лучший одиночный турнир за период, MBR включён, при ничьей берётся самая ранняя строка по порядку `t.date, t.id`; шаги без конвертируемого курса пропускаются), добавлены вспомогательные `countTournaments(scope)` и тип `TopTournament`
- [x] Типы/Api клиента: `client/src/lib/types.ts` — удалены `HallRecord`/`HallOfFameStats`, добавлен `TopTournament`, `SessionStatsResult` расширен (`mbrCount`, `topTournament`); `client/src/lib/api.ts` — убран метод `statistics.hallOfFame`
- [x] UI Statistics: KPI-грид превращён в `sm:grid-cols-4` (2×4) с 8 виджетами; виджет `Турниров` показывает MTT-число и подпись `+ [X] MBR отдельно` (через `Card.hint`); добавлен виджет `Лучший турнир` — профит + подпись `Рум · ДД.ММ.ГГГГ` в цвете рума; добавлены `dayLabel()` и вспомогательный `roomColor()`
- [x] Тесты: удалены `server/tests/hall-of-fame.test.ts`, `client/tests/hall-of-fame.test.tsx`; `server/tests/statistics.test.ts` — добавлены проверки `mbrCount`, `topTournament` (включая фильтр `roomIds`, пустой период, правило ничьей не требуется, но поведение с MBR сохранено); `client/tests/statistics-kpi.test.tsx` (новый, 3 теста) — подпись MBR, отображение «лучшего турнира» с цветом подписи, прочерк на пустом периоде
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **407 (28 файлов)**, клиент **84 (15 файлов)**; `npm test -w server` отдельно ✓. Живой смоук: `/api/statistics/sessions?dateFrom=2026-09-16&dateTo=2026-09-30` → `mbrCount: 117`, `tournamentCount: 108`, `topTournament: {"profitUsd":3738,"date":"2026-09-25","roomId":7,"roomName":"RedStar"}`; `/api/statistics/hall-of-fame` → `404` (успешно удалён)

### Следующее
- [ ] Записать реальные балансы за 2026-09-25 (GG, PokerDom) — единственное, что превращает эти дни в сверяемые; авто-фантомы больше не висят и не требуют «Списать на казино»
- [ ] Накопленное (см. выше): глазами «Привычки»/«Цели»/попап турниров, живьём graceful shutdown, виртуализация списков турниров — бэклог

## Спринт <Списание дня = casino-транзакция, миграция v26> (2026-10-05)

> Решение пользователя: маркер списания (`casino_writeoffs`) больше не существует. Остаток дня — обычная
> casino-транзакция в бухгалтерии; «умная пружина», из-за которой день не мог снова открыться, удалена.

- [x] Бэкап до миграции: `server/scripts/backup.mjs` переведён на read-only `DatabaseSync` + `VACUUM INTO` (WAL-safe), снимок `data/backups/poker-crm-2026-10-05T09-17-26-085Z.sqlite` (`user_version=25`, integrity ok)
- [x] Тесты (красные → контракт): `tournaments.test.ts` (остаток в casino-строке, баланс не сдвинут, `R=0` — no-op, повторное списание после правки баланса = новая строка), `transactions-discrepancy.test.ts` (ретроспективный импорт/правка баланса снова открывают день; авто-баланс по-прежнему не сверяется), `import-writeoff.test.ts` (сценарий пользователя: баланс + `/bulk` с `writeoffCasino: true` → casino-строка), `db.test.ts` (v26)
- [x] `funds.ts`: новая `recordCasinoPnl` — валидация + прямой INSERT casino без балансовых legs
- [x] `tournaments.ts`: `applyCasinoWriteoff` пишет casino-транзакцию через `recordCasinoPnl`; `storeCasinoWriteoff` и чтение маркера из реконсиляции удалены; порядок в `saveDayBatch` (турниры → балансы → pending → списание) зафиксирован тестом
- [x] `db.ts`: миграция v26 — перенос оставшихся маркеров в casino-транзакции (signed amount, `fee=0`, `direction` по знаку, `comment`/`created_at` сохраняются, нулевые строки пропускаются) + `DROP TABLE casino_writeoffs`; фикстуры upgrade-тестов дополнены хелпером `legacyLedgerSchema`
- [x] Фронт проверен и правила уже соблюдены: `client/src/lib/api.ts` шлёт `writeoffCasino` в теле одного save, `TournamentPopup.saveThen('writeoff')` = ОДИН запрос (правка только комментария)
- [x] Удалён осиротевший `server/scripts/migrate_casino_writeoffs.ts` (конвертировал USD→RUB с identity-rate багом; его вывод — транзакции `#44`/`#45` с хвостом комментария «(migrated from casino_writeoffs #N, …)»)
- [x] Dry-run миграции на копии живой БД: 7 маркеров → 7 casino-строк, `integrity ok`, `foreign_key_check` пуст, дублей нет (абортированный скрипт удалял свои маркеры); после миграции открытым остаётся ровно один день — GG 2026-09-23 (`R = -934`), и он был открыт и до миграции
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **414 (28 файлов)**, клиент **84 (15 файлов)**
- [x] Документация: `AGENTS.md` (списание дня, порядок в `saveDayBatch`, v26, `db.ts`/tests, `recordCasinoPnl`, WAL-safe backup)

### Осталось за пользователем (спринт v26)
- [ ] Перезапустить сервисы (`start.ps1` → [1] Перезапустить): миграция v26 применится к живой БД при старте; бэкап уже есть
- [ ] Закрыть день GG 2026-09-23 кнопкой «Списать» в «Транзакциях» (единственный открытый остаток, −$9.34) — и проверить глазами, что строка «Казино» появилась в истории

## Слайс «Импорт без ручных дат: авто-привязка баланса к дате импорта» (2026-10-08)

> Симптом пользователя: после импорта турниры встают на правильные даты отчётов (4 окт), но рядом
> появляются фантомные сессии 5/8 окт — баланс записан «сегодня» (`Balances.tsx` шлёт `date: TODAY`,
> формы даты в «Балансах» нет). Требование: «Я не хочу даты сам никакие вносить» — импорт должен сам
> привязать баланс к дате игры. RCA: турниры корректны (все 13 на `2026-10-04` в БД и в
> `/api/tournaments/summary`); фантомы = manual-балансы PokerDom 5.10 (id 1072, 22654 RUB) и GG 8.10
> (id 1230, 4 USD); RedStar баланс записан 4.10 — сессия одна (контраст). Попутно закрыт пробел:
> `pokerdomParser` игнорировал `dayStartHour` (GG применял).

- [x] `server/src/services/tournaments.ts` — `reanchorBalanceToBatch(roomId, batchDates)`: `target` = последняя дата батча (даты импортов ∪ modal-дата, только при ручных строках батча); перенос выполняется, если последняя **manual**-запись баланса рума позже `target`, на ней нет турниров рума датой > `target`, в зазоре `(target, дата баланса]` нет транзакций (включая casino); порядок: удалить auto-строку `target` → `UPDATE date` ручной записи → `recomputeRoomBalances(roomId)`; возвращает `{from, to} | null`. Гард-исключения: транзакция в зазоре, ретроимпорт (турнир после `target`), ручной якорь уже на `target` (UNIQUE), ручные строки на modal-дне, manual-only сейв (без импортов), writeoff-флоу (casino-транзакция modal-дня пишется до проверки → блокирует перенос, поведение «Списать» не меняется)
- [x] `saveDayBatch` — вызов `reanchorBalanceToBatch` в той же транзакции ПОСЛЕ `applyCasinoWriteoff`, возврат дополнен `reanchored: {from, to} | null` (через `return` колбэка `withTransaction`, без внешнего `let` — TS сужал `let` до `null` и не видел присваивание в колбэке)
- [x] `server/src/routes/tournaments.ts` — `/bulk` отдаёт `reanchored`; `client/src/lib/api.ts` — тип `save` дополнен; `client/src/components/TournamentPopup.tsx` — `saveThen('adjust')` шлёт `adjustBalance(roomId, saved.reanchored?.to ?? date)` («Поправить баланс» привязывается к новому дню)
- [x] `server/src/services/pokerdomimport.ts` — `parsePokerDomText(text, fallbackCurrency, dayStartHour = 0)`: блок со стартом раньше порога сдвигается `addDays(-1)` (как GG); `tournamentId` считается по ИСХОДНОЙ дате отчёта → смена настройки пере-импортирует, а не дублирует; адаптер передаёт `ctx.dayStartHour`
- [x] Тесты: новый `server/tests/balance-reanchor.test.ts` (7: перенос + сессия исчезает + маркер снят; 5 гард-исключений; паритет writeoff — поведение «Списать» не меняется); `server/tests/pokerdomimport.test.ts` +4 (сдвиг до порога, без сдвига на/после порога, дефолт 0, стабильность `tournamentId` при сдвиге)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **425 (29 файлов)** ✓ (+11), клиент **84 (15 файлов)** ✓ без изменений
- [x] Документация: `AGENTS.md` (параграф «Авто-привязка баланса к датам импорта», `dayStartHour` в PokerDom-импорте и в «Logical Day Boundary», `reanchorBalanceToBatch` в списке сервисов, тесты 29)

### Следующее
- [x] Рестарт не понадобился: dev-сервер (`tsx watch`) подхватил правки сам (PID 22984, старт 14:14:23) — новый код живой
- [x] Правка существующих данных **отменена по решению пользователя (2026-10-08)**: одноразовый dry-run скрипт показал, что к утру оба дня уже закрыты его списаниями (casino `#52` 05.10 −2652, `#54` 08.10 −3600; остатки 0 и 0.9%), а на 08.10 стоят свежие депозиты (PokerDom +700 000 RUB, GG +10 048 USD) — перенос баланса GG исказил бы запись депозита, и турниры PokerDom 4 окт оказались плюсовыми (+26 243 RUB), т.е. падение на 5-м — не турнирный проигрыш. Пользователь выбрал «оставить как есть»; скрипт и экспорт `reanchorBalanceToBatch` удалены, бэкап `data/backups/poker-crm-2026-10-08T11-28-09-997Z.sqlite` сохранён
- [ ] Накопленное: глазами «Привычки»/«Цели»/попап турниров, живьём graceful shutdown, виртуализация списков турниров — бэклог

## Слайс «Fix Casino Transaction Bulk Save Bug» (2026-10-08, дубль — без правок прод-кода)

> Повторная постановка уже закрытой 2026-10-05 задачи «Списать в попапе не создаёт строку в
> истории транзакций» (+ гипотеза `0n`/`measured` в `DayReconcile`). По протоколу debugger.md
> проведён аудит всех пяти пунктов; единственный дефицит — отсутствие интеграционного покрытия.

- [x] Аудит: порядок `saveDayBatch` уже «турниры → recompute → pending → запись» в одной
  `withTransaction` (`tournaments.ts`), `applyCasinoWriteoff` зовётся последним → остаток считается
  по уже записанному состоянию; символов `0n`/`measured` в коде нет (`remainderUsd: number | null`,
  флаг — `blank`); на авто-дне writeoff отвечает 400 (правило «только по ручному балансу»), а не
  silent no-op; клиент не вызывает standalone `/tournaments/writeoff-casino` (единственный путь —
  `save(..., writeoffCasino)` в теле `/bulk`)
- [x] Live-подтверждение на работающем сервере: casino `#54` (08.10 10:28, −3600, «Авто-списание…»)
  создана этим же флоу — фикс работает; баг воспроизводить не на чем
- [x] `server/tests/import-writeoff.test.ts` +3 HTTP-интеграционных теста: (1) полный путь
  `POST /transactions` депозит → `PUT /api/balances` ×2 → `/preview` flagged → `/bulk` с
  `writeoffCasino: true` → ровно одна casino-строка в `transactions` и видна в
  `GET /api/transactions?type=casino`; (2) live-сценарий «архив позади, баланс на modal-дне» →
  `reanchored: null` (запись в зазоре блокирует перенос); (3) «reanchor → списание»: первый сейв
  переносит баланс на дату турниров, второй пишет строку на новый modal-день
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **428 (29 файлов)** ✓ (+3),
  клиент **84 (15)** ✓; прод-код не менялся (отчёт в session-log, только тесты)

## Слайс «Sessions Global Column Alignment» (2026-10-08)

> UI-баг: колонки «Рум / Дельта / Профит / кнопка» в разных день-карточках не выровнены по
> вертикали — каждая карточка рендерит свой `<table class="w-full">` с auto-layout, ширины
> считаются по контенту строки и расходятся между днями. Требование: единый CSS Grid-класс
> для шапки и строк данных во всех карточках.

- [x] `client/src/pages/Sessions.tsx` — `<table>` заменён на div-CSS-Grid: общий
  `rowGridCls = 'grid grid-cols-12 items-center'` + константы ячеек `col-span-4/3/3/2`
  (`roomCellCls` слева, `deltaCellCls`/`profitCellCls` справа, `actionCellCls` справа, все с
  `px-4 py-2`); шапка карточки и каждая строка данных используют одни и те же константы →
  колонки физически совпадают у всех дней; `tabular-nums`/цвета комнат/`text-sm`/бордеры/кнопка
  сохранены как были; шапка «Итого» не тронута
- [x] `client/tests/sessions-order.test.tsx` — селекторы `tbody tr` → `renderedDates()` (таблицы
  больше не существуют; порядок дат и шапка «Итого» проверяются по-новому) + регрессионный тест
  «единый grid»: 6 строк (3 дня × header+data) имеют `grid-cols-12`, ячейки 1–4 —
  `col-span-4/3/3/2` в каждой карточке
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — клиент **85 (15 файлов)** ✓ (+1),
  сервер **428 (29)** ✓

### Следующее (слайсы 2026-10-08)
- [ ] Глазами на `http://localhost:5173/` → «Сессии»: колонки выровнены по вертикали между днями
  при скролле (светская UAT-проверка двух правок этой сессии)
- [ ] Накопленное: глазами «Привычки»/«Цели»/попап турниров, живьём graceful shutdown, виртуализация списков турниров — бэклог

## Слайс «Preview моделирует реанкор: убирает фантомное расхождение» (2026-10-09)

> Пользователь: PokerDom — баланс записан «сегодня» (10-09, 707654 RUB), турнир на 10-08 (buyin 150
> RUB, result 0), депозит +700000 RUB на 10-08. Превью показывает фантом «Профит из баланса −$1.68 /
> Профит турниров 0 / Расхождение 100%», хотя сейв сводит день в 0. RCA: `previewDayReconcile`
> сверял только модальный день и фильтровал `r.date === date`, не моделируя `reanchorBalanceToBatch`;
> сейв предназначен свести турнир с МАССИВНОЙ дельтой (депозит + фолл задачи баланса), т.е. день
> закрывается, а превью врало. Директива пользователя: «самое правильное решение, не костыль, как
> сеньор» — превью обязано моделировать реанкор тем же кодом решений, что и сейв.

- [x] `server/src/services/tournaments.ts` — из `reanchorBalanceToBatch` вынесены чистые read-only
  гарды `reanchorTarget(roomId, batchDates): {from,to} | null`; `reanchorBalanceToBatch` теперь
  использует его же (единый источник правды, дрифт превью/сейва исключён); рефактор
  `reconcileFromSession(roomId, date, {start, end})` = `computeReconcile(rows, balanceDelta, flows)`
  (база для проецирования сессии целевого дня)
- [x] `previewDayReconcile(roomId, date, lines, imports)` возвращает
  `{ reconcile, wouldReanchor: {from,to} | null }`: при `wouldReanchor` — виртуальная запись
  `computeRoomProfit({...manual, date: to})` + импорты `r.date === to` + `casinoTransactionsUsd(to)`;
  превью остаётся stateless (в БД НИЧЕГО не пишет)
- [x] `server/src/routes/tournaments.ts` — `/api/tournaments/preview` возвращает результат
  `previewDayReconcile` напрямую (роут больше не выдёргивает `{reconcile}` из ответа);
  `client/src/lib/api.ts` — тип `{ reconcile, wouldReanchor }`
- [x] `client/src/components/TournamentPopup.tsx` — стейт `wouldReanchor`; вместо янтарной панели
  «Расхождение 100%» — нейтральная заметка «Баланс {from} будет привязан к {to} при сохранении —
  сверка выполняется на этот день.»
- [x] Тест `server/tests/tournaments.test.ts` — «previewDayReconcile models the balance re-anchor and
  reconciles the target day»: балансы 09-10 = 100_00 и 09-12 = 100_00, депозит +30_00 на 09-11,
  импорт 09-11 (buyin 30_00, result 0) → `wouldReanchor {from 09-12, to 09-11}`, session −30_00,
  tournament −30_00, remainder 0, flagged false; ключевые условия класса: на целевом дне не должно
  быть ручного баланса (`manualAtTarget` блокирует), транзакции НА целевом дне разрешены (блокирует
  только разрыв `(target, from]`)
- [x] Тест `client/tests/tournament-popup.test.tsx` — describe «баланс-реанкор в превью»: сценарий
  1:1 пользователя (баланс сегодня, импорт вчера, депозит) → вместо «Расхождение 100%»
  нейтральная заметка о привязке; assertion `/Расхождение/` → `/Расхождение \d+%/` (зелёная строка
  «Расхождение в пределах 5% — сходится.» тоже содержит слово «Расхождение»)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **429 (29 файлов)** ✓ (+1),
  клиент **86 (15 файлов)** ✓ (+1), `npm test -w server` отдельно ✓
- [x] Документация: `AGENTS.md` (превью моделирует реанкор через `wouldReanchor`, `reanchorTarget`
  как общий источник правды, тесты 29/86)

## Слайс «Kitchen Sink Data Fix — выравнивание GG» (2026-10-11)

> Пользователь видит 3 жёлтых дня GG в «Транзакциях» (09-23 +3.00, 10-08 +3.20, 10-10 +7.72) при
> «корректно заполненных» турнирах/балансах. Директива: сейчас просто выровнять базу (прод-фикс
> «умного распределения» — позже). RCA-отчёт и данные — в session-log.

- [x] Диагноз — read-only репликатор серверной формулы `R = S − T − X` на живой БД (конверсия
  CNY через inverse USD→CNY) уложил все три значения до цента. **Класс A «турнир приехал в уже
  закрытый день»**: 09-23 (MBR #426 −3.00 импортирован 10-10 23:02:53, ПОСЛЕ закрытия дня
  списанием #53 от 10-05) и 10-08 (турнир #420 −3.20 импортирован 10-10, ПОСЛЕ списания #54 от
  10-08 10:28:20). **Класс B «дыра дня без ручного баланса»**: 10-10 (анкер = auto-carry-forward
  10-09 = 100.52, дельта −8.98 охватывает и 10-09 (+10.92 турниры), и 10-10 (−16.70), а `T`
  считает только 10-10) ⟹ R=+7.72. Итоговая дыра интервала 10-09↔10-10 = −3.20 (непокрытая
  игра; гипотеза — неучтённый re-entry/баунти).
- [x] Про-двойной счёт: для Класса A remedy «Списать на казино» пишет НОВУЮ casino-строку на R,
  а сумма уже сидит в прежнем списании (оно вычислялось при неполном `T`) ⟹ честное закрытие =
  УМЕНЬШИТЬ прежнее списание, а не дописать сверху.
- [x] Бэкап перед правкой: `data/backups/poker-crm-2026-10-11T10-24-02-985Z.sqlite` (`npm run backup`)
- [x] Правки одной атомарной транзакцией (`BEGIN IMMEDIATE … COMMIT`, WAL-сервер жив):
  `UPDATE transactions SET amount=-3280 WHERE id=54` (36.00→32.80); `UPDATE transactions
  SET amount=-634 WHERE id=53` (9.34→6.34); `UPDATE balance_entries SET amount=10824,
  source='manual', base_amount=NULL, base_tx_id=NULL WHERE room_id=8 AND date='2026-10-09'`
  (auto→ручной снимок 108.24 = 91.54 + турниры 10-10 16.70); `INSERT casino −320` на 10-09
  (дыра −3.20 — коррекция кладётся НА 10-09, а не 10-10: только так R(10-10)=0; на 10-10 была
  бы +3.20). Профит окна 10-08→10-10 консервативен (−8.98), лишь перераспределён (10-09 +7.72 /
  10-10 −16.70); ручной якорь 10-09 `recomputeRoomBalances` не трогает.
- [x] Проверено: репликатор — все дни GG `R=0.00` (остальные ≈ −0.01…−0.72, ниже 5% — без
  флагов); живой сервер `GET /api/transactions?includeDiscrepancies=1` → **discrepancies: [] (0)**
  (это ровно янтарные строки «Транзакций»); `/api/sessions` 10-08…10-10: GG 10-09 `manual`
  S=+7.72, 10-10 S=−16.70; `logs/server.err.log` пуст. Кода не менялось.
- [x] Одноразовые скрипты вне репо: `C:\Users\vybor\AppData\Local\Temp\opencode\gg-verify.mjs`
  (репликатор reconcile), `gg-apply.mjs` (транзакция правки).

### Следующее
- [ ] Продуктовый фикс «умное распределение» (решение пользователя — позже): загрузка пачки
  турниров + один актуальный баланс = авто-разнесение по реальным датам + сведение расхождений
  без ручной правки прошлых дней; частный случай Класса A — ретро-импорт в день, закрытый
  списанием, должен предлагать «снять с прежнего списания», а не новую casino-строку (двойной счёт)
- [ ] Сверка остатка −3.20 на интервале 10-09↔10-10 с GG-архивом (гипотеза: неучтённый
  re-entry/баунти $3.20); если подтвердится — дописать строку турнира, а не править карточку 10-10
- [ ] Накопленное: глазами «Привычки»/«Цели»/попап турниров, живьём graceful shutdown,
  виртуализация списков турниров (бэклог)


### Слайс «Diary UI Polish & Rich Text» (2026-10-12)
- [x] Rich text дневника целей на Tiptap v3.31.4 (Ж/К/Подчёркнутый/Маркер), санитизация HTML на сервере и клиенте (diaryHtml.ts), legacy plain-text совместим
- [x] Кнопки дневника в один ряд: ctions-слот EntryComposer, «Выполнено/Завершить» справа, шрифт записей 	ext-base
- [x] Граница content 1–5000 по видимому тексту (код-поинты), тесты toggle/aria-pressed/rich-рендер
- [x] Проверено: 
pm run build ✓, 
pm run lint ✓, 
pm test — сервер **460 (30 файлов)** ✓ (+5), клиент **101 (17 файлов)** ✓ (+6)
### Слайс «Rich Text Advanced Formatting — Font Size & Pastel Highlights» (2026-10-12)
- [x] Санитайзер diaryHtml (сервер+клиент): allowlist +`span`, `font-size: <8..20>px`, `mark` — `background-color`/`data-color` (hex), нормализация браузерного `rgb(...)` → hex, отсев named/`url()`/`!important`/alpha≠1
- [x] `DiaryEditor`: `@tiptap/extension-text-style` (`TextStyle`/`FontSize`) + `Highlight.configure({ multicolor: true })`; селектор «Размер шрифта» 8–20 (16 → `unsetFontSize`); пастельная палитра маркера (`role="menu"`/`menuitem`, click-outside/Esc), root без `overflow-hidden`
- [x] Тесты: сервер +6 (span/mark/rgb→hex), клиент +9 (тулбар + unit `sanitizeDiaryHtml`)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **466 (30 файлов)** ✓ (+6), клиент **110 (17 файлов)** ✓ (+9)
- [ ] UAT: тулбар дневника (размер шрифта, палитра, сброс на 16, round-trip)

### Слайс «Header Z-Index Fix» (2026-10-12)
- [x] `client/src/App.tsx`: `<header>` `sticky top-0 z-10` → `z-40` (контент вкладки «Цели» перекрывал шапку)
- [x] Первопричина: `header` (z-10) и `GoalsPage` (relative z-10) в одном stacking-контексте, `<main>` позже в DOM → контент поверх шапки; `z-40` ниже модалок (`z-50`) и лайтбокса (`z-[70]`)
- [x] Проверено: `npm run lint` ✓, `npm run build` ✓, `npm test` — сервер **466 (30 файлов)** ✓, клиент **110 (17 файлов)** ✓
- [ ] UAT: прокрутить «Цели» — шапка не перекрывается

### Слайс «Pure Poker Statistics Core Fix» (2026-10-12)
- [x] `server/src/services/statistics.ts`: `sessionStats` считает только из `tournaments` scope `'all'` (сессии = дни с турнирами, профит = сумма турниров дня); удалён `sessionsInRange`; `activityCalendar`/`tournamentCountByDay` → `'all'`
- [x] `client/src/pages/Statistics.tsx`: подпись «Турниров» `+ N MBR отдельно` → `в т.ч. N MBR`; `client/src/lib/types.ts` — комментарий
- [x] Решение пользователя: MBR включать везде (единый скоуп `'all'`); касса (депозиты/выводы/казино/корректировки) полностью исключена
- [x] Тесты: `statistics.test.ts` переписаны + инвариант `KPI == график == Σ сессий == календарь` при наличии кассы; `statistics-kpi.test.tsx` — подпись
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **467 (30 файлов)** ✓ (+1), клиент **110 (17 файлов)** ✓
- [ ] UAT: «Статистика» — «Все румы» за месяц без расхождений между KPI/графиком/календарём

### Слайс «Checklist 3-State Status & Popover» (2026-10-12)
- [x] `ChecklistStatus` (`pending`/`completed`/`failed`) вместо `done: boolean`; серверный нормализатор `checklist.ts` + back-compat чтения старых строк без миграции БД
- [x] `GoalChecklist`: popover-меню статусов (`ChecklistStatusMenu`) вместо чекбокса; кольцо прогресса считает только `completed`
- [x] reconcile: `daily` авто-закрывается (все `completed` → achieved, любой `failed` → failed, нет `pending` → resolve); `custom`/метричные сохраняют гейт «все completed»
- [x] Тесты: сервер +4 (легаси `done`, custom не закрывается при failed, daily активна при pending, daily auto-fail), клиент +2 (popover-статус, «Очистить» только при статусе)
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **471 (30 файлов)** ✓ (+4), клиент **111 (17 файлов)** ✓ (+1)
- [ ] UAT: чеклист — три состояния, прогресс по выполненным, авто-fail ежедневника

### Слайс «Habit Partial Status & Statistics» (2026-10-12)
- [x] `server/src/services/habits/types.ts`: `HabitStatus` расширен значением `partial`; `HabitStats.partial`
- [x] `server/src/services/habits/service.ts`: `validateStatus` принимает `partial`; `computeStats` — success-формула `round((done+partial)/tracked*100)`, серию удлиняет только строгий `done`
- [x] `server/src/db.ts`: миграция **v28** — rebuild `habit_logs` под CHECK `('done','partial','missed')` (rename → CREATE → INSERT → DROP → пересоздание `idx_habit_logs_date`); старые строки копируются
- [x] `db.test.ts`: пины версии 27→28 (16 шт.), хелпер `legacyHabitLogsSchema` во всех фикстурах v21+ (uv≥20), тест v28 (сохранение строк + приём `partial` + отказ `bogus` + идемпотентность)
- [x] `habits.test.ts`/`habits-route.test.ts`: `partial: 0` в `toEqual`, тесты partial-статуса и success-формулы, роут `PUT /:id/log` со `partial`
- [x] Клиент: `HabitStatus`/`HabitStats.partial`, `metrics.ts` (`progressPercent`/`habitMonthProgress`/`overallMonthProgress`), `HabitPopover` («Частично»), `HabitTracker` (амбер-ячейка `%`, колонка «Прогресс», итог «Общий прогресс за месяц»), `HabitHistory` (чип «Частично» + амбер-сегмент мини-полосы)
- [x] Клиентские тесты: `partial: 0` в фикстуре, partial-ячейка + прогресс за месяц + summary, обновлён тест истории (67%, «Частично»)
- [x] `client/src/App.tsx`: контейнер вкладки «Привычки» расширен до `max-w-[90rem]` (шапка + `<main>` через `contentWidth`), чтобы новая колонка «Прогресс» не вызывала горизонтальный скролл; таблица уже `w-full`
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **474 (30 файлов)** ✓ (+3), клиент **112 (17 файлов)** ✓ (+1)
- [ ] UAT: привычки — отметить «Частично», проверить амбер-ячейку, колонку «Прогресс» и итог за месяц

### Слайс «Sessions Casino Explicit Display / Pure Poker Profit» (2026-10-12)
- [x] `server/src/services/sessions.ts`: `RoomProfit` += `casinoUsd` / `pokerProfitUsd` (`= profitUsd − casinoUsd`); `profitUsd` не тронут (вход сверки); `SessionDay.totalUsd` = сумма `pokerProfitUsd` (чистый покер); `casinoUsdFor` для одиночного пути + агрегация казино одним проходом в `sessionsInRange`
- [x] `client/src/lib/types.ts`: зеркало полей `casinoUsd` / `pokerProfitUsd`
- [x] `client/src/pages/Sessions.tsx`: колонка «Профит», итог дня и верхние KPI — по чистому покеру; подпись `↳ Казино: ±$X.XX` при `casinoUsd !== 0`
- [x] Тесты: `balances.test.ts` +2 (изоляция `casinoUsd`/`pokerProfitUsd` + чистый `totalUsd`; смешанный день турнир+казино), `sessions-order.test.tsx` — фикстура + тест отображения
- [x] Решение пользователя: «Профит = чистый покер»; сверка работает на неизменном `profitUsd`
- [x] Проверено: `npm run build` ✓, `npm run lint` ✓, `npm test` — сервер **476 (30 файлов)** ✓ (+2), клиент **113 (17 файлов)** ✓ (+1)
- [ ] UAT: «Сессии» — колонка «Профит» = чистый покер, подпись «↳ Казино» при казино, KPI без кассы; сверка дня сходится
