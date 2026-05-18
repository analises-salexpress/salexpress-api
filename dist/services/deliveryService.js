"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeliveryPerformanceByFilial = getDeliveryPerformanceByFilial;
exports.getDeliveryPerformanceWeekly = getDeliveryPerformanceWeekly;
exports.getDeliveryPerformanceMonthly = getDeliveryPerformanceMonthly;
exports.getDeliveryPerformanceBatch = getDeliveryPerformanceBatch;
exports.getExpansionPresentationWeekly = getExpansionPresentationWeekly;
exports.getExpansionPresentationMonthly = getExpansionPresentationMonthly;
const mysql_1 = require("../db/mysql");
const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function semaforo(pct) {
    if (pct === null)
        return 'no_data';
    if (pct >= 95)
        return 'green';
    if (pct >= 90)
        return 'yellow';
    if (pct >= 85)
        return 'red';
    return 'critical';
}
function buildInClause(cnpjs) {
    return {
        placeholders: cnpjs.map(() => '?').join(', '),
        params: cnpjs,
    };
}
async function getDeliveryPerformanceByFilial(cnpjs, days = 30) {
    const { placeholders, params } = buildInClause(cnpjs);
    const rows = await (0, mysql_1.queryBI)(`
    SELECT
      db.emissor_resumido                                                                      AS filial,
      MAX(db.cidade)                                                                           AS cidade,
      COUNT(*)                                                                                 AS total_entregas,
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)        AS no_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada > fn.previsao_entrega THEN 1 ELSE 0 END)        AS fora_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada IS NULL
               AND fn.tipo_baixa NOT IN ('CANCELADO') THEN 1 ELSE 0 END)                      AS pendente,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY db.emissor_resumido
    ORDER BY total_entregas DESC
  `, [...params, days]);
    return rows.map((r) => ({
        filial: r.filial,
        cidade: r.cidade,
        totalEntregas: Number(r.total_entregas),
        noPrazo: Number(r.no_prazo),
        foraPrazo: Number(r.fora_prazo),
        pendente: Number(r.pendente),
        performancePct: r.performance_pct !== null ? Number(r.performance_pct) : null,
        semaforo: semaforo(r.performance_pct !== null ? Number(r.performance_pct) : null),
    }));
}
async function getDeliveryPerformanceWeekly(cnpjs, weeks = 12) {
    const { placeholders, params } = buildInClause(cnpjs);
    const rows = await (0, mysql_1.queryBI)(`
    SELECT
      YEAR(fn.data_emissao)                                                                    AS year,
      WEEK(fn.data_emissao, 3)                                                                 AS week,
      COUNT(*)                                                                                 AS total_entregas,
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)        AS no_prazo,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? WEEK)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY YEAR(fn.data_emissao), WEEK(fn.data_emissao, 3)
    ORDER BY year, week
  `, [...params, weeks]);
    return rows.map((r) => ({
        year: Number(r.year),
        week: Number(r.week),
        weekLabel: `S${String(r.week).padStart(2, '0')}/${r.year}`,
        totalEntregas: Number(r.total_entregas),
        noPrazo: Number(r.no_prazo),
        performancePct: r.performance_pct !== null ? Number(r.performance_pct) : null,
        semaforo: semaforo(r.performance_pct !== null ? Number(r.performance_pct) : null),
    }));
}
async function getDeliveryPerformanceMonthly(cnpjs, months = 3) {
    const { placeholders, params } = buildInClause(cnpjs);
    const now = new Date();
    const rows = await (0, mysql_1.queryBI)(`
    SELECT
      YEAR(fn.data_emissao)                                                                    AS year,
      MONTH(fn.data_emissao)                                                                   AS month,
      COUNT(*)                                                                                 AS total_entregas,
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)        AS no_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada > fn.previsao_entrega THEN 1 ELSE 0 END)        AS fora_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada IS NULL
               AND fn.tipo_baixa NOT IN ('CANCELADO') THEN 1 ELSE 0 END)                      AS pendente,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY YEAR(fn.data_emissao), MONTH(fn.data_emissao)
    ORDER BY year, month
  `, [...params, months]);
    return rows.map((r) => {
        const y = Number(r.year);
        const m = Number(r.month);
        return {
            year: y,
            month: m,
            monthLabel: `${MONTH_NAMES[m - 1]}/${y}`,
            totalEntregas: Number(r.total_entregas),
            noPrazo: Number(r.no_prazo),
            foraPrazo: Number(r.fora_prazo),
            pendente: Number(r.pendente),
            performancePct: r.performance_pct !== null ? Number(r.performance_pct) : null,
            semaforo: semaforo(r.performance_pct !== null ? Number(r.performance_pct) : null),
            isCurrentMonth: y === now.getFullYear() && m === now.getMonth() + 1,
        };
    });
}
async function getDeliveryPerformanceBatch(cnpjs, days = 30) {
    if (cnpjs.length === 0)
        return {};
    const placeholders = cnpjs.map(() => '?').join(', ');
    const rows = await (0, mysql_1.queryBI)(`
    SELECT
      fn.cnpj_pagador                                                                          AS cnpj,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY fn.cnpj_pagador
  `, [...cnpjs, days]);
    const result = {};
    for (const r of rows) {
        const pct = r.performance_pct !== null ? Number(r.performance_pct) : null;
        result[r.cnpj] = { performancePct: pct, semaforo: semaforo(pct) };
    }
    return result;
}
async function getExpansionPresentationWeekly(cnpjs, startDate) {
    if (cnpjs.length === 0)
        return [];
    const { placeholders, params } = buildInClause(cnpjs);
    const startStr = startDate.toISOString().slice(0, 10);
    const rows = await (0, mysql_1.queryBI)(`
    SELECT
      YEAR(fn.data_emissao)                                               AS year,
      WEEK(fn.data_emissao, 3)                                            AS week,
      COUNT(*)                                                            AS total_notas,
      ROUND(SUM(fn.valor_mercadoria), 2)                                  AS valor_mercadoria,
      ROUND(SUM(fn.valor_frete), 2)                                       AS valor_frete,
      ROUND(
        SUM(fn.valor_frete) / NULLIF(SUM(fn.valor_mercadoria), 0) * 100, 4
      )                                                                   AS pct_nota
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.data_emissao >= ?
    GROUP BY YEAR(fn.data_emissao), WEEK(fn.data_emissao, 3)
    ORDER BY year, week
  `, [...params, startStr]);
    return rows.map((r) => ({
        year: Number(r.year),
        week: Number(r.week),
        weekLabel: `S${String(r.week).padStart(2, '0')}/${r.year}`,
        totalNotas: Number(r.total_notas),
        valorMercadoria: Number(r.valor_mercadoria),
        valorFrete: Number(r.valor_frete),
        pctNota: r.pct_nota !== null ? Number(r.pct_nota) : null,
    }));
}
async function getExpansionPresentationMonthly(cnpjs, startDate) {
    if (cnpjs.length === 0)
        return [];
    const { placeholders, params } = buildInClause(cnpjs);
    const now = new Date();
    const startStr = startDate.toISOString().slice(0, 10);
    const rows = await (0, mysql_1.queryBI)(`
    SELECT
      YEAR(fn.data_emissao)                                               AS year,
      MONTH(fn.data_emissao)                                              AS month,
      COUNT(*)                                                            AS total_notas,
      ROUND(SUM(fn.valor_mercadoria), 2)                                  AS valor_mercadoria,
      ROUND(SUM(fn.valor_frete), 2)                                       AS valor_frete,
      ROUND(
        SUM(fn.valor_frete) / NULLIF(SUM(fn.valor_mercadoria), 0) * 100, 4
      )                                                                   AS pct_nota
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.data_emissao >= ?
    GROUP BY YEAR(fn.data_emissao), MONTH(fn.data_emissao)
    ORDER BY year, month
  `, [...params, startStr]);
    return rows.map((r) => {
        const y = Number(r.year);
        const m = Number(r.month);
        return {
            year: y,
            month: m,
            monthLabel: `${MONTH_NAMES[m - 1]}/${y}`,
            totalNotas: Number(r.total_notas),
            valorMercadoria: Number(r.valor_mercadoria),
            valorFrete: Number(r.valor_frete),
            pctNota: r.pct_nota !== null ? Number(r.pct_nota) : null,
            isCurrentMonth: y === now.getFullYear() && m === now.getMonth() + 1,
        };
    });
}
//# sourceMappingURL=deliveryService.js.map