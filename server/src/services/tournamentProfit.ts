import { convertToUsd } from './rates/convert.js'

/** The fields of a tournament row the profit arithmetic needs. */
export interface TournamentProfitRow {
  roomId: number
  date: string
  buyin: number
  result: number
  currency: string
}

/** Profit of the rows in USD: Σ (result − buyin) converted with the day rate. */
export function tournamentProfitUsd(rows: readonly TournamentProfitRow[]): number {
  let total = 0
  for (const row of rows) {
    const usd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.roomId)
    if (usd !== null) total += usd
  }
  return total
}
