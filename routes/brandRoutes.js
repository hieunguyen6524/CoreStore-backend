const express = require('express');
const brandController = require('../controllers/brandController');

const router = express.Router();

router
  .route('/')
  .get(brandController.getAllBrand)
  .post(brandController.createBrand);

router
  .route('/:id')
  .get(brandController.getBrand)
  .patch(brandController.upateBrand)
  .delete(brandController.deleteBrand);

module.exports = router;
