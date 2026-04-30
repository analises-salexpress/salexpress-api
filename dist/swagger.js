"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.swaggerSpec = void 0;
exports.swaggerSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Sal Express — API de Expansão de Clientes',
        version: '1.0.0',
        description: 'API REST para o CRM de expansão de carteira da Sal Express. ' +
            'Autentique via `/auth/login`, use o `accessToken` no header `Authorization: Bearer <token>` em todas as demais rotas.',
    },
    servers: [{ url: 'https://api-production-d892.up.railway.app', description: 'Produção (Railway)' }],
    components: {
        securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
        schemas: {
            Error: {
                type: 'object',
                properties: { error: { type: 'string' } },
            },
            User: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    role: { type: 'string', enum: ['VENDOR', 'MANAGER'] },
                    active: { type: 'boolean' },
                    createdAt: { type: 'string', format: 'date-time' },
                },
            },
            KanbanCard: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    clientId: { type: 'string' },
                    clientName: { type: 'string' },
                    status: { type: 'string', enum: ['IDENTIFIED', 'CONTACTED', 'NEGOTIATING', 'EXPANDED', 'LOST'] },
                    priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                    assignedToId: { type: 'string', nullable: true },
                    createdById: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                },
            },
            OpportunityScore: {
                type: 'object',
                properties: {
                    cnpj: { type: 'string' },
                    clientName: { type: 'string' },
                    groupedName: { type: 'string' },
                    city: { type: 'string', nullable: true },
                    state: { type: 'string', nullable: true },
                    segment: { type: 'string', nullable: true },
                    curve: { type: 'string', nullable: true },
                    baselineBilling: { type: 'number', description: 'Média mensal dos últimos 3 meses (R$)' },
                    currentBilling: { type: 'number', description: 'Faturamento do último mês completo (R$)' },
                    uncoveredRoutesCount: { type: 'integer', description: 'Rotas disponíveis que o cliente não usa' },
                    uncoveredRevenueEstimate: { type: 'number', description: 'Receita potencial nessas rotas (R$)' },
                    declineGap: { type: 'number', description: 'Gap de queda (R$) — >0 quando queda >10%' },
                    totalScore: { type: 'number', description: 'Score total usado no ranking' },
                    hasKanbanCard: { type: 'boolean' },
                },
            },
            ExpansionGoal: {
                type: 'object',
                properties: {
                    goalId: { type: 'string' },
                    clientId: { type: 'string' },
                    clientName: { type: 'string' },
                    startDate: { type: 'string', format: 'date-time' },
                    baselineAvg: { type: 'number' },
                    baselineQuarter: { type: 'number' },
                    currentQuarter: { type: 'number' },
                    delta: { type: 'number' },
                    targetValue: { type: 'number', nullable: true },
                    targetHit: { type: 'boolean' },
                },
            },
        },
    },
    security: [{ bearerAuth: [] }],
    paths: {
        '/health': {
            get: {
                tags: ['Sistema'],
                summary: 'Health check',
                security: [],
                responses: {
                    200: {
                        description: 'API online',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        version: { type: 'string', example: '1.0.0' },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                } } },
                    },
                },
            },
        },
        '/auth/login': {
            post: {
                tags: ['Auth'],
                summary: 'Login',
                security: [],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['email', 'password'],
                                properties: {
                                    email: { type: 'string', format: 'email', example: 'admin@salexpress.com.br' },
                                    password: { type: 'string', example: 'Admin@123' },
                                },
                            } } },
                },
                responses: {
                    200: {
                        description: 'Login realizado',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: {
                                        data: {
                                            type: 'object',
                                            properties: {
                                                accessToken: { type: 'string' },
                                                refreshToken: { type: 'string' },
                                                user: { $ref: '#/components/schemas/User' },
                                            },
                                        },
                                    },
                                } } },
                    },
                    401: { description: 'Credenciais inválidas', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                },
            },
        },
        '/auth/refresh': {
            post: {
                tags: ['Auth'],
                summary: 'Renovar access token',
                security: [],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['refreshToken'],
                                properties: { refreshToken: { type: 'string' } },
                            } } },
                },
                responses: {
                    200: {
                        description: 'Novo access token',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: { data: { type: 'object', properties: { accessToken: { type: 'string' } } } },
                                } } },
                    },
                    401: { description: 'Refresh token inválido' },
                },
            },
        },
        '/auth/logout': {
            post: {
                tags: ['Auth'],
                summary: 'Logout',
                requestBody: {
                    content: { 'application/json': { schema: {
                                type: 'object',
                                properties: { refreshToken: { type: 'string' } },
                            } } },
                },
                responses: {
                    200: { description: 'Logout realizado' },
                },
            },
        },
        '/users': {
            get: {
                tags: ['Usuários'],
                summary: 'Listar usuários (Manager)',
                responses: {
                    200: {
                        description: 'Lista de usuários',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: { data: { type: 'array', items: { $ref: '#/components/schemas/User' } } },
                                } } },
                    },
                },
            },
            post: {
                tags: ['Usuários'],
                summary: 'Criar usuário (Manager)',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['name', 'email', 'password'],
                                properties: {
                                    name: { type: 'string', minLength: 2 },
                                    email: { type: 'string', format: 'email' },
                                    password: { type: 'string', minLength: 8 },
                                    role: { type: 'string', enum: ['VENDOR', 'MANAGER'], default: 'VENDOR' },
                                },
                            } } },
                },
                responses: {
                    201: { description: 'Usuário criado' },
                    409: { description: 'E-mail já cadastrado' },
                },
            },
        },
        '/users/me': {
            get: {
                tags: ['Usuários'],
                summary: 'Meu perfil',
                responses: {
                    200: {
                        description: 'Dados do usuário logado',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: { data: { $ref: '#/components/schemas/User' } },
                                } } },
                    },
                },
            },
        },
        '/users/{id}': {
            put: {
                tags: ['Usuários'],
                summary: 'Atualizar usuário (Manager)',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    content: { 'application/json': { schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    active: { type: 'boolean' },
                                    role: { type: 'string', enum: ['VENDOR', 'MANAGER'] },
                                },
                            } } },
                },
                responses: { 200: { description: 'Usuário atualizado' }, 404: { description: 'Não encontrado' } },
            },
        },
        '/users/{id}/password': {
            put: {
                tags: ['Usuários'],
                summary: 'Trocar senha',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['newPassword'],
                                properties: {
                                    currentPassword: { type: 'string', description: 'Obrigatório se não for Manager' },
                                    newPassword: { type: 'string', minLength: 8 },
                                },
                            } } },
                },
                responses: { 200: { description: 'Senha alterada' }, 400: { description: 'Senha atual incorreta' } },
            },
        },
        '/clients': {
            get: {
                tags: ['Clientes (BI)'],
                summary: 'Listar clientes do cache BI',
                parameters: [
                    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Busca por nome ou CNPJ' },
                    { name: 'state', in: 'query', schema: { type: 'string' }, example: 'MG' },
                    { name: 'segment', in: 'query', schema: { type: 'string' } },
                    { name: 'curve', in: 'query', schema: { type: 'string' }, example: 'A' },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
                    { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                ],
                responses: {
                    200: {
                        description: 'Lista paginada',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: {
                                        data: { type: 'array', items: { type: 'object' } },
                                        total: { type: 'integer' },
                                        limit: { type: 'integer' },
                                        offset: { type: 'integer' },
                                    },
                                } } },
                    },
                },
            },
        },
        '/clients/{cnpj}': {
            get: {
                tags: ['Clientes (BI)'],
                summary: 'Detalhes de um cliente (histórico + rotas)',
                parameters: [{ name: 'cnpj', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    200: { description: 'Dados completos do cliente' },
                    404: { description: 'Cliente não encontrado' },
                },
            },
        },
        '/insights/opportunities': {
            get: {
                tags: ['Insights de Expansão'],
                summary: 'Ranking de oportunidades de expansão',
                description: 'Clientes ranqueados por score = receita potencial em rotas não cobertas + gap de queda de faturamento.',
                parameters: [
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
                    { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                ],
                responses: {
                    200: {
                        description: 'Ranking',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: {
                                        data: { type: 'array', items: { $ref: '#/components/schemas/OpportunityScore' } },
                                        total: { type: 'integer' },
                                        limit: { type: 'integer' },
                                        offset: { type: 'integer' },
                                    },
                                } } },
                    },
                },
            },
        },
        '/insights/client/{cnpj}': {
            get: {
                tags: ['Insights de Expansão'],
                summary: 'Análise detalhada de um cliente',
                parameters: [{ name: 'cnpj', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    200: { description: 'Baseline, rotas cobertas, rotas não cobertas, histórico mensal' },
                    404: { description: 'Cliente não encontrado' },
                },
            },
        },
        '/kanban/cards': {
            get: {
                tags: ['Kanban / CRM'],
                summary: 'Listar cards',
                description: 'Vendor vê somente seus próprios cards. Manager vê todos.',
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string', enum: ['IDENTIFIED', 'CONTACTED', 'NEGOTIATING', 'EXPANDED', 'LOST'] } },
                    { name: 'assignedToId', in: 'query', schema: { type: 'string' } },
                    { name: 'clientId', in: 'query', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                    { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                ],
                responses: {
                    200: {
                        description: 'Cards paginados',
                        content: { 'application/json': { schema: {
                                    type: 'object',
                                    properties: {
                                        data: { type: 'array', items: { $ref: '#/components/schemas/KanbanCard' } },
                                        total: { type: 'integer' },
                                    },
                                } } },
                    },
                },
            },
            post: {
                tags: ['Kanban / CRM'],
                summary: 'Criar card',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['clientId', 'clientName'],
                                properties: {
                                    clientId: { type: 'string', description: 'CNPJ do cliente' },
                                    clientName: { type: 'string' },
                                    status: { type: 'string', enum: ['IDENTIFIED', 'CONTACTED', 'NEGOTIATING', 'EXPANDED', 'LOST'], default: 'IDENTIFIED' },
                                    priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' },
                                    assignedToId: { type: 'string', description: 'Padrão: usuário logado' },
                                },
                            } } },
                },
                responses: { 201: { description: 'Card criado' } },
            },
        },
        '/kanban/cards/{id}': {
            put: {
                tags: ['Kanban / CRM'],
                summary: 'Atualizar / mover card',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    content: { 'application/json': { schema: {
                                type: 'object',
                                properties: {
                                    status: { type: 'string', enum: ['IDENTIFIED', 'CONTACTED', 'NEGOTIATING', 'EXPANDED', 'LOST'] },
                                    priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                                    assignedToId: { type: 'string', nullable: true },
                                    clientName: { type: 'string' },
                                },
                            } } },
                },
                responses: { 200: { description: 'Card atualizado' }, 403: { description: 'Sem permissão' }, 404: { description: 'Não encontrado' } },
            },
            delete: {
                tags: ['Kanban / CRM'],
                summary: 'Deletar card (Manager)',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 204: { description: 'Deletado' }, 404: { description: 'Não encontrado' } },
            },
        },
        '/kanban/cards/{id}/notes': {
            get: {
                tags: ['Kanban / CRM'],
                summary: 'Listar notas de um card',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Lista de notas' } },
            },
            post: {
                tags: ['Kanban / CRM'],
                summary: 'Adicionar nota a um card',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['content'],
                                properties: { content: { type: 'string', minLength: 1 } },
                            } } },
                },
                responses: { 201: { description: 'Nota criada' }, 404: { description: 'Card não encontrado' } },
            },
        },
        '/kanban/notes/{noteId}': {
            delete: {
                tags: ['Kanban / CRM'],
                summary: 'Deletar nota',
                parameters: [{ name: 'noteId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 204: { description: 'Deletada' }, 403: { description: 'Sem permissão' } },
            },
        },
        '/kanban/cards/{id}/activities': {
            get: {
                tags: ['Kanban / CRM'],
                summary: 'Histórico de atividades de um card',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Lista de atividades' } },
            },
        },
        '/metrics/expansion': {
            get: {
                tags: ['Métricas'],
                summary: 'Todas as metas de expansão ativas com delta atual',
                description: 'Vendor vê somente suas metas. Manager vê todas.',
                responses: {
                    200: {
                        description: 'Lista de metas com delta',
                        content: { 'application/json': { schema: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/ExpansionGoal' },
                                } } },
                    },
                },
            },
        },
        '/metrics/vendor/{vendorId}': {
            get: {
                tags: ['Métricas'],
                summary: 'Performance de um vendedor (Manager)',
                parameters: [{ name: 'vendorId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Métricas do vendedor' }, 404: { description: 'Vendedor não encontrado' } },
            },
        },
        '/metrics/summary': {
            get: {
                tags: ['Métricas'],
                summary: 'Resumo geral (Manager)',
                description: 'Totais: cards, metas, delta de expansão, breakdown por vendedor.',
                responses: { 200: { description: 'Resumo' } },
            },
        },
        '/metrics/goals': {
            post: {
                tags: ['Métricas'],
                summary: 'Cadastrar meta de expansão',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['clientId', 'startDate', 'baselineAvg'],
                                properties: {
                                    clientId: { type: 'string', description: 'CNPJ do cliente' },
                                    cardId: { type: 'string', description: 'Kanban card vinculado (opcional)' },
                                    startDate: { type: 'string', format: 'date-time' },
                                    baselineAvg: { type: 'number', description: 'Média mensal de faturamento antes da expansão (R$)' },
                                    targetValue: { type: 'number', description: 'Meta de incremento em R$ (opcional)' },
                                },
                            } } },
                },
                responses: { 201: { description: 'Meta criada' } },
            },
        },
        '/metrics/goals/{id}/status': {
            put: {
                tags: ['Métricas'],
                summary: 'Atualizar status de uma meta',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['status'],
                                properties: { status: { type: 'string', enum: ['ACTIVE', 'ACHIEVED', 'CANCELLED'] } },
                            } } },
                },
                responses: { 200: { description: 'Meta atualizada' }, 403: { description: 'Sem permissão' }, 404: { description: 'Meta não encontrada' } },
            },
        },
        '/messages': {
            get: {
                tags: ['Mensagens'],
                summary: 'Listar conversas',
                responses: { 200: { description: 'Lista de conversas com última mensagem e contagem de não lidas' } },
            },
            post: {
                tags: ['Mensagens'],
                summary: 'Enviar mensagem',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                                type: 'object',
                                required: ['receiverId', 'content'],
                                properties: {
                                    receiverId: { type: 'string' },
                                    content: { type: 'string', minLength: 1 },
                                },
                            } } },
                },
                responses: { 201: { description: 'Mensagem enviada' } },
            },
        },
        '/messages/{userId}': {
            get: {
                tags: ['Mensagens'],
                summary: 'Histórico com um usuário',
                parameters: [
                    { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                    { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                ],
                responses: { 200: { description: 'Histórico (mensagens marcadas como lidas automaticamente)' } },
            },
        },
        '/messages/{id}/read': {
            put: {
                tags: ['Mensagens'],
                summary: 'Marcar mensagem como lida',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Marcada como lida' } },
            },
        },
        '/files/upload': {
            post: {
                tags: ['Arquivos'],
                summary: 'Upload de arquivo (máx 20 MB)',
                requestBody: {
                    required: true,
                    content: { 'multipart/form-data': { schema: {
                                type: 'object',
                                required: ['file'],
                                properties: {
                                    file: { type: 'string', format: 'binary' },
                                    clientId: { type: 'string', description: 'CNPJ (opcional)' },
                                    cardId: { type: 'string', description: 'ID do card (opcional)' },
                                },
                            } } },
                },
                responses: { 201: { description: 'Arquivo salvo no Supabase Storage' }, 500: { description: 'Erro no upload' } },
            },
        },
        '/files/client/{clientId}': {
            get: {
                tags: ['Arquivos'],
                summary: 'Arquivos de um cliente',
                parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Lista de arquivos' } },
            },
        },
        '/files/card/{cardId}': {
            get: {
                tags: ['Arquivos'],
                summary: 'Arquivos de um card',
                parameters: [{ name: 'cardId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Lista de arquivos' } },
            },
        },
        '/files/{id}': {
            delete: {
                tags: ['Arquivos'],
                summary: 'Deletar arquivo',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 204: { description: 'Deletado do Storage e do banco' }, 403: { description: 'Sem permissão' }, 404: { description: 'Não encontrado' } },
            },
        },
        '/reports/expansion/export': {
            get: {
                tags: ['Relatórios'],
                summary: 'Exportar expansão em andamento (.xlsx)',
                responses: {
                    200: {
                        description: 'Download do arquivo Excel',
                        content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } },
                    },
                },
            },
        },
        '/reports/opportunities/export': {
            get: {
                tags: ['Relatórios'],
                summary: 'Exportar ranking de oportunidades (.xlsx) — Manager',
                responses: {
                    200: {
                        description: 'Download do arquivo Excel',
                        content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } },
                    },
                },
            },
        },
    },
};
//# sourceMappingURL=swagger.js.map