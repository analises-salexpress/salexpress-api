import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
export declare function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void;
