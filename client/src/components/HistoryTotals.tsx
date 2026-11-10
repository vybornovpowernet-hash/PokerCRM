import { formatAmount, formatSignedAmount } from '../lib/money'
import type { TransactionTotals } from '../lib/types'

/**
 * Шапка итогов «Истории операций»: все числа приходят из `totals` списка,
 * здесь только форматирование, знак и слово. Ничего не складывается: сумма
 * переводов и курсовой разницы — работа сервера (`transactionsTotals`).
 */

const FLOW_TITLE = 'Без переводов: перевод это перекладывание денег между своими румами'

type Forms = readonly [string, string, string]

/** Русское согласование числительного (1 / 2-4 / 5+), дательный падеж: «по N …». */
function pluralRu(count: number, forms: Forms): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

const ROWS_TO: Forms = ['строке', 'строкам', 'строкам']
const TRANSFERS_FROM: Forms = ['перевода', 'переводов', 'переводов']

/** Величина числа: модуль для показа, знак подбирается словом рядом. */
function magnitude(value: number): string {
  return formatAmount(Math.abs(value), 'USD')
}

/** Подсказка «из чего сложено»: серверные составляющие, без клиентской арифметики. */
function costsTitle(totals: TransactionTotals): string {
  const direct = `прямые ${magnitude(totals.feeUsd)}`
  if (totals.fxNetLossUsd < 0) return `${direct} · на курсе выгода ${magnitude(totals.fxNetLossUsd)}`
  return `${direct} · на курсе ${magnitude(totals.fxNetLossUsd)}`
}

function costTone(value: number): string {
  if (value > 0) return 'text-red-400'
  if (value < 0) return 'text-emerald-400'
  return 'text-slate-100'
}

export function HistoryTotals({ totals }: { totals: TransactionTotals | null }) {
  if (!totals) return null

  const extras = (
    <>
      {totals.fxNotCountedTransfers > 0 && (
        <span className="ml-2 text-xs text-slate-500">
          {`курс не учтён у ${totals.fxNotCountedTransfers} ${pluralRu(totals.fxNotCountedTransfers, TRANSFERS_FROM)}`}
        </span>
      )}
      {totals.missingRateRows > 0 && (
        <span className="ml-2 text-xs text-amber-400">
          {`нет курса по ${totals.missingRateRows} ${pluralRu(totals.missingRateRows, ROWS_TO)}`}
        </span>
      )}
    </>
  )

  // Фильтр «Переводы»: суммы «зашло/ушло» не существует, показываем счётчики переводов.
  if (totals.flowScope === 'none') {
    return (
      <span className="ml-auto text-sm text-slate-400">
        {`Переводов: ${totals.transfers.count}`}
        <span title={costsTitle(totals)}>
          {' · Комиссии: '}
          <span className={`font-medium ${costTone(totals.costUsd)}`}>{formatSignedAmount(totals.costUsd, 'USD')}</span>
        </span>
        {extras}
      </span>
    )
  }

  const flow = totals.flowUsd
  const flowMissing = flow === null && totals.flowMissingRateRows > 0

  return (
    <span className="ml-auto text-sm text-slate-400">
      <span title={totals.flowScope === 'all_without_transfers' ? FLOW_TITLE : undefined}>
        Суммарно по фильтру:{' '}
        <span className={`font-medium ${flow != null ? (flow >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-300'}`}>
          {flow != null ? `${flow >= 0 ? '+' : ''}${formatAmount(flow, 'USD')}` : '—'}
        </span>
      </span>
      {flowMissing && <span className="ml-1 text-xs text-amber-400">{`нет курса по ${totals.flowMissingRateRows} ${pluralRu(totals.flowMissingRateRows, ROWS_TO)}`}</span>}
      <span title={costsTitle(totals)}>
        {' · Комиссии по фильтру: '}
        <span className={`font-medium ${costTone(totals.costUsd)}`}>{formatSignedAmount(totals.costUsd, 'USD')}</span>
      </span>
      {extras}
    </span>
  )
}
