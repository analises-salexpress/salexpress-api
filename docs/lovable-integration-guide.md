# Guia de Integração — Lovable ↔ API Sal Express

> Versão 1.0 · Gerado automaticamente

## URL Base

```
https://api-production-d892.up.railway.app
```

Configure essa URL nas variáveis de ambiente do seu projeto Lovable como `VITE_API_BASE_URL`.

> A documentação interativa Swagger está disponível em:
> `https://api-production-d892.up.railway.app/docs`

---

## Autenticação

Todas as rotas (exceto `/auth/login`) exigem o header:

```
Authorization: Bearer <access_token>
```

O access token expira em **8 horas**. Use o refresh token (válido por 7 dias) para renovar automaticamente.

---

## Referência Rápida de Endpoints

### Auth

#### Login
```
POST /auth/login
Content-Type: application/json

{ "email": "user@salexpress.com.br", "password": "senha" }
```
Resposta:
```json
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { "id": "...", "name": "...", "email": "...", "role": "VENDOR" }
  }
```

#### Renovar token
```
POST /auth/refresh
{ "refreshToken": "eyJ..." }
```
Resposta: `{ "data": { "accessToken": "eyJ..." } }`

#### Logout
```
POST /auth/logout
Authorization: Bearer <token>
{ "refreshToken": "eyJ..." }
```

---

### Usuários

#### Meu perfil
```
GET /users/me
```

#### Listar usuários (Manager)
```
GET /users
```

#### Criar usuário (Manager)
```
POST /users
{ "name": "...", "email": "...", "password": "...", "role": "VENDOR" }
```

#### Alterar senha
```
PUT /users/:id/password
{ "currentPassword": "...", "newPassword": "..." }
```
Manager pode trocar senha de qualquer usuário sem precisar do `currentPassword`.

---

### Clientes (dados do BI)

#### Listar clientes
```
GET /clients?search=nome&state=MG&segment=Industrial&curve=A&limit=50&offset=0
```
Resposta:
```json
{
  "data": [
    {
      "cnpj": "12345678000100",
      "name": "Cliente LTDA",
      "groupedName": "GRUPO CLIENTE",
      "city": "Belo Horizonte",
      "state": "MG",
      "segment": "Industrial",
      "curve": "A"
    }
  ],
  "total": 320,
  "limit": 50,
  "offset": 0
}
```

#### Detalhes de um cliente
```
GET /clients/:cnpj
```
Retorna: cliente + histórico mensal de faturamento + rotas utilizadas.

---

### Insights de Expansão

#### Ranking de oportunidades
```
GET /insights/opportunities?limit=50&offset=0
```
Retorna clientes ranqueados pelo score de oportunidade (rotas não cobertas + gap de queda).

Campos importantes:
| Campo | Descrição |
|---|---|
| `baselineBilling` | Média mensal dos últimos 3 meses (R$) |
| `currentBilling` | Faturamento do último mês completo (R$) |
| `uncoveredRoutesCount` | Rotas que a Sal Express atende mas o cliente não usa |
| `uncoveredRevenueEstimate` | Potencial estimado dessas rotas (R$) |
| `declineGap` | Gap de queda (se cliente caiu >10%) |
| `totalScore` | Score total — usado no ranking |
| `hasKanbanCard` | `true` se já existe card aberto para esse cliente |

#### Análise individual de cliente
```
GET /insights/client/:cnpj
```
Retorna: baseline, faturamento atual, rotas cobertas, rotas não cobertas, histórico mensal.

---

### Kanban / CRM

#### Listar cards
```
GET /kanban/cards?status=CONTACTED&assignedToId=<userId>&clientId=<cnpj>&limit=50&offset=0
```

Status possíveis: `IDENTIFIED` · `CONTACTED` · `NEGOTIATING` · `EXPANDED` · `LOST`

Vendor vê somente seus próprios cards. Manager vê todos.

#### Criar card
```
POST /kanban/cards
{
  "clientId": "12345678000100",
  "clientName": "Cliente LTDA",
  "status": "IDENTIFIED",
  "priority": "HIGH",
  "assignedToId": "<userId>"
}
```
Priority: `HIGH` · `MEDIUM` · `LOW`

#### Mover card / atualizar
```
PUT /kanban/cards/:id
{
  "status": "CONTACTED",
  "priority": "MEDIUM",
  "assignedToId": "<userId ou null>"
}
```

#### Deletar card (Manager)
```
DELETE /kanban/cards/:id
```

