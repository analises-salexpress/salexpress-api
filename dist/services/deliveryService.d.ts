export interface ExpansionWeekData {
    year: number;
    week: number;
    weekLabel: string;
    totalNotas: number;
    valorMercadoria: number;
    valorFrete: number;
    pctNota: number | null;
}
export interface ExpansionMonthData {
    year: number;
    month: number;
    monthLabel: string;
    totalNotas: number;
    valorMercadoria: number;
    valorFrete: number;
    pctNota: number | null;
    isCurrentMonth: boolean;
}
export interface FilialPerformance {
    filial: string;
    cidade: string | null;
    totalEntregas: number;
    noPrazo: number;
    foraPrazo: number;
    pendente: number;
    performancePct: number | null;
    semaforo: 'green' | 'yellow' | 'red' | 'critical' | 'no_data';
}
export interface WeeklyPerformance {
    year: number;
    week: number;
    weekLabel: string;
    totalEntregas: number;
    noPrazo: number;
    performancePct: number | null;
    semaforo: 'green' | 'yellow' | 'red' | 'critical' | 'no_data';
}
export interface MonthlyPerformance {
    year: number;
    month: number;
    monthLabel: string;
    totalEntregas: number;
    noPrazo: number;
    foraPrazo: number;
    pendente: number;
    performancePct: number | null;
    semaforo: 'green' | 'yellow' | 'red' | 'critical' | 'no_data';
    isCurrentMonth: boolean;
}
export declare function getDeliveryPerformanceBatch(cnpjs: string[], _days?: number): Promise<Record<string, {
    performancePct: number | null;
    semaforo: FilialPerformance['semaforo'];
}>>;
export declare function getDeliveryPerformanceByFilial(cnpjs: string[], _days?: number): Promise<FilialPerformance[]>;
export declare function getDeliveryPerformanceWeekly(cnpjs: string[], weeks?: number): Promise<WeeklyPerformance[]>;
export declare function getDeliveryPerformanceMonthly(cnpjs: string[], months?: number): Promise<MonthlyPerformance[]>;
export declare function getExpansionPresentationWeekly(cnpjs: string[], startDate: Date): Promise<ExpansionWeekData[]>;
export declare function getExpansionPresentationMonthly(cnpjs: string[], startDate: Date): Promise<ExpansionMonthData[]>;
