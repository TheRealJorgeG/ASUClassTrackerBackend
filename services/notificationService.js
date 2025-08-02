// Fixed notificationService.js with enhanced logging and process isolation
const nodemailer = require('nodemailer');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const mongoose = require('mongoose');

// Import models with error handling
let Class, User;
try {
  Class = require('../models/classModel');
  User = require('../models/userModel');
} catch (error) {
  console.error('Error importing models:', error);
}

// Create notification schema for tracking
const notificationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  class_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  class_number: { type: String, required: true },
  last_status: { type: String, enum: ['Open', 'Closed'], default: 'Closed' },
  last_checked: { type: Date, default: Date.now },
  notification_sent: { type: Date },
  notification_count: { type: Number, default: 0 },
  is_active: { type: Boolean, default: true }
}, { timestamps: true });

let Notification;
try {
  Notification = mongoose.model('Notification', notificationSchema);
} catch (error) {
  // Model might already exist
  Notification = mongoose.model('Notification');
}

class NotificationService {
  constructor() {
    this.execAsync = util.promisify(exec);
    this.isRunning = false;
    this.batchSize = 5; // Reduced batch size to prevent resource conflicts
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
    this.maxRetries = 3;
    this.emailTransporter = null;

    // Rate limiting - IMPORTANT: Only 1 concurrent script
    this.scriptCallQueue = [];
    this.isProcessingQueue = false;
    this.maxConcurrentScripts = 1; // Keep this at 1 for Chrome stability
    this.currentScriptCount = 0;

    // Add minimum delay between script starts
    this.lastScriptStartTime = 0;
    this.minScriptInterval = 2000; // 2 seconds between starts

    // Logging counters
    this.cycleCount = 0;
    this.totalClassesChecked = 0;
    this.totalNotificationsSent = 0;

    // Initialize email transporter only if environment variables are set
    this.initializeEmailTransporter();
  }

  // Memory monitoring utility
  getMemoryUsage() {
    const memUsage = process.memoryUsage();
    return {
      rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100, // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100, // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100, // MB
      external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100 // MB
    };
  }

  printMemoryUsage(stage) {
    const memory = this.getMemoryUsage();
    console.log(`[MEMORY] ${stage}: RSS=${memory.rss}MB, Heap=${memory.heapUsed}/${memory.heapTotal}MB, External=${memory.external}MB`);
    return memory;
  }

