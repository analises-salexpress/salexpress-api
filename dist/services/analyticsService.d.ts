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
    deliveryCity: string;
    deliveryState: string;
    firstSeen: Date;
    lastSeen: Date;
    tripCount: number;
}[]>;
export declare function getAllRoutes(): Promise<{
    id: number;
    syncedAt: Date;
    deliveryCity: string;
    deliveryState: string;
    tripCount: number;
    avgRevenue: number;
}[]>;
export declare function getUncoveredRoutes(clientCnpj: string): Promise<{
    id: number;
    syncedAt: Date;
    deliveryCity: string;
    deliveryState: string;
    tripCount: number;
    avgRevenue: number;
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
        syncedAt: Date;
        state: string | null;
        segment: string | null;
        curve: string | null;
        cnpj: string;
        groupedName: string;
        city: string | null;
        tipo: string | null;
    }[];
    total: number;
}>;
export declare function getClientById(cnpj: string): Promise<{
    name: string;
    syncedAt: Date;
    state: string | null;
    segment: string | null;
    curve: string | null;
    cnpj: string;
    groupedName: string;
    city: string | null;
    tipo: string | null;
} | null>;
