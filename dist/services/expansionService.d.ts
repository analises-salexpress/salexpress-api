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
}
export declare function getOpportunities(limit?: number, offset?: number): Promise<{
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
    coveredRoutes: {
        region: string;
        tripCount: number;
        totalRevenue: number;
        revenueShare: number;
    }[];
    partiallyCoveredRoutes: {
        region: string;
        tripCount: number;
        totalRevenue: number;
        revenueShare: number;
        expansionPotential: number;
    }[];
    uncoveredRoutes: {
        region: string;
        expansionPotential: number;
    }[];
    monthlyHistory: {
        year: number;
        month: number;
        billing: number;
    }[];
}>;
export declare function calcNrr(cnpj: string): Promise<number | null>;