#### Notas de um card
```
GET /kanban/cards/:id/notes
POST /kanban/cards/:id/notes    { "content": "Texto da nota" }
DELETE /kanban/notes/:noteId
```

#### Histórico de atividades de um card
```
GET /kanban/cards/:id/activities
```

---

### Métricas

#### Expansão ativa (todos os goals)
```
GET /metrics/expansion
```
Vendor vê somente seus goals. Manager vê todos.

Campos: `baselineAvg`, `baselineQuarter`, `currentQuarter`, `delta`, `targetValue`, `targetHit`.

#### Performance de um vendedor (Manager)
```
GET /metrics/vendor/:vendorId
```

#### Resumo geral (Manager)
```
GET /metrics/summary
```
Retorna totais de cards, metas ativas, delta total de expansão, breakdown por vendedor.

#### Cadastrar meta de expansão
```
POST /metrics/goals
{
  "clientId": "12345678000100",
  "cardId": "<kanban card id>",
  "startDate": "2024-01-01T00:00:00.000Z",
  "baselineAvg": 15000.00,
  "targetValue": 5000.00
}
```
`baselineAvg` = média mensal de faturamento antes da expansão iniciar (R$).

#### Atualizar status de uma meta
```
PUT /metrics/goals/:id/status
{ "status": "ACHIEVED" }
```
Status: `ACTIVE` · `ACHIEVED` · `CANCELLED`

---

### Mensagens

#### Listar conversas
```
GET /messages
```

#### Histórico com um usuário
```
GET /messages/:userId?limit=50&offset=0
```
Mensagens são marcadas como lidas automaticamente.

#### Enviar mensagem
```
POST /messages
{ "receiverId": "<userId>", "content": "Texto" }
```

#### Marcar como lida manualmente
```
PUT /messages/:id/read
```

---

### Arquivos

#### Upload de arquivo
```
POST /files/upload
Content-Type: multipart/form-data

file: <arquivo>
clientId: <cnpj>         (opcional)
cardId: <kanban card id> (opcional)
```
Tamanho máximo padrão: 20 MB.

#### Listar arquivos de um cliente
```
GET /files/client/:cnpj
```

#### Listar arquivos de um card
```
GET /files/card/:cardId
```

#### Deletar arquivo
```
DELETE /files/:id
```

---

### Relatórios (Download de Excel)

#### Expansão em andamento
```
GET /reports/expansion/export
```
Abre diálogo de download do arquivo `.xlsx`.

#### Ranking de oportunidades (Manager)
```
GET /reports/opportunities/export
```

---

## Códigos de Resposta

| Código | Significado |
|---|---|
| 200 | Sucesso |
| 201 | Criado com sucesso |
| 204 | Sucesso sem conteúdo (ex: DELETE) |
| 400 | Dados inválidos — verifique o body da requisição |
| 401 | Não autenticado — token ausente ou expirado |
| 403 | Sem permissão (ex: Vendor tentando acessar dados de outro) |
| 404 | Recurso não encontrado |
| 500 | Erro interno do servidor |

---

## Roles

| Role | Quem é |
|---|---|
| `VENDOR` | Vendedor de expansão — acesso restrito aos próprios dados |
| `MANAGER` | Gerente — acesso total |

---

## Exemplo de Fluxo Completo (Lovable)

1. Tela de login → `POST /auth/login` → salvar `accessToken` e `refreshToken` em memória
2. Tela de ranking → `GET /insights/opportunities` → exibir lista ordenada por `totalScore`
3. Usuário clica em um cliente → `GET /insights/client/:cnpj` → mostrar rotas e gráfico de faturamento
4. Usuário cria um card → `POST /kanban/cards` → redirecionar para kanban
5. Usuário move card → `PUT /kanban/cards/:id` com `{ "status": "NEGOTIATING" }`
6. Usuário cadastra meta → `POST /metrics/goals` com baseline calculado automaticamente pelo sistema
7. Manager acompanha em `/metrics/summary` e exporta relatório via `/reports/expansion/export`

---

## Renovação Automática de Token (Recomendado)

Configure um interceptor HTTP no Lovable para renovar o token automaticamente:

```javascript
// Pseudo-código para o interceptor
async function request(config) {
  try {
    return await http(config)
  } catch (err) {
    if (err.status === 401) {
      const { accessToken } = await http.post('/auth/refresh', {
        refreshToken: localStorage.getItem('refreshToken')
      })
      localStorage.setItem('accessToken', accessToken)
      config.headers.Authorization = `Bearer ${accessToken}`
      return await http(config)
    }
    throw err
  }
}
```
