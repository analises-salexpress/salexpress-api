"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
function buildUrl(url) {
    if (!url)
        return url;
    if (url.includes('pgbouncer=true'))
        return url;
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'pgbouncer=true&connection_limit=5';
}
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ?? new client_1.PrismaClient({
    datasources: {
        db: { url: buildUrl(process.env.APP_DATABASE_URL) },
    },
});
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.prisma;
}
//# sourceMappingURL=prisma.js.map