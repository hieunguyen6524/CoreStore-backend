const express = require('express');
const orderController = require('../controllers/orderController');
const authController = require('../controllers/authController');

const router = express.Router();

router.use(authController.protect);

router.get('/checkout', orderController.checkout);
router.get('/my-orders', orderController.getOrdersByUser);

module.exports = router;
