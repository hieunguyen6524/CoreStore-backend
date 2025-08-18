const express = require('express');
const authController = require('../controllers/authController');
const cartController = require('../controllers/cartController');
const addPhotoUrl = require('../middlewares/addPhotoUrl');

const router = express.Router();

router.use(authController.protect);

router
  .route('/')
  .get(addPhotoUrl, cartController.getUserCart)
  .patch(cartController.addCart);

router
  .route('/:id')
  .patch(cartController.updateItemQuantity)
  .delete(cartController.deleteCartItem);
module.exports = router;
