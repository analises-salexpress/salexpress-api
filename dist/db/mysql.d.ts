import mysql from 'mysql2/promise';
export declare const biPool: mysql.Pool;
export declare function queryBI<T = unknown>(sql: string, params?: (string | number | boolean | null)[]): Promise<T[]>;
