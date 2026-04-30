"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.biPool = void 0;
exports.queryBI = queryBI;
const promise_1 = __importDefault(require("mysql2/promise"));
exports.biPool = promise_1.default.createPool({
    host: process.env.BI_DB_HOST,
    port: Number(process.env.BI_DB_PORT) || 3306,
    user: process.env.BI_DB_USER,
    password: process.env.BI_DB_PASSWORD,
    database: process.env.BI_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});
async function queryBI(sql, params) {
    const [rows] = await exports.biPool.execute(sql, params);
    return rows;
}
//# sourceMappingURL=mysql.js.map