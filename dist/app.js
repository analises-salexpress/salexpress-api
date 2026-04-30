"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const insights_1 = __importDefault(require("./routes/insights"));
const clients_1 = __importDefault(require("./routes/clients"));
const kanban_1 = __importDefault(require("./routes/kanban"));
const metrics_1 = __importDefault(require("./routes/metrics"));
const files_1 = __importDefault(require("./routes/files"));
const messages_1 = __importDefault(require("./routes/messages"));
const reports_1 = __importDefault(require("./routes/reports"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});
app.use('/auth', auth_1.default);
app.use('/users', users_1.default);
app.use('/insights', insights_1.default);
app.use('/clients', clients_1.default);
app.use('/kanban', kanban_1.default);
app.use('/metrics', metrics_1.default);
app.use('/files', files_1.default);
app.use('/messages', messages_1.default);
app.use('/reports', reports_1.default);
app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});
// Global error handler — catches unhandled throws from async routes
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});
exports.default = app;
//# sourceMappingURL=app.js.map