"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = __importDefault(require("./app"));
const required = ['JWT_SECRET', 'APP_DATABASE_URL'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
    console.error(`Variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}`);
    console.error('Copie .env.example para .env e preencha os valores.');
    process.exit(1);
}
const PORT = Number(process.env.PORT) || 3000;
app_1.default.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
//# sourceMappingURL=server.js.map