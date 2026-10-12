# Жизненный цикл сессии (Save / Restore)

Шпаргалка для работы в OpenCode: как **завершить** сессию в терминале с сохранением
контекста и как **восстановить** его при следующем запуске.

## Зачем это

Контекст сессии живёт только в памяти текущего терминала. Чтобы пережить закрытие
терминала или перезагрузку компьютера, состояние переносится в файлы проекта —
они переживают любые перезагрузки. OpenCode автоматически подхватывает `AGENTS.md`
при старте каждой новой сессии, поэтому проектные файлы — это единственное
постоянное хранилище контекста.

## Постоянное состояние проекта

| Файл | Что хранит | Кто ведёт |
|---|---|---|
| `AGENTS.md` (корень) | Project Map: техстек, структура, конвенции, команды, границы. Автозагружается OpenCode в каждой сессии | `context-engineering` |
| `tasks/plan.md` | План работ и архитектурные решения | `planning-and-task-breakdown` |
| `tasks/todo.md` | Список задач со статусами `[x]` / `[ ]` | `planning-and-task-breakdown` |
| `tasks/session-log.md` | История сессий: что сделано, решения, блокеры, следующие задачи | `context-engineering` |

## Скиллы (агенты), управляющие контекстом

- **[context-engineering](skills/context-engineering/SKILL.md)** — точка входа: как
  читать и обновлять `AGENTS.md`, Project Map, иерархия контекста
- **[planning-and-task-breakdown](skills/planning-and-task-breakdown/SKILL.md)** —
  ведение `tasks/plan.md` и `tasks/todo.md`
- **[documentation-and-adrs](skills/documentation-and-adrs/SKILL.md)** — фиксация
  решений и причин («почему так»)
- **[using-agent-skills](skills/using-agent-skills/SKILL.md)** — мета-скилл: выбор
  нужного скилла под задачу

> Скиллы живут в `.agents/skills/` — рядом находятся и их дубликаты в `.claude/skills/`.

## ЗАВЕРШЕНИЕ сессии (перед закрытием терминала)

Вставь в OpenCode перед завершением работы:

```
Завершаем сессию. Используй скиллы context-engineering
(.agents/skills/context-engineering/SKILL.md) и
planning-and-task-breakdown (.agents/skills/planning-and-task-breakdown/SKILL.md).

1. Если структура или архитектура проекта изменилась — обнови Project Map в AGENTS.md.
2. Обнови tasks/todo.md: отметь выполненные задачи, зафиксируй текущую и следующие.
3. Добавь запись в tasks/session-log.md: что сделано за сессию, принятые решения,
   блокеры, открытые вопросы, следующая задача.
4. Верни краткую сводку и путь к последней записи session-log.
```

## СТАРТ новой сессии (после запуска OpenCode)

Вставь в OpenCode сразу после запуска:

```
Восстанови контекст. Используй скилл context-engineering
(.agents/skills/context-engineering/SKILL.md) и при необходимости
planning-and-task-breakdown и documentation-and-adrs.

1. Прочитай AGENTS.md (Project Map).
2. Прочитай tasks/plan.md и tasks/todo.md.
3. Прочитай последнюю запись tasks/session-log.md.
4. Верни сводку: что уже сделано, на чём остановились, что делать дальше.
```

## Короткие варианты команд

- **Finish:** `Сохрани состояние сессии — скиллы context-engineering + planning-and-task-breakdown`
- **Start:** `Восстанови контекст по AGENTS.md и tasks/session-log — скилл context-engineering`

## Порядок действий при перезагрузке без ручной команды

1. OpenCode при старте сам прочитает `AGENTS.md`.
2. Прочитай `tasks/session-log.md` (последняя запись) и `tasks/todo.md` — состояние задач восстановлено.
3. Продолжай с задачи, помеченной как текущая.