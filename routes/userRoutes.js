const express = require('express');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const addPhotoUrl = require('../middlewares/addPhotoUrl');

const router = express.Router();

// Auth
router.post('/signup', authController.signUp);
router.post('/login', authController.login);
router.post('/forgotpassword', authController.forgotPassword);
router.patch('/resetpassword/:token', authController.resetPassword);

// Chỉ user đã login mới được truy cập
router.use(authController.protect);

router.get('/logout', authController.logout);
router.get('/me', userController.getMe, addPhotoUrl, userController.getUser);

// Update info cá nhân
router.patch(
  '/updateMe',
  userController.uploadUserPhoto,
  userController.resizeUserPhoto,
  userController.updateMe,
);

// Update password
router.patch('/updateMyPassword', authController.updatePassword);

module.exports = router;
