// services/dbHealthCheck.js
const mongoose = require('mongoose');

const checkDatabaseConnection = async (maxRetries = 5, retryInterval = 2000) => {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      if (mongoose.connection.readyState === 1) {
        console.log('Database connection is ready');
        return true;
      }
      
      console.log(`Database not ready, attempt ${retries + 1}/${maxRetries}`);
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retries++;
      
    } catch (error) {
      console.error('Database health check failed:', error);
      retries++;
      
      if (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }
  
  console.error('Database connection failed after maximum retries');
  return false;
};

module.exports = { checkDatabaseConnection };