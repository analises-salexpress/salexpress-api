"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryBI = queryBI;
const promise_1 = __importDefault(require("mysql2/promise"));
function biConfig() {
    return {
        host: process.env.BI_DB_HOST,
        port: Number(process.env.BI_DB_PORT ?? 3306),
        user: process.env.BI_DB_USER,
        password: process.env.BI_DB_PASSWORD,
        database: process.env.BI_DB_NAME ?? 'bexsal_dw',
        timezone: '-03:00',
    };
}
async function queryBI(sql, params) {
    const conn = await promise_1.default.createConnection(biConfig());
    try {
        const [rows] = await conn.query(sql, params);
        return rows;
    }
    finally {
        await conn.end();
    }
}
//# sourceMappingURL=mysql.js.map