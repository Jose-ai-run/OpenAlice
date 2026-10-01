# Backtest F6 — Resultados y decisión mecánica

[PROPUESTA] Metodología pre-registrada en [[docs/adr/0011-backtest-preregistration.md]]
(commiteado como `542c52cd`, ANTES de descargar un solo dato o correr un
solo backtest). Este documento no reinterpreta ni ajusta nada de ese
pre-registro — reporta lo que salió.

## 1. Dataset real

Descargado vía `services/engine/src/cli/download-market-bars.ts`
(paginación real, `services/uta`, Bybit perpetuos):

| Fuente | Símbolo | 1h | Rango | 4h (derivado) |
|---|---|---|---|---|
| bybit-readonly | BTC/USDT:USDT | 57,148 velas | 2020-03-25 → 2026-10-01 | 14,286 velas |
| bybit-readonly | ETH/USDT:USDT | 48,638 velas | 2021-03-15 → 2026-10-01 | 12,159 velas |

Controles de calidad (`checkBarQuality`, Fase 2): **0 huecos, 0
duplicados, 0 OHLC inválido** en ambos datasets. Hash de dataset
(`hashBars`, sha256) persistido en la tabla `datasets` junto con cada
descarga — BTC 1h: `9c7cb777...` (primera corrida) /
`031a4363...` (segunda, idéntica salvo por el instante marginal de
`fetched_at`), confirmando "misma descarga → mismo contenido".

## 2. Grilla y walk-forward ejecutados

23 combinaciones de parámetros (ADR-0011 §2) × 2 activos × 2
intervalos = **92 variantes**. Walk-forward 12m IS / 3m OOS rodante:
20 folds (BTC) / 16 folds (ETH), holdout = últimos 6 meses
(2026-04-01 → 2026-10-01) para ambos.

## 3. Resultado walk-forward — TODAS las variantes

**0 de 92 combinaciones pasaron los 8 gates en walk-forward.** Ninguna
llegó a evaluarse en holdout (el holdout solo corre para combinaciones
que ya pasaron el walk-forward completo — ADR-0011 §10).

Frecuencia de fallo por gate (de 92 variantes):

| Gate | Descripción | Falló en |
|---|---|---|
| G1 | ≥200 trades (≥100 si baja frecuencia + ≥3 regímenes) | 2/92 |
| G2 | IC95 bootstrap expectativa > 0 | 91/92 |
| G3 | Profit factor ≥ 1.2 | 86/92 |
| G4 | Max drawdown ≤ 12% | 81/92 |
| G5 | Sharpe ≥ 0.8 ajustado (Bonferroni N=92) | **92/92** |
| G6 | Estabilidad ±20% en parámetros vecinos | 89/92 |
| G7 | Ningún mes > 30% del PnL | 15/92 |
| G8 | A3 — monotonía por quintil de score | 39/92 |

**G5 (Sharpe ajustado por las 92 pruebas) falló en el 100% de los
casos** — es, por diseño, el gate más exigente: incluso la variante con
mejor Sharpe puntual (0.92) no sostiene un límite inferior de IC al
99.946% por encima de 0.8 con el tamaño de muestra disponible. Esto es
exactamente lo que el ajuste por pruebas múltiples está diseñado para
hacer: una estrategia que solo se ve bien porque es la mejor de 92
intentos no debe aprobar.

### Tabla completa (92 variantes, orden de la grilla)

