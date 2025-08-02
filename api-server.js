// api-server.js - Clean API service without notification service
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
  res.status(200).json({ 
    status: 'OK', 
    service: 'api',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Simple root endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'Class Tracker API Service',
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      classes: '/api/classes',
      health: '/health'
    }
  });
});

// Start API server
const startApiServer = async () => {
  try {
    // Connect to database
    await connectDb();
    console.log('✅ Database connected successfully');
    
    // Start the Express server
    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 API Server is running on port ${port}`);
      console.log(`📡 Health check available at: http://localhost:${port}/health`);
      console.log(`👤 User endpoints: http://localhost:${port}/api/users`);
      console.log(`📚 Class endpoints: http://localhost:${port}/api/classes`);
    });

  } catch (error) {
    console.error('❌ Failed to start API server:', error);
    process.exit(1);
  }
};

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down API server gracefully...');
  // Close database connection
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down API server gracefully...');
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the API server
startApiServer();