export declare function toolGetOverview({ months_back }: {
    months_back?: number;
}): Promise<{
    periodDescription: string;
    totalBilling: number;
    activeClientCount: number;
    totalCTRC: number;
    monthlyTrend: {
        period: string;
        totalBilling: number;
        activeClients: number;
        totalCTRC: number;
        avgTicket: number;
    }[];
    bySegment: {
        segment: string;
        totalBilling: number;
        clientCount: number;
        avgPerClient: number;
    }[];
    byState: {
        state: string;
        totalBilling: number;
        clientCount: number;
    }[];
    byCurve: {
        curve: string;
        totalBilling: number;
        clientCount: number;
    }[];
    topRoutes: {
        region: string;
        totalRevenue: number;
        avgTicket: number;
        tripCount: number;
        clientCount: number;
    }[];
}>;
export declare function toolGetTopClients({ limit, months_back, segment, state, curve, }: {
    limit?: number;
    months_back?: number;
    segment?: string;
    state?: string;
    curve?: string;
}): Promise<{
    period: string;
    clients: {
        cnpj: string;
        name: string;
        state: string | null;
        city: string | null;
        segment: string | null;
        curve: string | null;
        totalBilling: number;
        avgMonthlyBilling: number;
        totalCTRC: number;
        avgTicketPerCTRC: number;
    }[];
}>;
export declare function toolGetClientDetail({ cnpj, name }: {
    cnpj?: string;
    name?: string;
}): Promise<{
    error: string;
    client?: undefined;
    billingHistory?: undefined;
    trend?: undefined;
    routes?: undefined;
    recentWeeks?: undefined;
} | {
    client: {
        cnpj: string;
        name: string;
        groupedName: string;
        city: string | null;
        state: string | null;
        segment: string | null;
        curve: string | null;
        tipo: string | null;
    };
    billingHistory: {
        period: string;
        billing: number;
        ctrc: number;
        volumes: number;
        weightKg: number;
        avgTicket: number;
    }[];
    trend: {
        avgLast3Months: number;
        avgPrev3Months: number;
        changePercent: number | null;
        classification: string;
    };
    routes: {
        region: string;
        totalRevenue: number;
        recentMonthlyAvg: number;
        tripCountLastMonth: number;
        firstSeen: Date;
        lastSeen: Date;
    }[];
    recentWeeks: {
        period: string;
        billing: number;
        ctrc: number;
    }[];
    error?: undefined;
}>;
export declare function toolGetChurnRisk({ threshold_pct, limit, }: {
    threshold_pct?: number;
    limit?: number;
}): Promise<{
    threshold: string;
    totalClientsAtRisk: number;
    clients: {
        cnpj: string;
        name: string;
        state: string | null;
        segment: string | null;
        curve: string | null;
        avgLast3Months: number;
        avgPrev3Months: number;
        changePercent: number;
        lossMonthly: number;
    }[];
}>;
export declare function toolGetGrowthClients({ limit }: {
    limit?: number;
}): Promise<{
    totalGrowingClients: number;
    clients: {
        cnpj: string;
        name: string;
        state: string | null;
        segment: string | null;
        curve: string | null;
        avgLast3Months: number;
        avgPrev3Months: number;
        changePercent: number;
        growthMonthly: number;
    }[];
}>;
export declare function toolGetRouteAnalysis(): Promise<{
    routes: {
        region: string;
        totalRevenue: number;
        avgTicket: number;
        totalCTRC: number;
        clientCount: number;
        activeClientsNow: number;
    }[];
}>;
export declare function toolSearchClients({ query, limit }: {
    query: string;
    limit?: number;
}): Promise<{
    count: number;
    clients: {
        name: string;
        state: string | null;
        segment: string | null;
        curve: string | null;
        cnpj: string;
        groupedName: string;
        city: string | null;
    }[];
}>;
