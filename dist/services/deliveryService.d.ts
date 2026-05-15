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
export declare function getDeliveryPerformanceByFilial(cnpjs: string[], days?: number): Promise<FilialPerformance[]>;
export declare function getDeliveryPerformanceWeekly(cnpjs: string[], weeks?: number): Promise<WeeklyPerformance[]>;
export declare function getDeliveryPerformanceMonthly(cnpjs: string[], months?: number): Promise<MonthlyPerformance[]>;
export declare function getDeliveryPerformanceBatch(cnpjs: string[], days?: number): Promise<Record<string, {
    performancePct: number | null;
    semaforo: FilialPerformance['semaforo'];
}>>;
