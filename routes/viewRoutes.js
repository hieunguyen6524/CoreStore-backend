const express = require('express');
const viewController = require('../controllers/viewController');
const addPhotoUrl = require('../middlewares/addPhotoUrl');

const router = express.Router();

router.get('/', addPhotoUrl, viewController.getHomeProducts);
router.get('/:slug', addPhotoUrl, viewController.getProductBySlug);

module.exports = router;
