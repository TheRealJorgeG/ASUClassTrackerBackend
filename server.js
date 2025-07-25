// Fixed server.js
const express = require('express');
const connectDb = require('./config/dbConnection');
const errorHandler = require('./middleware/errorHandler');
const dotenv = require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// CORS middleware
const cors = require('cors');
app.use(cors());

app.use(express.json());

// Routes
app.use("/api/classes", require("./routes/classRoutes"));
app.use("/api/users", require("./routes/userRoutes"));

// Error handler
app.use(errorHandler);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server and notification service
const startServer = async () => {
  try {
    // Connect to database first
    await connectDb();
    console.log('Database connected successfully');
    
    // Start the Express server
    app.listen(port, '0.0.0.0', () => {
      console.log(`Server is running on port ${port}`);
    });

    // Start notification service with delay to ensure database is ready
    setTimeout(async () => {
      try {
        const { notificationService } = require('./services/notificationService');
        const { checkDatabaseConnection } = require('./services/dbHealthCheck');
        
        console.log('Checking database connection before starting notification service...');
        const isDbReady = await checkDatabaseConnection();
        
        if (isDbReady) {
          await notificationService.start();
          console.log('Notification service started successfully');
        } else {
          console.error('Could not start notification service - database not ready');
        }
      } catch (error) {
        console.error('Failed to start notification service:', error);
        console.log('Server will continue without notification service');
      }
    }, 5000); // Wait 5 seconds before starting notification service

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  try {
    const { notificationService } = require('./services/notificationService');
    await notificationService.stop();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  try {
    const { notificationService } = require('./services/notificationService');
    await notificationService.stop();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer();