import Decimal from 'decimal.js'

export interface SizingInput {
  /** Account equity. */
  equity: Decimal.Value
  /** Fraction of equity to risk on this trade, e.g. 0.01 = 1%. */
  riskPct: Decimal.Value
  entry: Decimal.Value
  stop: Decimal.Value
  /** Minimum tradeable quantity for this instrument. */
  minQty: Decimal.Value
  /** Quantity increment the venue accepts (lot size / step size). */
  lotSize: Decimal.Value
}

export interface SizingResult {
  /** Rounded DOWN to the nearest `lotSize` multiple; 0 if that falls below `minQty`. */
  quantity: Decimal
  riskAmount: Decimal
  riskPerUnit: Decimal
}

/**
 * [PROPUESTA] PositionSizer — PROMPT_MASTER_CLAUDE_CODE.md §6/§37 F3:
 * "sizing redondea bien a `lotSize`/`minQty`". Pure, `decimal.js`
 * throughout per AGENTS.md "decimal.js for financial arithmetic" — never
 * rounds UP past the risk budget, never returns a quantity below `minQty`
 * (falls to 0 instead of trading an under-sized position).
 */
export function sizePosition(input: SizingInput): SizingResult {
  const equity = new Decimal(input.equity)
  const riskPct = new Decimal(input.riskPct)
  const entry = new Decimal(input.entry)
  const stop = new Decimal(input.stop)
  const minQty = new Decimal(input.minQty)
  const lotSize = new Decimal(input.lotSize)

  const riskAmount = equity.mul(riskPct)
  const riskPerUnit = entry.minus(stop).abs()

  if (riskPerUnit.isZero() || lotSize.isZero()) {
    return { quantity: new Decimal(0), riskAmount, riskPerUnit }
  }

  const rawQty = riskAmount.div(riskPerUnit)
  const lots = rawQty.div(lotSize).floor()
  const quantity = lots.mul(lotSize)

  if (quantity.lt(minQty)) {
    return { quantity: new Decimal(0), riskAmount, riskPerUnit }
  }
  return { quantity, riskAmount, riskPerUnit }
}
