import { Router } from 'express';
import * as catalog from '../../catalog.js';
import { requireUser } from '../auth.js';

export const router = Router();

// Browsing does not require a workspace. Passing one only adds "installed"
// flags to the entries.
router.get('/apps', requireUser, async (req, res, next) => {
  try {
    res.json({
      apps: await catalog.index({
        workspaceId: req.query.workspace ?? null,
        category: req.query.category ?? null,
        search: req.query.q ?? null,
      }),
    });
  } catch (e) { next(e); }
});

router.get('/apps/:appId', requireUser, async (req, res, next) => {
  try {
    res.json(await catalog.detail(req.params.appId, { workspaceId: req.query.workspace ?? null }));
  } catch (e) { next(e); }
});

router.get('/stores', requireUser, async (req, res, next) => {
  try { res.json({ stores: await catalog.listStores() }); } catch (e) { next(e); }
});

// Publishing is how an app gets in. In this build any signed-in developer may
// publish to the local store; a hosted deployment puts an approval in front.
router.post('/publish', requireUser, async (req, res, next) => {
  try {
    const result = await catalog.publish({
      manifest: req.body?.manifest ?? req.body,
      storeSlug: req.body?.store ?? 'official',
      channel: req.body?.channel ?? 'stable',
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});
