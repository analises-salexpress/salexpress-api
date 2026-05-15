export declare function getClientMonthly(clientCnpj: string): Promise<{
    id: number;
    year: number;
    clientCnpj: string;
    clientGrouped: string;
    month: number;
    billing: number;
    deliveriesCount: number;
    volumesCount: number;
    totalWeightKg: number;
    syncedAt: Date;
}[]>;
export declare function getClientRecentMonths(clientCnpj: string, months: number): Promise<{
    id: number;
    year: number;
    clientCnpj: string;
    clientGrouped: string;
    month: number;
    billing: number;
    deliveriesCount: number;
    volumesCount: number;
    totalWeightKg: number;
    syncedAt: Date;
}[]>;
export declare function getClientRoutes(clientCnpj: string): Promise<{
    id: number;
    clientCnpj: string;
    syncedAt: Date;
    region: string;
    firstSeen: Date;
    lastSeen: Date;
    tripCount: number;
    totalRevenue: number;
    recentMonthlyAvg: number;
}[]>;
export declare function getAllRoutes(): Promise<{
    id: number;
    syncedAt: Date;
    region: string;
    tripCount: number;
    totalRevenue: number;
    avgRevenue: number;
    clientCount: number;
}[]>;
export declare function getUncoveredRoutes(clientCnpj: string): Promise<{
    id: number;
    syncedAt: Date;
    region: string;
    tripCount: number;
    totalRevenue: number;
    avgRevenue: number;
    clientCount: number;
}[]>;
export declare function getClients(opts: {
    search?: string;
    state?: string;
    segment?: string;
    curve?: string;
    limit?: number;
    offset?: number;
}): Promise<{
    clients: {
        name: string;
        state: string | null;
        segment: string | null;
        curve: string | null;
        cnpj: string;
        syncedAt: Date;
        groupedName: string;
        city: string | null;
        tipo: string | null;
    }[];
    total: number;
}>;
export declare function getClientById(cnpj: string): Promise<{
    name: string;
    state: string | null;
    segment: string | null;
    curve: string | null;
    cnpj: string;
    syncedAt: Date;
    groupedName: string;
    city: string | null;
    tipo: string | null;
} | null>;
export declare function aggregateMonthlyHistory(cnpjs: string[]): Promise<{
    year: number;
    month: number;
    billing: number;
}[]>;
export declare function aggregateRecentBilling(cnpjs: string[], months: number): Promise<{
    year: number;
    month: number;
    billing: number;
}[]>;
export declare function aggregateCurrentMonth(cnpjs: string[]): Promise<number>;
export declare function aggregateCurrentMonthFromDaily(cnpjs: string[]): Promise<number>;
export declare function aggregateWeeklyBilling(cnpjs: string[]): Promise<{
    year: number;
    week: number;
    billing: number;
}[]>;
export declare function getCardCnpjs(primaryCnpj: string, cardId: string | null): Promise<string[]>;
