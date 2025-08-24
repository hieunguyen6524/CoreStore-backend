const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const catchAsync = require('../utils/catchAsync');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const Email = require('../utils/email');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    httpOnly: true,
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000,
    ),
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'Lax',
    secure: process.env.NODE_ENV === 'production',
  };

  res.cookie('jwt', token, cookieOptions);

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.signUp = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  });

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Kiem tra email va pass duoc nhap hay chua
  if (!email || !password)
    return next(new AppError('Please provide email and password'), 400);

  // 2) Kiem tra email co ton tai hay khong va kiem tra pass co dung hay khong
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password)))
    return next(new AppError('Your email or password not correct'));

  createSendToken(user, 200, res);
});

exports.logout = catchAsync(async (req, res, next) => {
  res.cookie('jwt', 'loggedout', {
    httpOnly: true,
    expires: new Date(Date.now() + 10 * 1000),

    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'Lax',
    secure: process.env.NODE_ENV === 'production',
  });

  res.status(200).json({
    status: 'success',
  });
});

exports.protect = catchAsync(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token)
    return next(
      new AppError('You are not logged in! Please log in to get access.', 404),
    );

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!decoded) return next(new AppError('Verify token faile'));

  const currenthUser = await User.findById(decoded.id);

  if (!currenthUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401,
      ),
    );
  }

  // Kiem tra han token (neu thoi gian tao token > thoi gian thay doi pass thi khong dang nhap duoc)
  if (currenthUser.changedPasswordAfter(decoded.iat))
    return next(
      new AppError('User recentyly changed password! Please log in again', 401),
    );

  req.user = currenthUser;
  res.locals.user = currenthUser;

  next();
});

exports.isLoged = async (req, res, next) => {
  if (req.cookies.jwt) {
    try {
      const decoded = jwt.verify(req.cookies.jwt, process.env.JWT_SECRET);
      const currenthUser = await User.findById(decoded.id);

      if (!currenthUser) return next();

      if (currenthUser.changedPasswordAfter(decoded.iat)) return next();

      req.user = currenthUser;
      return next();
    } catch (error) {
      return next();
    }
  }
  next();
};

exports.rectricTo =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to peform this action', 403),
      );
    }
    next();
  };

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user)
    return next(new AppError('There is no user with email address', 404));

  const resetToken = user.createPasswordResetToken();

  await user.save({ validateBeforeSave: false });

  try {
    // const resetURL = `${req.protocol}://${req.get('host')}/api/user/reresetPassword/${resetToken}`;
    const resetURL = `${process.env.FRONTEND_URL || 'http://127.0.0.1:5173'}/resetPassword/${resetToken}`;

    new Email(user, resetURL).sendPasswordReset();
    res.status(200).json({
      status: 'success',
      message: 'Token send to email',
    });
  } catch (error) {
    return next(
      new AppError(
        'There was an error sending the email. Try again later!',
        500,
      ),
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('token is invalid or has expired', 400));
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await user.save();

  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  if (!(await user.correctPassword(req.body.currenthPassword, user.password))) {
    return next(new AppError('Your current password is wrong ', 401));
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;

  await user.save();

  createSendToken(user, 200, res);
});