| Estrategia | Parámetros | Activo | Intervalo | Trades OOS | PF | Sharpe | MaxDD | Mes máx. | WF |
|---|---|---|---|---|---|---|---|---|---|
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=2 | BTC/USDT:USDT | 1h | 1060 | 0.88 | -0.69 | 87.5% | 0% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=3 | BTC/USDT:USDT | 1h | 943 | 0.81 | -1.10 | 86.8% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=2 | BTC/USDT:USDT | 1h | 1516 | 0.82 | -0.62 | 136.8% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=3 | BTC/USDT:USDT | 1h | 1426 | 0.77 | -0.43 | 122.9% | 0% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=2 | BTC/USDT:USDT | 1h | 718 | 0.84 | -0.08 | 95.0% | 0% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=3 | BTC/USDT:USDT | 1h | 636 | 0.85 | -0.41 | 58.8% | 0% | NO |
| mean-reversion | rsiPeriod=10, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 1h | 1697 | 0.65 | -0.41 | 257.6% | 0% | NO |
| mean-reversion | rsiPeriod=10, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 1h | 556 | 0.59 | -0.77 | 122.0% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 1h | 1089 | 0.63 | -0.96 | 214.7% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 1h | 243 | 0.54 | -1.65 | 73.9% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.005 | BTC/USDT:USDT | 1h | 3600 | 0.48 | 0.12 | 292.1% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.01 | BTC/USDT:USDT | 1h | 3600 | 0.49 | -1.99 | 241.3% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.005 | BTC/USDT:USDT | 1h | 2380 | 0.51 | -1.41 | 148.0% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.01 | BTC/USDT:USDT | 1h | 2380 | 0.51 | -1.61 | 125.6% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.005 | BTC/USDT:USDT | 1h | 1291 | 0.54 | -3.32 | 47.9% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.01 | BTC/USDT:USDT | 1h | 1291 | 0.54 | -3.37 | 43.5% | 0% | NO |
| momentum | period=10, threshold=0.03, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 1h | 778 | 0.75 | -1.24 | 62.0% | 0% | NO |
| momentum | period=10, threshold=0.05, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 1h | 240 | 0.91 | -0.23 | 19.5% | 0% | NO |
| momentum | period=20, threshold=0.03, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 1h | 788 | 0.78 | -1.21 | 70.4% | 0% | NO |
| momentum | period=20, threshold=0.05, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 1h | 326 | 0.81 | -0.63 | 28.3% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=20 | BTC/USDT:USDT | 1h | 806 | 0.86 | -0.51 | 74.5% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=25 | BTC/USDT:USDT | 1h | 705 | 0.77 | -1.20 | 81.1% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=30 | BTC/USDT:USDT | 1h | 726 | 0.69 | -0.55 | 106.0% | 0% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=2 | BTC/USDT:USDT | 4h | 255 | 0.85 | -0.28 | 33.8% | 0% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=3 | BTC/USDT:USDT | 4h | 236 | 0.80 | -0.44 | 25.2% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=2 | BTC/USDT:USDT | 4h | 378 | 0.85 | -0.20 | 36.7% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=3 | BTC/USDT:USDT | 4h | 347 | 1.05 | 0.16 | 15.7% | 284% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=2 | BTC/USDT:USDT | 4h | 175 | 1.21 | 0.41 | 14.7% | 39% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=3 | BTC/USDT:USDT | 4h | 149 | 1.03 | 0.10 | 18.3% | 269% | NO |
| mean-reversion | rsiPeriod=10, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 4h | 601 | 0.76 | -0.42 | 100.7% | 0% | NO |
| mean-reversion | rsiPeriod=10, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 4h | 202 | 0.78 | -0.55 | 48.0% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 4h | 385 | 0.73 | -0.49 | 87.4% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | BTC/USDT:USDT | 4h | 91 | 0.82 | -0.31 | 26.1% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.005 | BTC/USDT:USDT | 4h | 959 | 0.70 | -1.67 | 40.2% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.01 | BTC/USDT:USDT | 4h | 959 | 0.70 | -1.65 | 35.5% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.005 | BTC/USDT:USDT | 4h | 647 | 0.80 | -0.85 | 13.1% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.01 | BTC/USDT:USDT | 4h | 647 | 0.81 | -0.83 | 11.9% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.005 | BTC/USDT:USDT | 4h | 357 | 0.88 | -0.37 | 4.9% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.01 | BTC/USDT:USDT | 4h | 357 | 0.88 | -0.38 | 4.6% | 0% | NO |
| momentum | period=10, threshold=0.03, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 4h | 537 | 0.93 | -0.19 | 27.7% | 0% | NO |
| momentum | period=10, threshold=0.05, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 4h | 302 | 0.97 | -0.03 | 17.2% | 0% | NO |
| momentum | period=20, threshold=0.03, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 4h | 460 | 0.89 | -0.24 | 34.9% | 0% | NO |
| momentum | period=20, threshold=0.05, stopPct=0.03, timeStopBars=20 | BTC/USDT:USDT | 4h | 295 | 0.91 | -0.18 | 24.1% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=20 | BTC/USDT:USDT | 4h | 208 | 1.25 | 0.51 | 12.9% | 35% | NO |
| regime-switch | adxPeriod=14, adxThreshold=25 | BTC/USDT:USDT | 4h | 193 | 0.96 | -0.02 | 19.0% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=30 | BTC/USDT:USDT | 4h | 219 | 0.90 | -0.17 | 35.3% | 0% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=2 | ETH/USDT:USDT | 1h | 846 | 0.98 | 0.07 | 44.5% | 0% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=3 | ETH/USDT:USDT | 1h | 746 | 0.93 | -0.21 | 45.2% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=2 | ETH/USDT:USDT | 1h | 1199 | 0.96 | 0.00 | 66.3% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=3 | ETH/USDT:USDT | 1h | 1118 | 0.96 | -0.14 | 41.8% | 0% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=2 | ETH/USDT:USDT | 1h | 579 | 0.92 | -0.15 | 46.8% | 0% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=3 | ETH/USDT:USDT | 1h | 501 | 1.09 | 0.36 | 24.0% | 85% | NO |
| mean-reversion | rsiPeriod=10, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 1h | 1473 | 0.71 | 0.43 | 200.2% | 0% | NO |
| mean-reversion | rsiPeriod=10, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 1h | 467 | 0.62 | -1.14 | 110.2% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 1h | 977 | 0.70 | -0.58 | 164.9% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 1h | 212 | 0.69 | -1.17 | 46.0% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.005 | ETH/USDT:USDT | 1h | 2930 | 0.53 | -1.17 | 207.8% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.01 | ETH/USDT:USDT | 1h | 2930 | 0.53 | -1.13 | 176.8% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.005 | ETH/USDT:USDT | 1h | 1918 | 0.54 | -1.76 | 107.6% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.01 | ETH/USDT:USDT | 1h | 1918 | 0.55 | -1.92 | 94.4% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.005 | ETH/USDT:USDT | 1h | 1036 | 0.63 | -2.51 | 28.6% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.01 | ETH/USDT:USDT | 1h | 1036 | 0.63 | -2.55 | 26.7% | 0% | NO |
| momentum | period=10, threshold=0.03, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 1h | 825 | 0.96 | -0.11 | 28.8% | 0% | NO |
| momentum | period=10, threshold=0.05, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 1h | 318 | 1.02 | 0.11 | 13.6% | 381% | NO |
| momentum | period=20, threshold=0.03, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 1h | 817 | 0.83 | -0.64 | 64.1% | 0% | NO |
| momentum | period=20, threshold=0.05, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 1h | 412 | 0.87 | -0.43 | 34.1% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=20 | ETH/USDT:USDT | 1h | 656 | 0.85 | -0.33 | 68.8% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=25 | ETH/USDT:USDT | 1h | 573 | 0.87 | -0.51 | 43.8% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=30 | ETH/USDT:USDT | 1h | 598 | 0.80 | -0.88 | 55.5% | 0% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=2 | ETH/USDT:USDT | 4h | 208 | 1.25 | 0.53 | 14.4% | 40% | NO |
| trend-following | fastPeriod=10, slowPeriod=30, atrPeriod=14, atrStopMultiplier=3 | ETH/USDT:USDT | 4h | 180 | 0.95 | -0.08 | 9.6% | 0% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=2 | ETH/USDT:USDT | 4h | 292 | 1.10 | 0.31 | 11.6% | 45% | NO |
| trend-following | fastPeriod=5, slowPeriod=20, atrPeriod=14, atrStopMultiplier=3 | ETH/USDT:USDT | 4h | 272 | **1.47** | **0.92** | 8.4% | 22% | NO (más cerca — ver §4) |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=2 | ETH/USDT:USDT | 4h | 142 | 1.06 | 0.16 | 22.9% | 315% | NO |
| trend-following | fastPeriod=20, slowPeriod=50, atrPeriod=14, atrStopMultiplier=3 | ETH/USDT:USDT | 4h | 126 | 1.26 | 0.38 | 11.0% | 113% | NO |
| mean-reversion | rsiPeriod=10, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 4h | 524 | 0.75 | -0.60 | 106.1% | 0% | NO |
| mean-reversion | rsiPeriod=10, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 4h | 184 | 0.77 | -0.62 | 44.3% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=30, overbought=70, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 4h | 348 | 0.72 | -0.68 | 87.0% | 0% | NO |
| mean-reversion | rsiPeriod=14, oversold=20, overbought=80, exitMid=50, stopPct=0.02 | ETH/USDT:USDT | 4h | 81 | 0.57 | -0.77 | 39.0% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.005 | ETH/USDT:USDT | 4h | 749 | 0.85 | -0.74 | 16.1% | 0% | NO |
| breakout | lookback=10, stopBufferPct=0.01 | ETH/USDT:USDT | 4h | 749 | 0.85 | -0.72 | 14.3% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.005 | ETH/USDT:USDT | 4h | 513 | 0.97 | -0.11 | 5.1% | 0% | NO |
| breakout | lookback=20, stopBufferPct=0.01 | ETH/USDT:USDT | 4h | 513 | 0.97 | -0.11 | 4.9% | 0% | NO |
| breakout | lookback=55, stopBufferPct=0.005 | ETH/USDT:USDT | 4h | 282 | 1.20 | 0.48 | 1.3% | 52% | NO |
| breakout | lookback=55, stopBufferPct=0.01 | ETH/USDT:USDT | 4h | 282 | 1.20 | 0.46 | 1.3% | 53% | NO |
| momentum | period=10, threshold=0.03, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 4h | 525 | 1.03 | 0.18 | 18.0% | 211% | NO |
| momentum | period=10, threshold=0.05, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 4h | 316 | 1.08 | 0.28 | 15.1% | 76% | NO |
| momentum | period=20, threshold=0.03, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 4h | 433 | 0.96 | -0.05 | 26.8% | 0% | NO |
| momentum | period=20, threshold=0.05, stopPct=0.03, timeStopBars=20 | ETH/USDT:USDT | 4h | 298 | 0.98 | 0.03 | 19.2% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=20 | ETH/USDT:USDT | 4h | 162 | 1.14 | 0.32 | 12.6% | 50% | NO |
| regime-switch | adxPeriod=14, adxThreshold=25 | ETH/USDT:USDT | 4h | 159 | 0.92 | -0.15 | 18.8% | 0% | NO |
| regime-switch | adxPeriod=14, adxThreshold=30 | ETH/USDT:USDT | 4h | 172 | 0.79 | -0.61 | 29.7% | 0% | NO |

