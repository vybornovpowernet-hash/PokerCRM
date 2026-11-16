/**
 * Единая точка, где существует игровой «сегодня»: календарный день с порогом
 * `day_start_hour` (ночь до порога всё ещё принадлежит вчерашним суткам).
 * Арифметика чистая и живёт в `lib/date.ts` (`logicalDayKey`), здесь только чтение
 * настройки — чтобы ни один сервис не выводил день сам и определения не разошлись.
 */

import { logicalDayKey } from '../lib/date.js'
import { getDayStartHour } from './settings.js'

export interface LogicalDayContext {
  /** Игровой «сегодня» как YYYY-MM-DD — ровно то, что показывает клиент. */
  today: string
  /** Порог, при котором посчитан `today`. Переданный дальше, он читается один раз на запрос. */
  dayStartHour: number
}

/** Игровое «сегодня»; `now` позволяет не перечитывать часы и настройку на каждый вызов. */
export function getLogicalToday(now: Date = new Date()): string {
  return logicalDayKey(now, getDayStartHour())
}

/** Игровое «сегодня» вместе с порогом: один reading настройки на весь вызов сервиса. */
export function getLogicalDay(now: Date = new Date()): LogicalDayContext {
  const dayStartHour = getDayStartHour()
  return { today: logicalDayKey(now, dayStartHour), dayStartHour }
}
