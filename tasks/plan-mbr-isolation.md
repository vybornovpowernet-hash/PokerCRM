# Implementation Plan: Phase 24 — Изоляция «Mystery Battle Royale» (MBR)

## Overview

Турниры «Mystery Battle Royale» (hyper-turbo, 18 участников, только рум GG, приходят
только из GG-архива) **перестают влиять на MTT-статистику**: раздел «Статистика»
(кроме графика профита), главная таблица/KPI раздела «Турниры» и метрика «Цели»
(distance) теперь считают только обычные турниры (`is_mbr = 0`). Деньги MBR
по-прежнему участвуют в реконсиляции с балансами, в карточках на балансовых метриках
и в графике профита (всё движение денег). Под основной таблицей вкладки «Турниры»
добавляется отдельный блок «Mystery Battle Royale» (сыграно, профит, ROI, ABI; AFS
не нужен — всегда 18). Уже введённые 20 турниров MBR (GG, 2026-09-16) переносятся в
новую сущность миграцией-бэкфиллом. **Никаких потерь данных, никаких изменений
денежной математики.**

## Факты, проверенные по живой базе и коду

- БД: `user_version = 12`, 57 турниров всего. MBR-кандидаты: **20 строк** (id 20–39),
  все на руме GG, все с датой 2026-09-16, валюта USD.
  - Имена: `Mystery Battle Royale $1, Hold'em No Limit` ×19 + `Mystery Battle Royale $3, Hold'em No Limit` ×1.
  - Результаты: +$5.50 (id 23), +$9.00 (id 37), +$6.25 (id 38), остальные $0.
  - Ожидаемая сводка MBR после миграции: count=20, бай-ины=$22.00 (2200),
    профит=−$1.25 (−125), ROI≈−5.68%, ABI=$1.10, AFS=18.
- Классификация только по имени: `LIKE 'Mystery Battle Royale%'` (без учёта регистра;
  в SQLite LIKE по ASCII регистронезависим). Других MBR-паттернов в данных нет.
- Текущие точки MTT-аналитики (все будут фильтроваться `is_mbr = 0`):
  - `server/src/services/statistics.ts`: `sessionStats` (tournamentCount, averageBuyinUsd,
    roiPercent из `tournamentAggregate`), `tournamentCountByDay`, `activityCalendar`,
    `tournamentSummary`.
  - `server/src/services/goals/db.ts` → `collectGoalsFacts` (COUNT турниров → distance).
  - Pending-маркер: `server/src/services/pending.ts#45` и `tournamentsExistMap`
    (`server/src/services/tournaments.ts#117`, `routes/balances.ts#27` → кнопка
    «Заполнить турниры»).
- Точки, которые **остаются всё-инклюзивными** (деньги обязаны сходиться):
  - Реконсиляция: `computeReconcile`, `listDayTournaments`, `previewDayReconcile`,
    `saveDayBatch`, `replaceDayTournaments`, `recomputeRoomBalances` (интерполяция),
    `orphanedDiscrepancies`, `deleteImportedTournament`.
  - График профита: `sessionStats.profitSeries` (кумулятив по турнирам).
  - Балансовые метрики: `totalProfitUsd`, «Сессий», «Ср. профит/день», «Лучший/Худший
    день», `tournamentTimeline` (эндпоинт `/api/statistics/timeline` мёртвый — клиент
    его не зовёт, не трогаем).
- Импорт: `saveDayBatch` умеет upsert по `(room_id, tournament_id)` (`ON CONFLICT DO
  UPDATE`) — в его SET добавится `is_mbr`. Ручные строки всегда `name IS NULL` → `is_mbr = 0`.

## Architecture Decisions

1. **Отдельная сущность = колонка `tournaments.is_mbr`, не новая таблица.**
   - Плюсы: единый FK `room_id`, единый дедуп по `(room_id, tournament_id)`, каскады и
     интерполяция не меняются; реконсиляция по-прежнему видит все строки одним SQL;
     «разделение» достигается на уровне запросов аналитики (`is_mbr = 0`).
   - Отдельная таблица потребовала бы дублирования ключей и JOIN'ов на каждом
     аналитическом SQL-е — риск рассинхронизации дедупа между таблицами.

