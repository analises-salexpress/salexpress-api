"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const prisma_1 = require("../db/prisma");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /messages — list conversations (last message per user)
router.get('/', async (req, res) => {
    const userId = req.user.userId;
    // Get all distinct conversation partners
    const sent = await prisma_1.prisma.message.findMany({
        where: { senderId: userId },
        distinct: ['receiverId'],
        select: { receiverId: true },
    });
    const received = await prisma_1.prisma.message.findMany({
        where: { receiverId: userId },
        distinct: ['senderId'],
        select: { senderId: true },
    });
    const partnerIds = [
        ...new Set([
            ...sent.map((m) => m.receiverId),
            ...received.map((m) => m.senderId),
        ]),
    ];
    const conversations = await Promise.all(partnerIds.map(async (partnerId) => {
        const [lastMsg, unreadCount, partner] = await Promise.all([
            prisma_1.prisma.message.findFirst({
                where: {
                    OR: [
                        { senderId: userId, receiverId: partnerId },
                        { senderId: partnerId, receiverId: userId },
                    ],
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true, content: true, createdAt: true, senderId: true, readAt: true },
            }),
            prisma_1.prisma.message.count({
                where: { senderId: partnerId, receiverId: userId, readAt: null },
            }),
            prisma_1.prisma.user.findUnique({
                where: { id: partnerId },
                select: { id: true, name: true, email: true, role: true },
            }),
        ]);
        return { partner, lastMessage: lastMsg, unreadCount };
    }));
    // Sort by most recent message
    conversations.sort((a, b) => {
        const at = a.lastMessage?.createdAt.getTime() ?? 0;
        const bt = b.lastMessage?.createdAt.getTime() ?? 0;
        return bt - at;
    });
    res.json(conversations);
});
// GET /messages/:userId — conversation history
router.get('/:userId', async (req, res) => {
    const myId = req.user.userId;
    const partnerId = req.params.userId;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const [messages, total] = await Promise.all([
        prisma_1.prisma.message.findMany({
            where: {
                OR: [
                    { senderId: myId, receiverId: partnerId },
                    { senderId: partnerId, receiverId: myId },
                ],
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
            include: { sender: { select: { id: true, name: true } } },
        }),
        prisma_1.prisma.message.count({
            where: {
                OR: [
                    { senderId: myId, receiverId: partnerId },
                    { senderId: partnerId, receiverId: myId },
                ],
            },
        }),
    ]);
    // Mark unread messages as read
    await prisma_1.prisma.message.updateMany({
        where: { senderId: partnerId, receiverId: myId, readAt: null },
        data: { readAt: new Date() },
    });
    res.json({ data: messages.reverse(), total, limit, offset });
});
// POST /messages — send message
const sendSchema = zod_1.z.object({
    receiverId: zod_1.z.string(),
    content: zod_1.z.string().min(1).max(5000),
});
router.post('/', async (req, res) => {
    const body = sendSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const receiver = await prisma_1.prisma.user.findUnique({ where: { id: body.data.receiverId } });
    if (!receiver) {
        res.status(404).json({ error: 'Receiver not found' });
        return;
    }
    const message = await prisma_1.prisma.message.create({
        data: {
            senderId: req.user.userId,
            receiverId: body.data.receiverId,
            content: body.data.content,
        },
        include: { sender: { select: { id: true, name: true } } },
    });
    res.status(201).json(message);
});
// PUT /messages/:id/read
router.put('/:id/read', async (req, res) => {
    const message = await prisma_1.prisma.message.findUnique({ where: { id: req.params.id } });
    if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
    }
    if (message.receiverId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const updated = await prisma_1.prisma.message.update({
        where: { id: req.params.id },
        data: { readAt: new Date() },
    });
    res.json(updated);
});
exports.default = router;
//# sourceMappingURL=messages.js.map