*Sharpe anualizado sin ajustar (el gate G5 usa el límite inferior del
IC bootstrap ajustado por Bonferroni, no este valor puntual — ver el
detalle por gate en el JSON crudo, `services/engine/data/backtest-results.json`,
y el apéndice de razones de fallo al final de este documento).*

## 4. El candidato más cercano (informativo, no aprobado)

**trend-following, fastPeriod=5/slowPeriod=20/atrStopMultiplier=3,
ETH/USDT:USDT, 4h**: 272 trades OOS, PF=1.47, Sharpe puntual=0.92,
maxDD=8.4%, concentración mensual=22%. Pasa G1, G2, G3, G4, G7, G8.
**Falla G5** (el límite inferior del Sharpe al 99.946% de confianza,
ajustado por las 92 variantes probadas, no llega a 0.8 — con 272
trades el intervalo es demasiado ancho) **y G6** (sus vecinos en la
grilla no están dentro de ±20%, confirmando que el resultado no es
estable frente a una perturbación pequeña del parámetro). Es
exactamente el tipo de resultado que el ajuste por pruebas múltiples
está diseñado para filtrar: el mejor de 92 intentos, no una ventaja
estadísticamente robusta.

Sensibilidad a funding (ADR-0011 §3, no es gate) para este candidato:
PnL OOS = 36,867 sin funding → 29,979 a 5bps/día → 23,091 a 10bps/día.
Sigue siendo positivo en los 3 escenarios, pero esto es irrelevante
para la decisión — no pasó los gates obligatorios.