  printClassInformation(classData, classNumber) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`CLASS STATUS CHECK - ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Class Number:  ${classNumber}`);
    console.log(`Course:        ${classData.course || 'N/A'}`);
    console.log(`Title:         ${classData.title || 'N/A'}`);
    console.log(`Instructors:   ${classData.instructors ? classData.instructors.join(', ') : 'N/A'}`);
    console.log(`Days:          ${classData.days || 'N/A'}`);
    console.log(`Time:          ${classData.time || 'N/A'}`);
    console.log(`Location:      ${classData.location || 'N/A'}`);
    console.log(`Dates:         ${classData.dates || 'N/A'}`);
    console.log(`Units:         ${classData.units || 'N/A'}`);
    console.log(`Seat Status:   ${classData.seatStatus || 'N/A'} ${classData.seatStatus === 'Open' ? '✅' : '❌'}`);
    console.log(`${'='.repeat(80)}\n`);
  }

  initializeEmailTransporter() {
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        this.emailTransporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: process.env.SMTP_PORT || 587,
          secure: false,
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          },
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          rateDelta: 1000,
          rateLimit: 5
        });
        console.log('Email transporter initialized');
      } catch (error) {
        console.error('Error initializing email transporter:', error);
        this.emailTransporter = null;
      }
    } else {
      console.warn('Email credentials not provided - email notifications disabled');
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('Notification service already running');
      return;
    }

    if (!Class || !User || !Notification) {
      console.error('Models not available - cannot start notification service');
      return;
    }

    this.isRunning = true;
    console.log('Starting notification service...');
    this.printMemoryUsage('Service Start');

    try {
      // Initialize notification tracking for existing classes
      await this.initializeNotificationTracking();

      // Start the main monitoring loop
      this.monitorClasses();

      // Start queue processor
      this.processScriptQueue();

      console.log('Notification service started successfully');
    } catch (error) {
      console.error('Error starting notification service:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop() {
    this.isRunning = false;
    console.log('Stopping notification service...');
    this.printMemoryUsage('Service Stop');

    if (this.monitoringTimer) {
      clearTimeout(this.monitoringTimer);
    }

    if (this.emailTransporter) {
      try {
        await this.emailTransporter.close();
      } catch (error) {
        console.error('Error closing email transporter:', error);
      }
    }
  }

  async initializeNotificationTracking() {
    try {
      // Get all classes that don't have notification tracking
      const classes = await Class.find({}).populate('user_id');

      for (const classItem of classes) {
        if (!classItem.user_id) continue;

        const existingNotification = await Notification.findOne({
          user_id: classItem.user_id._id,
          class_id: classItem._id
        });

        if (!existingNotification) {
          await Notification.create({
            user_id: classItem.user_id._id,
            class_id: classItem._id,
            class_number: classItem.number,
            last_status: 'Closed',
            is_active: true
          });
        }
      }

      console.log('Notification tracking initialized');
      this.printMemoryUsage('Tracking Initialized');
    } catch (error) {
      console.error('Error initializing notification tracking:', error);
    }
  }

  async monitorClasses() {
    if (!this.isRunning) return;

    this.cycleCount++;
    const cycleStartTime = new Date();
    const startMemory = this.printMemoryUsage(`Cycle ${this.cycleCount} Start`);

    console.log(`\n🔄 Starting monitoring cycle #${this.cycleCount} at ${cycleStartTime.toISOString()}`);

    try {
      // Get all active notifications, batch by batch
      const totalNotifications = await Notification.countDocuments({ is_active: true });
      const totalBatches = Math.ceil(totalNotifications / this.batchSize);

      if (totalNotifications > 0) {
        console.log(`📊 Processing ${totalNotifications} notifications in ${totalBatches} batches`);

        let batchClassesChecked = 0;
        let batchNotificationsSent = 0;

        for (let batch = 0; batch < totalBatches; batch++) {
          if (!this.isRunning) break;

          console.log(`📦 Processing batch ${batch + 1}/${totalBatches}...`);
          const batchStartMemory = this.printMemoryUsage(`Batch ${batch + 1} Start`);

          const notifications = await Notification.find({ is_active: true })
            .populate('user_id')
            .populate('class_id')
            .skip(batch * this.batchSize)
            .limit(this.batchSize);

          // Process batch concurrently but with controlled concurrency
          const batchPromises = notifications.map(async (notification) => {
            const result = await this.processNotification(notification);
            if (result) {
              batchClassesChecked++;
              if (result.notificationSent) {
                batchNotificationsSent++;
              }
            }
            return result;
          });

          await Promise.allSettled(batchPromises);

          this.printMemoryUsage(`Batch ${batch + 1} Complete`);
          console.log(`✅ Batch ${batch + 1} completed: ${notifications.length} classes processed`);

          // Small delay between batches
          await this.sleep(1000);
        }

        this.totalClassesChecked += batchClassesChecked;
        this.totalNotificationsSent += batchNotificationsSent;

        const cycleEndTime = new Date();
        const cycleDuration = (cycleEndTime - cycleStartTime) / 1000;
        const endMemory = this.printMemoryUsage(`Cycle ${this.cycleCount} End`);
        const memoryDelta = endMemory.rss - startMemory.rss;

        console.log(`\n📈 CYCLE ${this.cycleCount} SUMMARY:`);
        console.log(`   ⏱️  Duration: ${cycleDuration.toFixed(2)}s`);
        console.log(`   📊 Classes checked: ${batchClassesChecked}`);
        console.log(`   📧 Notifications sent: ${batchNotificationsSent}`);
        console.log(`   💾 Memory delta: ${memoryDelta >= 0 ? '+' : ''}${memoryDelta.toFixed(2)}MB`);
        console.log(`   📈 Total lifetime: ${this.totalClassesChecked} classes, ${this.totalNotificationsSent} notifications`);
        console.log(`   ⏰ Next check at: ${new Date(Date.now() + this.checkInterval).toISOString()}`);
        console.log(`${'='.repeat(100)}\n`);

      } else {
        console.log(`ℹ️  No active notifications to process`);
        this.printMemoryUsage(`Cycle ${this.cycleCount} - No Work`);
      }

    } catch (error) {
      console.error('Error in monitoring cycle:', error);
      this.printMemoryUsage('Cycle Error');
    }

    // Schedule next check
    this.monitoringTimer = setTimeout(() => {
      this.monitorClasses();
    }, this.checkInterval);
  }

  async processNotification(notification) {
    try {
      if (!notification.user_id || !notification.class_id) {
        console.warn(`⚠️  Invalid notification data: ${notification._id}`);
        return null;
      }

      const classStatus = await this.getClassStatus(notification.class_number);

      if (!classStatus) {
        console.warn(`⚠️  Could not get status for class: ${notification.class_number}`);
        return null;
      }

      // Print the class information to console
      this.printClassInformation(classStatus, notification.class_number);

      // Update notification record
      await Notification.findByIdAndUpdate(notification._id, {
        last_checked: new Date(),
        last_status: classStatus.seatStatus
      });

      let notificationSent = false;

      // Check if status changed from Closed to Open
      if (notification.last_status === 'Closed' && classStatus.seatStatus === 'Open') {
        console.log(`🎉 SEAT OPENED! Class ${notification.class_number} changed from Closed to Open!`);

        await this.sendNotificationEmail(notification, classStatus);

        // Update notification sent info
        await Notification.findByIdAndUpdate(notification._id, {
          notification_sent: new Date(),
          notification_count: notification.notification_count + 1
        });

        notificationSent = true;
        console.log(`📧 Email notification sent for class ${notification.class_number}`);
      } else if (notification.last_status === classStatus.seatStatus) {
        console.log(`ℹ️  No status change for class ${notification.class_number} (still ${classStatus.seatStatus})`);
      } else {
        console.log(`📝 Status updated for class ${notification.class_number}: ${notification.last_status} → ${classStatus.seatStatus}`);
      }

      return { classNumber: notification.class_number, status: classStatus.seatStatus, notificationSent };

    } catch (error) {
      console.error(`❌ Error processing notification ${notification._id}:`, error);
      return null;
    }
  }

  async getClassStatus(classNumber) {
    return new Promise((resolve) => {
      // Add to queue for rate limiting
      this.scriptCallQueue.push({
        classNumber,
        resolve,
        retries: 0,
        timestamp: Date.now()
      });
    });
  }

  async processScriptQueue() {
    while (this.isRunning) {
      if (this.scriptCallQueue.length > 0 && this.currentScriptCount < this.maxConcurrentScripts) {
        // Enforce minimum interval between script starts
        const timeSinceLastStart = Date.now() - this.lastScriptStartTime;
        if (timeSinceLastStart < this.minScriptInterval) {
          await this.sleep(this.minScriptInterval - timeSinceLastStart);
        }

        const { classNumber, resolve, retries, timestamp } = this.scriptCallQueue.shift();
        const queueWaitTime = Date.now() - timestamp;

        if (queueWaitTime > 1000) { // Log if waited more than 1 second in queue
          console.log(`⏱️  Class ${classNumber} waited ${queueWaitTime}ms in queue`);
        }

        this.currentScriptCount++;
        this.lastScriptStartTime = Date.now();
        console.log(`🐍 Running Python script for class ${classNumber} (${this.currentScriptCount}/${this.maxConcurrentScripts} active)`);

        this.executeClassScript(classNumber, resolve, retries);
      }

      await this.sleep(500); // Increased sleep time
    }
  }

  async executeClassScript(classNumber, resolve, retries) {
    const scriptStartTime = Date.now();
    const scriptStartMemory = this.getMemoryUsage();

    try {
      // Use absolute path for Python script - UPDATED FOR PLAYWRIGHT
      const scriptPath = path.join(__dirname, '..', 'scripts', 'get_class_info.py');
      const command = `python "${scriptPath}" "${classNumber}"`;

      // Create unique process environment to prevent browser conflicts
      const uniqueId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const tempDir = `/tmp/playwright_process_${uniqueId}`; // Changed from chrome_process
      
      // Ensure temp directory exists
      try {
        const fs = require('fs');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
      } catch (dirError) {
        console.warn(`Could not create temp dir ${tempDir}:`, dirError.message);
      }

      const env = {
        ...process.env,
        // Unique temp directory for this process
        TMPDIR: tempDir,
        XDG_RUNTIME_DIR: tempDir,
        XDG_CONFIG_HOME: tempDir,
        HOME: tempDir,
        // Playwright-specific isolation (removed Chrome-specific vars)
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright',
        // Display isolation
        DISPLAY: process.env.DISPLAY || ':99',
        // Process isolation
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1'
      };

      const { stdout, stderr } = await this.execAsync(command, { 
        timeout: 45000,   // Kept same timeout
        env: env,
        cwd: path.join(__dirname, '..'),
        killSignal: 'SIGKILL'   // Force kill if timeout
      });

      // Log the stderr from the Python script if it exists
      if (stderr && stderr.trim()) {
        console.error(`[PYTHON_STDERR - Class ${classNumber}]:\n${stderr}`);
      }

      const scriptEndTime = Date.now();
      const scriptDuration = scriptEndTime - scriptStartTime;
      const scriptEndMemory = this.getMemoryUsage();
      const memoryDelta = scriptEndMemory.rss - scriptStartMemory.rss;

      console.log(`⚡ Script completed for class ${classNumber} in ${scriptDuration}ms (memory delta: ${memoryDelta >= 0 ? '+' : ''}${memoryDelta.toFixed(2)}MB)`);

      // Clean up temp directory
      try {
        const fs = require('fs');
        const { execSync } = require('child_process');
        if (fs.existsSync(tempDir)) {
          execSync(`rm -rf "${tempDir}"`, { timeout: 5000 });
        }
      } catch (cleanupError) {
        console.warn(`Cleanup warning for ${tempDir}:`, cleanupError.message);
      }

      let classData;
      try {
        classData = JSON.parse(stdout);
      } catch (parseError) {
        console.error(`❌ JSON parse error for class ${classNumber}:`, parseError.message);
        console.error(`Raw stdout:`, stdout);
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }

      if (classData.error) {
        console.log(`❌ Script returned error for class ${classNumber}: ${classData.error}`);
        resolve(null);
      } else {
        resolve(classData);
      }

    } catch (error) {
      const scriptEndTime = Date.now();
      const scriptDuration = scriptEndTime - scriptStartTime;
      console.error(`❌ Error checking class ${classNumber} (${scriptDuration}ms):`, error.message);

      if (error.stderr) {
          console.error(`[PYTHON_ERROR_STDERR - Class ${classNumber}]:\n${error.stderr}`);
      }

      if (retries < this.maxRetries) {
        const retryDelay = Math.pow(2, retries) * 3000 + Math.random() * 1000; // Add jitter
        console.log(`🔄 Retrying class ${classNumber} in ${retryDelay}ms (attempt ${retries + 1}/${this.maxRetries})`);

        // Retry with exponential backoff + jitter
        setTimeout(() => {
          this.scriptCallQueue.push({
            classNumber,
            resolve,
            retries: retries + 1,
            timestamp: Date.now()
          });
        }, retryDelay);
      } else {
        console.error(`🚫 Max retries exceeded for class ${classNumber}`);
        resolve(null);
      }
    } finally {
      this.currentScriptCount--;
    }
  }

  async sendNotificationEmail(notification, classStatus) {
    if (!this.emailTransporter) {
      console.log('📧 Email transporter not available - skipping email notification');
      return;
    }

    try {
      const user = notification.user_id;
      const classInfo = notification.class_id;

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@classnotifier.com',
        to: user.email,
        subject: `🎉 Class Seat Available: ${classInfo.course} - ${classInfo.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50;">Great News! A Seat Opened Up!</h2>

            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3 style="color: #27ae60; margin-top: 0;">Class Information</h3>
              <p><strong>Course:</strong> ${classInfo.course}</p>
              <p><strong>Title:</b> ${classInfo.title}</p>
              <p><strong>Class Number:</strong> ${classInfo.number}</p>
              <p><strong>Instructor(s):</strong> ${classInfo.instructors.join(', ')}</p>
              ${classStatus.days ? `<p><strong>Days:</strong> ${classStatus.days}</p>` : ''}
              ${classStatus.startTime && classStatus.endTime ? `<p><strong>Time:</strong> ${classStatus.startTime} - ${classStatus.endTime}</p>` : ''}
              ${classStatus.location ? `<p><strong>Location:</strong> ${classStatus.location}</p>` : ''}
            </div>

            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="color: #27ae60; font-weight: bold; margin: 0;">
                ✅ Status: SEATS AVAILABLE
              </p>
            </div>

            <p style="color: #e74c3c; font-weight: bold;">
              Act fast! Seats can fill up quickly.
            </p>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ecf0f1;">
              <p style="color: #7f8c8d; font-size: 12px;">
                This notification was sent because you're tracking this class.
                You can manage your tracked classes in your account dashboard.
              </p>
            </div>
          </div>
        `
      };

      await this.emailTransporter.sendMail(mailOptions);
      console.log(`📧 Notification email sent to ${user.email} for class ${classInfo.number}`);

    } catch (error) {
      console.error('❌ Error sending notification email:', error);
    }
  }

  async handleClassAdded(userId, classId) {
    try {
      if (!Class || !Notification) {
        console.warn('Models not available - cannot handle class addition');
        return;
      }

      const classItem = await Class.findById(classId);
      if (!classItem) return;

      // Create notification tracking
      await Notification.create({
        user_id: userId,
        class_id: classId,
        class_number: classItem.number,
        last_status: 'Closed',
        is_active: true
      });

      console.log(`➕ Notification tracking added for class ${classItem.number}`);
      this.printMemoryUsage('Class Added');
    } catch (error) {
      console.error('Error handling class addition:', error);
    }
  }

  async handleClassRemoved(userId, classId) {
    try {
      if (!Notification) {
        console.warn('Notification model not available - cannot handle class removal');
        return;
      }

      await Notification.findOneAndUpdate(
        { user_id: userId, class_id: classId },
        { is_active: false }
      );

      console.log(`➖ Notification tracking deactivated for class ${classId}`);
      this.printMemoryUsage('Class Removed');
    } catch (error) {
      console.error('Error handling class removal:', error);
    }
  }

  async getNotificationStats() {
    try {
      if (!Notification) {
        return { totalActive: 0, totalNotificationsSent: 0, lastChecked: null };
      }

      const stats = await Notification.aggregate([
        { $match: { is_active: true } },
        {
          $group: {
            _id: null,
            totalActive: { $sum: 1 },
            totalNotificationsSent: { $sum: '$notification_count' },
            lastChecked: { $max: '$last_checked' }
          }
        }
      ]);

      return stats[0] || { totalActive: 0, totalNotificationsSent: 0, lastChecked: null };
    } catch (error) {
      console.error('Error getting notification stats:', error);
      return { totalActive: 0, totalNotificationsSent: 0, lastChecked: null };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
const notificationService = new NotificationService();

module.exports = { notificationService, Notification };