import { Request } from 'express';
import { Role } from '@prisma/client';
export interface JWTPayload {
    userId: string;
    email: string;
    role: Role;
}
export interface AuthenticatedRequest extends Request {
    user?: JWTPayload;
}
export interface ApiResponse<T = unknown> {
    data?: T;
    message?: string;
    error?: string;
}
export interface PaginationQuery {
    page?: string;
    limit?: string;
}
export declare function paginate(page?: number, limit?: number): {
    take: number;
    skip: number;
};
