export declare function login(email: string, password: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: {
        id: string;
        name: string;
        email: string;
        role: import(".prisma/client").$Enums.Role;
    };
}>;
export declare function refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
}>;
export declare function logout(refreshToken: string): Promise<void>;
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(hash: string, password: string): Promise<boolean>;
