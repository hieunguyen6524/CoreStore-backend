const dotenv = require('dotenv');

dotenv.config({ path: './.env' });

process.on('uncaughtException', (err) => {
  console.log(err.name, err.message);
  console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  process.exit(1);
});

const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    // useCreateIndex: true,
    // useFindAndModify: false,
  })
  .then(() => console.log('DB connection successful!'));

const port = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'https://corestore-frontend.vercel.app',
    ],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log('⚡ Client connected:', socket.id);

  socket.on('joinOrder', (orderId) => {
    socket.join(`order:${orderId}`);
    console.log(`👉 Client ${socket.id} joined room order:${orderId}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

app.set('io', io);

server.listen(port, () => {
  console.log(`App running on port ${port}...`);
});

process.on('unhandledRejection', (err) => {
  console.log(err.name, err.message);
  console.log('UNHANDLER REJECTION! 💥 Shutting down...');
  server.close(() => {
    process.exit(1);
  });
});
