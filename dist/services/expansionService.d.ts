export interface OpportunityScore {
    cnpj: string;
    clientName: string;
    groupedName: string;
    city: string | null;
    state: string | null;
    segment: string | null;
    curve: string | null;
    baselineBilling: number;
    currentBilling: number;
    uncoveredRoutesCount: number;
    partiallyCoveredRoutesCount: number;
    uncoveredRevenueEstimate: number;
    totalScore: number;
    hasKanbanCard: boolean;
    kanbanCard: {
        id: string;
        status: string;
        priority: string;
        assignedToId: string | null;
    } | null;
    manualExpansionPotential: number | null;
    expansionRegions: string[];
}
export declare function getOpportunities(limit?: number, offset?: number, filterRegion?: string, filterSegment?: string, filterCity?: string, tab?: 'new' | 'in_progress'): Promise<{
    opportunities: OpportunityScore[];
    total: number;
}>;
export declare function getInProgressOpportunities(limit?: number, offset?: number): Promise<{
    opportunities: OpportunityScore[];
    total: number;
}>;
export declare function getClientExpansionDetail(cnpj: string): Promise<{
    baseline: number;
    currentBilling: number;
    declineGap: number;
    uncoveredRoutesCount: number;
    partiallyCoveredRoutesCount: number;
    expansionPotential: number;
    manualExpansionPotential: number | null;
    kanbanCardId: string | null;
    coveredRoutes: {
        region: string;
        tripCount: number;
        recentMonthlyAvg: number;
        revenueShare: number;
    }[];
    partiallyCoveredRoutes: {
        region: string;
        tripCount: number;
        recentMonthlyAvg: number;
        revenueShare: number;
        expansionPotential: number;
    }[];
    uncoveredRoutes: {
        region: string;
        tripCount: number;
        expansionPotential: number;
    }[];
    monthlyHistory: {
        year: number;
        month: number;
        billing: number;
    }[];
}>;
export declare function calcNrr(cnpj: string): Promise<number | null>;
export interface ChurnEntry {
    cnpj: string;
    clientName: string;
    groupedName: string;
    city: string | null;
    state: string | null;
    segment: string | null;
    baselineBilling: number;
    lastMonthBilling: number;
    dropAmount: number;
    dropPercent: number;
    churnType: 'CHURN' | 'POSSIVEL_CHURN';
    weeklyTrend: number[];
    hasKanbanCard: boolean;
}
export declare function getChurnAnalysis(limit?: number, offset?: number, filterSegment?: string, filterCity?: string, filterType?: 'CHURN' | 'POSSIVEL_CHURN'): Promise<{
    churns: ChurnEntry[];
    total: number;
}>;
