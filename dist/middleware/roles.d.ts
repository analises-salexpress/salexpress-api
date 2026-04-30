import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../types';
export declare function requireRole(...roles: Role[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
