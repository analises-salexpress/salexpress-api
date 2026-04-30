"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../db/supabase");
const prisma_1 = require("../db/prisma");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
const MAX_MB = Number(process.env.MAX_FILE_SIZE_MB ?? 20);
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_MB * 1024 * 1024 },
});
// POST /files/upload
// Body: multipart/form-data — file, clientId (optional), cardId (optional)
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }
    const { clientId, cardId } = req.body;
    const ext = req.file.originalname.split('.').pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase_1.supabase.storage
        .from('expansion-files')
        .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) {
        res.status(500).json({ error: `Storage upload failed: ${error.message}` });
        return;
    }
    const { data: urlData } = supabase_1.supabase.storage
        .from('expansion-files')
        .getPublicUrl(path);
    const file = await prisma_1.prisma.file.create({
        data: {
            name: req.file.originalname,
            path: urlData.publicUrl,
            mimeType: req.file.mimetype,
            uploadedById: req.user.userId,
            clientId: clientId ?? null,
            cardId: cardId ?? null,
        },
    });
    res.status(201).json(file);
});
// GET /files/client/:clientId
router.get('/client/:clientId', async (req, res) => {
    const files = await prisma_1.prisma.file.findMany({
        where: { clientId: req.params.clientId },
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
    });
    res.json(files);
});
// GET /files/card/:cardId
router.get('/card/:cardId', async (req, res) => {
    const files = await prisma_1.prisma.file.findMany({
        where: { cardId: req.params.cardId },
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
    });
    res.json(files);
});
// DELETE /files/:id
router.delete('/:id', async (req, res) => {
    const file = await prisma_1.prisma.file.findUnique({ where: { id: req.params.id } });
    if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
    }
    if (req.user.role !== client_1.Role.MANAGER && file.uploadedById !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    // Extract storage path from public URL
    const storagePath = file.path.split('/expansion-files/').at(-1);
    if (storagePath) {
        await supabase_1.supabase.storage.from('expansion-files').remove([storagePath]);
    }
    await prisma_1.prisma.file.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
exports.default = router;
//# sourceMappingURL=files.js.map