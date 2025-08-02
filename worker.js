// worker.js - Simple notification worker service
const connectDb = require('./config/dbConnection');
const { notificationService } = require('./services/notificationService');
const dotenv = require('dotenv').config();

const startWorkerService = async () => {
  try {
    console.log('🔧 Starting Class Notification Worker...');
    
    // Connect to database
    await connectDb();
    console.log('✅ Database connected');
    
    // Start the notification service
    await notificationService.start();
    console.log('✅ Notification service started');
    
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await notificationService.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down worker...');
  await notificationService.stop();
  process.exit(0);
});

// Start the worker
startWorkerService();