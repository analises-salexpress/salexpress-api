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
    uncoveredRevenueEstimate: number;
    declineGap: number;
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
    uncoveredRevenueEstimate: number;
    coveredRoutes: {
        id: number;
        clientCnpj: string;
        syncedAt: Date;
        deliveryCity: string;
        deliveryState: string;
        firstSeen: Date;
        lastSeen: Date;
        tripCount: number;
    }[];
    uncoveredRoutes: {
        id: number;
        syncedAt: Date;
        deliveryCity: string;
        deliveryState: string;
        tripCount: number;
        avgRevenue: number;
    }[];
    monthlyHistory: {
        year: number;
        month: number;
        billing: number;
    }[];
}>;
export declare function calcNrr(cnpj: string): Promise<number | null>;