## 5. Comparación informativa con buy-and-hold (no es gate)

| Activo | Intervalo | Retorno total | Max DD | Sharpe anualizado |
|---|---|---|---|---|
| BTC/USDT:USDT | 1h | +937.2% | 77.2% | 0.95 |
| BTC/USDT:USDT | 4h | +938.0% | 77.1% | 0.96 |
| ETH/USDT:USDT | 1h | +13.6% | 81.4% | 0.41 |
| ETH/USDT:USDT | 4h | +12.9% | 81.2% | 0.41 |

Sobre la misma ventana (inicio del primer fold WF → inicio del
holdout). Ninguna de las 92 variantes activas superó de forma robusta
ni siquiera el riesgo/retorno de simplemente mantener el activo — un
dato relevante para el contexto, no para el criterio de corte.

## 6. A4 — frozen_at

Las 92 variantes quedaron congeladas con `frozen_at = 2026-10-01T00:00:00.000Z`
y su propio `version` de estrategia (`trend-following@0.1.0`,
`mean-reversion@0.1.0`, `breakout@0.1.0`, `momentum@0.1.0`,
`regime-switch@0.1.0` — los 5 en 0.1.0, sin cambios desde la Fase 3).

## 7. Tests de no-lookahead/determinismo (gate 8 de la lista original)

