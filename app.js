const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

const globalErrorHandler = require('./controllers/errorController');
const productRouter = require('./routes/productRoutes');
const brandRouter = require('./routes/brandRoutes');
const categoryRouter = require('./routes/categoryRoutes');
const userRouter = require('./routes/userRoutes');
const viewRouter = require('./routes/viewRoutes');
const cartRouter = require('./routes/cartRoutes');
const orderRouter = require('./routes/orderRoutes');

const orderController = require('./controllers/orderController');

const app = express();
app.set('query parser', 'extended'); // Sử dụng parser 'qs' như Express 4

app.use(express.static(path.join(__dirname, 'public')));

app.post(
  '/api/webhook-checkout',
  express.json({ type: 'application/json' }),
  orderController.sepayWebhook,
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use(
  cors({
    origin: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'https://corestore-frontend.vercel.app',
    ], // Domain của frontend
    credentials: true,
  }),
);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

const limited = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Too many resquest from this IP, please try again in an hour',
});
app.use('/api', limited);

app.use(cookieParser());

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
  });
});

app.use('/view', viewRouter);
app.use('/api/products', productRouter);
app.use('/api/brands', brandRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/users', userRouter);
app.use('/api/cart', cartRouter);
app.use('/api/order', orderRouter);

app.use(globalErrorHandler);

module.exports = app;
