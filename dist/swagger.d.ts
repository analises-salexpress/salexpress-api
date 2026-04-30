export declare const swaggerSpec: {
    openapi: string;
    info: {
        title: string;
        version: string;
        description: string;
    };
    servers: {
        url: string;
        description: string;
    }[];
    components: {
        securitySchemes: {
            bearerAuth: {
                type: string;
                scheme: string;
                bearerFormat: string;
            };
        };
        schemas: {
            Error: {
                type: string;
                properties: {
                    error: {
                        type: string;
                    };
                };
            };
            User: {
                type: string;
                properties: {
                    id: {
                        type: string;
                    };
                    name: {
                        type: string;
                    };
                    email: {
                        type: string;
                        format: string;
                    };
                    role: {
                        type: string;
                        enum: string[];
                    };
                    active: {
                        type: string;
                    };
                    createdAt: {
                        type: string;
                        format: string;
                    };
                };
            };
            KanbanCard: {
                type: string;
                properties: {
                    id: {
                        type: string;
                    };
                    clientId: {
                        type: string;
                    };
                    clientName: {
                        type: string;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                    priority: {
                        type: string;
                        enum: string[];
                    };
                    assignedToId: {
                        type: string;
                        nullable: boolean;
                    };
                    createdById: {
                        type: string;
                    };
                    createdAt: {
                        type: string;
                        format: string;
                    };
                    updatedAt: {
                        type: string;
                        format: string;
                    };
                };
            };
            OpportunityScore: {
                type: string;
                properties: {
                    cnpj: {
                        type: string;
                    };
                    clientName: {
                        type: string;
                    };
                    groupedName: {
                        type: string;
                    };
                    city: {
                        type: string;
                        nullable: boolean;
                    };
                    state: {
                        type: string;
                        nullable: boolean;
                    };
                    segment: {
                        type: string;
                        nullable: boolean;
                    };
                    curve: {
                        type: string;
                        nullable: boolean;
                    };
                    baselineBilling: {
                        type: string;
                        description: string;
                    };
                    currentBilling: {
                        type: string;
                        description: string;
                    };
                    uncoveredRoutesCount: {
                        type: string;
                        description: string;
                    };
                    uncoveredRevenueEstimate: {
                        type: string;
                        description: string;
                    };
                    declineGap: {
                        type: string;
                        description: string;
                    };
                    totalScore: {
                        type: string;
                        description: string;
                    };
                    hasKanbanCard: {
                        type: string;
                    };
                };
            };
            ExpansionGoal: {
                type: string;
                properties: {
                    goalId: {
                        type: string;
                    };
                    clientId: {
                        type: string;
                    };
                    clientName: {
                        type: string;
                    };
                    startDate: {
                        type: string;
                        format: string;
                    };
                    baselineAvg: {
                        type: string;
                    };
                    baselineQuarter: {
                        type: string;
                    };
                    currentQuarter: {
                        type: string;
                    };
                    delta: {
                        type: string;
                    };
                    targetValue: {
                        type: string;
                        nullable: boolean;
                    };
                    targetHit: {
                        type: string;
                    };
                };
            };
        };
    };
    security: {
        bearerAuth: never[];
    }[];
    paths: {
        '/health': {
            get: {
                tags: string[];
                summary: string;
                security: never[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        status: {
                                            type: string;
                                            example: string;
                                        };
                                        version: {
                                            type: string;
                                            example: string;
                                        };
                                        timestamp: {
                                            type: string;
                                            format: string;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        '/auth/login': {
            post: {
                tags: string[];
                summary: string;
                security: never[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    email: {
                                        type: string;
                                        format: string;
                                        example: string;
                                    };
                                    password: {
                                        type: string;
                                        example: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            type: string;
                                            properties: {
                                                accessToken: {
                                                    type: string;
                                                };
                                                refreshToken: {
                                                    type: string;
                                                };
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    401: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/auth/refresh': {
            post: {
                tags: string[];
                summary: string;
                security: never[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    refreshToken: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            type: string;
                                            properties: {
                                                accessToken: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    401: {
                        description: string;
                    };
                };
            };
        };
        '/auth/logout': {
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                properties: {
                                    refreshToken: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/users': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            type: string;
                                            items: {
                                                $ref: string;
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    name: {
                                        type: string;
                                        minLength: number;
                                    };
                                    email: {
                                        type: string;
                                        format: string;
                                    };
                                    password: {
                                        type: string;
                                        minLength: number;
                                    };
                                    role: {
                                        type: string;
                                        enum: string[];
                                        default: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                    };
                    409: {
                        description: string;
                    };
                };
            };
        };
        '/users/me': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            $ref: string;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        '/users/{id}': {
            put: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                properties: {
                                    name: {
                                        type: string;
                                    };
                                    active: {
                                        type: string;
                                    };
                                    role: {
                                        type: string;
                                        enum: string[];
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/users/{id}/password': {
            put: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    currentPassword: {
                                        type: string;
                                        description: string;
                                    };
                                    newPassword: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                    };
                    400: {
                        description: string;
                    };
                };
            };
        };
        '/clients': {
            get: {
                tags: string[];
                summary: string;
                parameters: ({
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default?: undefined;
                        maximum?: undefined;
                    };
                    description: string;
                    example?: undefined;
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default?: undefined;
                        maximum?: undefined;
                    };
                    example: string;
                    description?: undefined;
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default?: undefined;
                        maximum?: undefined;
                    };
                    description?: undefined;
                    example?: undefined;
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                        maximum: number;
                    };
                    description?: undefined;
                    example?: undefined;
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                        maximum?: undefined;
                    };
                    description?: undefined;
                    example?: undefined;
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            type: string;
                                            items: {
                                                type: string;
                                            };
                                        };
                                        total: {
                                            type: string;
                                        };
                                        limit: {
                                            type: string;
                                        };
                                        offset: {
                                            type: string;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        '/clients/{cnpj}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/insights/opportunities': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                parameters: ({
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                        maximum: number;
                    };
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                        maximum?: undefined;
                    };
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            type: string;
                                            items: {
                                                $ref: string;
                                            };
                                        };
                                        total: {
                                            type: string;
                                        };
                                        limit: {
                                            type: string;
                                        };
                                        offset: {
                                            type: string;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        '/insights/client/{cnpj}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/kanban/cards': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                parameters: ({
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        enum: string[];
                        default?: undefined;
                    };
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        enum?: undefined;
                        default?: undefined;
                    };
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                        enum?: undefined;
                    };
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        data: {
                                            type: string;
                                            items: {
                                                $ref: string;
                                            };
                                        };
                                        total: {
                                            type: string;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    clientId: {
                                        type: string;
                                        description: string;
                                    };
                                    clientName: {
                                        type: string;
                                    };
                                    status: {
                                        type: string;
                                        enum: string[];
                                        default: string;
                                    };
                                    priority: {
                                        type: string;
                                        enum: string[];
                                        default: string;
                                    };
                                    assignedToId: {
                                        type: string;
                                        description: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                    };
                };
            };
        };
        '/kanban/cards/{id}': {
            put: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                properties: {
                                    status: {
                                        type: string;
                                        enum: string[];
                                    };
                                    priority: {
                                        type: string;
                                        enum: string[];
                                    };
                                    assignedToId: {
                                        type: string;
                                        nullable: boolean;
                                    };
                                    clientName: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                    };
                    403: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
            delete: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    204: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/kanban/cards/{id}/notes': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    content: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/kanban/notes/{noteId}': {
            delete: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    204: {
                        description: string;
                    };
                    403: {
                        description: string;
                    };
                };
            };
        };
        '/kanban/cards/{id}/activities': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/metrics/expansion': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    items: {
                                        $ref: string;
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        '/metrics/vendor/{vendorId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/metrics/summary': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/metrics/goals': {
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    clientId: {
                                        type: string;
                                        description: string;
                                    };
                                    cardId: {
                                        type: string;
                                        description: string;
                                    };
                                    startDate: {
                                        type: string;
                                        format: string;
                                    };
                                    baselineAvg: {
                                        type: string;
                                        description: string;
                                    };
                                    targetValue: {
                                        type: string;
                                        description: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                    };
                };
            };
        };
        '/metrics/goals/{id}/status': {
            put: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    status: {
                                        type: string;
                                        enum: string[];
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                    };
                    403: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/messages': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    receiverId: {
                                        type: string;
                                    };
                                    content: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                    };
                };
            };
        };
        '/messages/{userId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: ({
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                        default?: undefined;
                    };
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                    };
                    required?: undefined;
                })[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/messages/{id}/read': {
            put: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/files/upload': {
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    file: {
                                        type: string;
                                        format: string;
                                    };
                                    clientId: {
                                        type: string;
                                        description: string;
                                    };
                                    cardId: {
                                        type: string;
                                        description: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                    };
                    500: {
                        description: string;
                    };
                };
            };
        };
        '/files/client/{clientId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/files/card/{cardId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/files/{id}': {
            delete: {
                tags: string[];
                summary: string;
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                    };
                }[];
                responses: {
                    204: {
                        description: string;
                    };
                    403: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/reports/expansion/export': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                                schema: {
                                    type: string;
                                    format: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/reports/opportunities/export': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                                schema: {
                                    type: string;
                                    format: string;
                                };
                            };
                        };
                    };
                };
            };
        };
    };
};