2. **Классификация — по имени, в одном месте (`isMbrByName`).**
   - Вызывается только в `saveDayBatch` (ветка импортов) и в миграции-бэкфилле.
   - Парсеры (`ggParser`/`pokerdomParser`) не меняются — они возвращают `name`, флаг
     ставит сервис сохранения. Это сохраняет дедуп по `tournament_id`.
   - Упор на паттерн-префикс `Mystery Battle Royale`, а не точное равенство — защита
     от изменения суффикса ($X, Hold'em No Limit) у GG.

3. **«Единый источник не-исключения» — реконсиляция и профит-график не получают
   фильтр вообще.** Флаг `is_mbr` влияет ТОЛЬКО на MTT-агрегаты. Это гарантирует:
   сессия дня сходится с дельтой баланса как раньше, расхождения >5% не появляются от
   MBR, деньги не «пропадают» из учёта.

4. **Pending-маркер и кнопка «Заполнить турниры» становятся MTT-семантичными.**
   Импорт только MBR-архива НЕ закрывает «ожидание импорта» — маркер снимается, лишь
   когда на последний manual-день есть MTT-турниры. Разумно, т.к. MBR больше не входит
   в «турниры» для целей MTT.

5. **Форма ответа `GET /api/tournaments/summary` расширяется до `{ summary, mbr }`.**
   `summary` — прежний (теперь чисто MTT), `mbr` — новая сводка блока. Клиентский
   контракт-тип пополняется; «Статистика» не меняет своего API (сервер сам фильтрует).

6. **Колонка с default `0`** — существующие и будущие ручные строки автоматически MTT;
   единственная «позитивная» запись флага — по имени MBR при импорте (и бэкфилл).

## Task List

### Phase 24.1: Миграция v14 + бэкфилл

- [x] Task 1: `db.ts` — миграция v14 (v13 занята `goals.title` Phase 25): `ALTER TABLE tournaments
  ADD COLUMN is_mbr INTEGER NOT NULL DEFAULT 0` + бэкфилл `UPDATE tournaments SET is_mbr = 1 WHERE
  TRIM(name) LIKE 'Mystery Battle Royale%'` (LIKE регистронезависим). `user_version = 14`.
  - Acceptance: миграция идемпотентна; 20 существующих MBR-строк получили `is_mbr=1`,
    остальные 37 — `0`; ручные строки (`name IS NULL`) не задеты.
  - Verify: `db.test.ts` пинит 14; апгрейд-тест v13→v14 (`runMigrations` экспортирован)
    — вставляет `Mystery Battle Royale $1, ...` и обычную строку ДО миграции, после —
    флаги 1/0; `npm test -w server`.
  - Files: `server/src/db.ts`, `server/tests/db.test.ts`.
  - Size: S.

### Checkpoint: v14
- [x] Пин 13→14 в тестах, `npm run build && npm run lint && npm test -w server`.

### Phase 24.2: Бэкенд — классификация + флаг в строках

- [x] Task 2: `isMbrByName(name)` в `services/tournaments.ts` (case-insensitive префикс
  `mystery battle royale`); `saveDayBatch` в ветке импортов проставляет `is_mbr` в
  INSERT и в ON CONFLICT DO UPDATE (переимпорт с изменённым именем обновит флаг);
  `TournamentRow`/mapRow + SELECT получают `is_mbr`.
  - Acceptance: импорт с MBR-именем → сохраняется `is_mbr=1`; обычное имя → 0; ручные
    строки → 0; повторный импорт того же `tournament_id` не теряет флаг и дедуп.
  - Verify: `tournaments.test.ts` (+3–4: импорт MBR/не-MBR, ручная строка, upsert с
    флагом); `import-gg.test.ts` э2е (загрузка архива с MBR-файлом → строка `is_mbr=1`).
  - Files: `server/src/services/tournaments.ts`, `server/tests/{tournaments,import-gg}.test.ts`.
  - Size: M.

### Phase 24.3: Бэкенд — аналитика: MTT-фильтр + MBR-сводка

- [x] Task 3: `statistics.ts` — единый SQL-хелпер диапазона с опцией `mbr:
  'all'|'mtt'|'mbr'` (default `'all'`); фильтры `is_mbr = 0` в: `tournamentCount`
  (`sessionStats`), `tournamentAggregate` для `averageBuyinUsd`/`roiPercent`,
  `tournamentCountByDay`, `activityCalendar`, `tournamentSummary`. `profitSeries` —
  остаётся `all` (график профита включает MBR).
  - Acceptance: серия профита содержит MBR-строки; все MTT-агрегаты исключают их;
    число турниров в статистике уменьшается ровно на 20; ROI/ABI/календарь/гистограмма
    считаются по MTT.
  - Verify: `statistics.test.ts` (+6: MTT-summary без MBR, mbr-summary изолирован,
    profitSeries с MBR, tournamentCount/avgBuyin/roi без MBR, tournamentCountByDay без
    MBR, activityCalendar без MBR).
  - Files: `server/src/services/statistics.ts`, `server/tests/statistics.test.ts`.
  - Size: M.

- [x] Task 4: `routes/tournaments.ts` — `GET /api/tournaments/summary` возвращает
  `{ summary, mbr }`, где `mbr = tournamentAggregate/kpi(... mbr:'mbr')` → `{ count,
  totalBuyinUsd, totalProfitUsd, roiPercent, blank? }`; диапазон/roomIds валидируются
  как у `summary`.
  - Acceptance: эндпоинт отдаёт обе части; MBR-часть на реальных данных: count=20,
  buyin=2200, profit=−125, roi≈−5.68, ABI=110.
  - Verify: `statistics.test.ts` + `import-gg.test.ts` (роут-э2е), live-проверка.
  - Files: `server/src/routes/tournaments.ts`, тесты.
  - Size: S.

### Phase 24.4: Бэкенд — pending-маркер + Цели + балансовая кнопка

- [x] Task 5: `pending.ts#reconcilePendingImports` — проверка турниров дня с
  `AND is_mbr = 0`; `tournamentsExistMap` (кнопка «Заполнить турниры» в «Балансах») —
  то же.
  - Acceptance: день с только MBR-импортом → маркер остаётся/кнопка видна; день с
    MTT-турнирами → маркер снят/кнопка скрыта (как раньше). Поведение для кошельков
    не меняется.
  - Verify: `pending.test.ts` (+2) и `balances.test.ts`/`tournaments.test.ts` (hasTournaments).
  - Files: `server/src/services/pending.ts`, `server/src/services/tournaments.ts`,
    `server/tests/{pending,tournaments,balances}.test.ts`.
  - Size: S.

- [x] Task 6: `goals/db.ts` `collectGoalsFacts` — `COUNT(*) ... WHERE is_mbr = 0`
  (distance). Bankroll не трогаем (балансовый, деньги MBR в нём учтены по природе).
  - Acceptance: метрика distance не растёт от MBR-турниров.
  - Verify: `goals.test.ts` (+2: MTT-счёт с примесью MBR, выучка только MTT).
  - Files: `server/src/services/goals/db.ts`, `server/tests/goals.test.ts`.
  - Size: XS.

### Checkpoint: Backend
- [x] `npm run build && npm run lint && npm test -w server`; live: `/api/tournaments/summary`
  на реальных данных даёт MTT-сводку без 20 MBR и изолированную MBR-сводку; сессии/балансы
  сходятся как раньше.

### Phase 24.5: Клиент — контракт + блок MBR во вкладке «Турниры»

- [x] Task 7: `types.ts` — `MbrSummary` (`count:number; totalBuyinUsd:number; totalProfitUsd:number;
  roiPercent:number|null; avgPosition:number|null; blank:string|null;
  breakdown: MbrBreakdownRow[]`), где `MbrBreakdownRow = { buyin:number; count:number;
  profit:number; roi:number|null; avgPosition:number|null }`;
  тип ответа summary = `{ summary, mbr }`; `api.ts` — `tournaments.summary` возвращает
  обе части.
  - Verify: build/lint.
  - Files: `client/src/lib/types.ts`, `client/src/lib/api.ts`.
  - Size: XS.

- [x] Task 8: `pages/Tournaments.tsx` — главные KPI/таблица остаются из `summary`
  (теперь серверно MTT). Ниже — блок «Mystery Battle Royale»: заголовок, 4 величины
  (сыграно, профит, ROI, ср. место — из `mbr`) и таблица разбивки по бай-инам
  (бай-ин/сыграно/профит/ROI/ср. место), пустое состояние «Нет MBR-турниров за
  период» при нуле; переиспользуемые formatter'ы из `lib/money.ts`.
  - Acceptance: блок отображается и обновляется с фильтрами/пилюлями румов как основная
    таблица; при 0 — корректное пустое состояние; ABI/AFS в блоке НЕ выводятся.
  - Verify: build/lint; мануально в браузере (вчерашняя сессия GG → 20 MBR в блоке).
  - Files: `client/src/pages/Tournaments.tsx`.
  - Size: M.

### Checkpoint: Complete
- [x] Все acceptance criteria фаз 24.1–24.5 выполнены.
- [x] `npm run build && npm run lint && npm run test` (сервер + клиент).
- [ ] Live-проверка на реальных данных (см. «Verification-гарантии»).
- [ ] Ревью пользователя.

## Verification-гарантии (как проверяем, что ничего не сломано)

1. **Нет потерь данных**: миграция v14 только ADD COLUMN + UPDATE по имени; никаких
   DELETE. Апгрейд-тест v13→v14 на копии схемы подтверждает полный перенос (57→57 строк,
   20 помечены).
2. **Деньги сходятся**: `listDayTournaments`/`computeReconcile`/`recomputeRoomBalances`
   не фильтруются. Все существующие тесты балансов/сессий/расхождений должны остаться
   зелёными без правок (их фикстуры — `name IS NULL` → `is_mbr=0`).
3. **Цифры на реальных данных**: до/после — снять `/api/tournaments/summary`,
   `/api/statistics/sessions`; после миграции count падает на 20, профит-график и
   сессии/профит KPI не меняются (они остаются всё-инклюзивными).
4. **Профит-график**: `profitSeries` — `mbr:'all'`; тест на наличие MBR-точки в серии.
5. **Дедуп импорта**: upsert по `(room_id, tournament_id)` не сломан — MBR-строки
   сохраняют `tournament_id`, повторная загрузка архива не дублирует.
6. **Pending-маркер**: импорт ТОЛЬКО MBR не снимает маркер; существующие тесты
   pending обновляются на MTT-семантику и остаются зелёными.

## Risks and Mitigations

| Риск | Impact | Mitigation |
|------|--------|------------|
| GG сменит название (суффикс, регистр) | Med | Классификация — регистронезависимый префикс `mystery battle royale` в одном хелпере; при изменении формата правится одна функция (флаг — только бухгалтерия). |
| Миграция на живой БД (57 строк) | Low | Аддитивная колонка + UPDATE по LIKE; апгрейд-тест v13→v14 на копии; бэкап `npm run backup` перед миграцией. |
| Кнопка «Заполнить турниры» исчезнет, если день содержит только MBR | Low | MTT-семантика в `reconcilePendingImports` + `tournamentsExistMap` — маркер остаётся до MTT-импорта (Task 5). |
| MBR-строки случайно попадут в MTT-сводку при новом паттерне имени | Low | Разовый live-audit: после миграции count MTT = 37, mbr.count = 20. |
| Классификация в двух местах разъедется (сохранение vs бэкфилл) | Low | Обе ветки используют один префикс-паттерн; тест на импорт MBR-имени зеркалит тест миграции. |

## Open Questions

1. **KPI «Профит» и балансовые карточки «Статистики»** (`totalProfitUsd`, «Сессий»,
   «Ср. профит/день», «Лучший/Худший день»). Рекомендация: оставить про деньги
   (включают MBR) — это согласовано с графиком профита («всё движение денег»), а
   выделить MBR из дельты баланса нельзя без искажений. **Нужно подтверждение**.
2. **Блок MBR во вкладке «Турниры»**: только 4 цифры или + компактный список
   индивидуальных строк (дата/рум/место/профит), как в аккордеоне основной таблицы?
   Рекомендация: цифры + раскрывающийся список (можно «посмотреть» сами турниры).
3. **Пустое состояние блока MBR**: показывать блок всегда («Сыграно 0») или скрывать
   при нуле? Рекомендация: показывать всегда (различие MTT/MBR наглядно).