const express = require('express');
const productController = require('../controllers/productController');
const addPhotoUrl = require('../middlewares/addPhotoUrl');
const { cacheMiddleware } = require('../utils/redisClient');

const router = express.Router();

// Cache middleware for product search/list (TTL: 30 minutes)
const cacheProducts = cacheMiddleware('products', 1800, false);
// Cache middleware for single product (TTL: 1 hour) - includes route params
const cacheProduct = cacheMiddleware('product', 3600, true);
// Cache middleware for products by category (TTL: 30 minutes) - includes route params
const cacheProductsByCategory = cacheMiddleware('products:category', 1800, true);

router
  .route('/')
  .get(cacheProducts, addPhotoUrl, productController.getAllProduct)
  .post(
    productController.uploadProductImages,
    productController.resizeProductImages,
    productController.createProduct,
  );

router
  .route('/:id')
  .get(cacheProduct, productController.getProduct)
  .patch(productController.updateProduct)
  .delete(productController.deleteProduct);

router
  .route('/category/:slug')
  .get(cacheProductsByCategory, addPhotoUrl, productController.getProductsByCategory);
module.exports = router;
