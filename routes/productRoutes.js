const express = require('express');
const productController = require('../controllers/productController');
const addPhotoUrl = require('../middlewares/addPhotoUrl');

const router = express.Router();

router
  .route('/')
  .get(addPhotoUrl, productController.getAllProduct)
  .post(productController.createProduct);

router
  .route('/:id')
  .get(productController.getProduct)
  .patch(productController.updateProduct)
  .delete(productController.deleteProduct);

router.route('/:slug').get(productController.filterProductByCategory);
module.exports = router;
