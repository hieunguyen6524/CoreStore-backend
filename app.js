const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const cors = require('cors');

const globalErrorHandler = require('./controllers/errorController');
const productRouter = require('./routes/productRoutes');
const brandRouter = require('./routes/brandRoutes');
const categoryRouter = require('./routes/categoryRoutes');
const userRouter = require('./routes/userRoutes');
const viewRouter = require('./routes/viewRoutes');
const cartRouter = require('./routes/cartRoutes');

const app = express();
app.set('query parser', 'extended'); // Sử dụng parser 'qs' như Express 4

app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json({ limit: '10kb' }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use(
  cors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'], // Domain của frontend
    credentials: true,
  }),
);

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

app.use(globalErrorHandler);

module.exports = app;
