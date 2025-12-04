import { Router } from 'express';
const autoGroupMealsRouter = Router();
// 自動箱生成エントリポイント（/real）
autoGroupMealsRouter.post('/real', (_, res) => {
    console.info('[auto-group-meals] /real endpoint called, but auto group meal creation is disabled.');
    return res
        .status(200)
        .json({ ok: true, message: 'Auto group meal creation is disabled.' });
});
// 自動箱生成エントリポイント（/meet）
autoGroupMealsRouter.post('/meet', (_, res) => {
    console.info('[auto-group-meals] /meet endpoint called, but auto group meal creation is disabled.');
    return res
        .status(200)
        .json({ ok: true, message: 'Auto group meal creation is disabled.' });
});
export { autoGroupMealsRouter };