Los specs por estrategia ya existentes (Fase 3, pureza/no-lookahead/
determinismo) más los nuevos de `backtest/*` (fill model, walk-forward,
métricas, bootstrap, monotonía, gates) — **todos en verde**, ver §9.

## 8. Limitaciones explícitas (no ocultas)

- **Sin piso de capital**: el backtester no replica R16/R17/R20
  (pérdida diaria, drawdown, capital cap) del RiskEngine real — varios
  `maxDrawdownPct` superan el 100% porque la equity simulada puede
  volverse negativa bajo pérdidas compuestas sin ningún freno, algo
  que el RiskEngine real evitaría en producción. No cambia la
  DECISIÓN (G3/G4/G5 ya fallan de sobra en esos casos), pero es una
  simplificación real del "mismo... espejo de riesgo" pedido — el
  backtester reutiliza el motor de estrategia/contexto/sizing
  exactos, NO una réplica completa de las 21 reglas de riesgo en vivo.
- **Costos de red/símbolo**: el modelo de costos (§3 del ADR) es
  uniforme para BTC y ETH — no se calibró por separado contra el libro
  de órdenes real de cada símbolo.
- **Holdout nunca se corrió**: ninguna combinación pasó walk-forward,
  así que el holdout (ADR-0011 §4/§10) permanece sin tocar — tal como
  pide el criterio de corte.

## 9. Salida real de tests

```
cd services/engine && pnpm run typecheck   # limpio
cd services/engine && pnpm run test        # 34/34 archivos, 168/168 tests
```

## 10. DECISIÓN

Aplicando el criterio de corte del ADR-0011 §10 mecánicamente: **0 de
92 combinaciones estrategia×activo×intervalo pasaron todos los gates
en walk-forward.** Ninguna llegó al holdout.

**DECISIÓN: DETENER la inversión en el motor.**

No se agregan estrategias fuera de la grilla pre-registrada, no se
relajan gates, no se amplía el universo, no se reinterpreta el umbral
de Sharpe ajustado. El candidato más cercano (§4) es un dato
informativo sobre dónde está el techo de esta familia de estrategias
simples sobre BTC/ETH con este modelo de costos — no una excepción al
criterio de corte.
