const express = require('express');
const orderController = require('../controllers/orderController');
const authController = require('../controllers/authController');

const router = express.Router();

router.use(authController.protect);

router.get('/checkout', orderController.checkout);
router.get('/my-orders', orderController.getOrdersByUser);

// Admin routes - chỉ admin mới được truy cập
router.use(authController.rectricTo('admin'));
router.patch('/:id/cancel', orderController.cancelOrder);
router.get('/', orderController.getAllOrders);

module.exports = router;
