// scripts/scheduledClassUpdate.js
const mongoose = require('mongoose');
const { exec } = require('child_process');
const path = require('path');
const util = require('util');

// Import your models
const Class = require('../models/classModel');
const connectDb = require('../config/dbConnection');

const execAsync = util.promisify(exec);

// Semester start dates (you'll need to update these each year)
const SEMESTER_DATES = {
  spring: {
    start: new Date('2025-01-13'), // Adjust for actual ASU spring 2025 start
    preUpdate: new Date('2025-01-06'), // One week before
    finalUpdate: new Date('2025-01-13') // Day of classes
  },
  summer: {
    start: new Date('2025-05-19'), // Adjust for actual ASU summer 2025 start
    preUpdate: new Date('2025-05-12'),
    finalUpdate: new Date('2025-05-19')
  },
  fall: {
    start: new Date('2025-08-21'), // Adjust for actual ASU fall 2025 start
    preUpdate: new Date('2025-08-14'),
    finalUpdate: new Date('2025-08-21')
  }
};

const getCurrentSemester = () => {
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11
  
  if (currentMonth >= 0 && currentMonth <= 4) {
    return 'spring';
  } else if (currentMonth >= 5 && currentMonth <= 7) {
    return 'summer';
  } else {
    return 'fall';
  }
};

const shouldRunUpdate = (updateType = 'pre') => {
  const now = new Date();
  const semester = getCurrentSemester();
  const semesterData = SEMESTER_DATES[semester];
  
  if (!semesterData) return false;
  
  const targetDate = updateType === 'pre' ? semesterData.preUpdate : semesterData.finalUpdate;
  
  // Check if today is the target date (within 24 hours)
  const diffInHours = Math.abs(now - targetDate) / (1000 * 60 * 60);
  
  return diffInHours < 24;
};

const addUpdateTracking = async (classId, updateType, success, fieldsUpdated = []) => {
  try {
    await Class.findByIdAndUpdate(classId, {
      $push: {
        updateHistory: {
          date: new Date(),
          type: updateType,
          success: success,
          fieldsUpdated: fieldsUpdated
        }
      },
      lastInfoUpdate: new Date(),
      $inc: { infoUpdateAttempts: 1 }
    });
  } catch (error) {
    console.error('Error adding update tracking:', error);
  }
};

const scheduledClassUpdate = async (updateType = 'pre') => {
  try {
    console.log(`Starting ${updateType} semester update...`);
    
    // Connect to database
    await connectDb();
    console.log('Connected to database');

    // Check if we should run today
    if (!shouldRunUpdate(updateType)) {
      console.log(`Not scheduled to run ${updateType} update today`);
      process.exit(0);
    }

    // Find classes with missing or TBD information
    const classesToUpdate = await Class.find({
      $or: [
        { location: { $in: ["N/A", "TBD", "To Be Determined"] } },
        { days: { $in: ["N/A", "TBD", "To Be Determined"] } },
        { dates: { $in: ["N/A", "TBD", "To Be Determined"] } },
        { units: { $in: ["N/A", "TBD", "To Be Determined"] } },
        { time: { $in: ["N/A", "TBD", "To Be Determined"] } },
        { location: { $regex: /tbd|to be determined/i } },
        { days: { $regex: /tbd|to be determined/i } },
        { dates: { $regex: /tbd|to be determined/i } },
        { units: { $regex: /tbd|to be determined/i } },
        { time: { $regex: /tbd|to be determined/i } }
      ]
    });

    console.log(`Found ${classesToUpdate.length} classes with missing information`);

    if (classesToUpdate.length === 0) {
      console.log('No classes need updating');
      process.exit(0);
    }

    let updatedCount = 0;
    let errorCount = 0;
    let noChangeCount = 0;

    for (const classItem of classesToUpdate) {
      try {
        console.log(`[${updateType}] Updating class ${classItem.number} (${classItem.course})...`);
        
        // Get updated info from the script
        const scriptPath = path.join(__dirname, 'get_class_info.py');
        const command = `python "${scriptPath}" "${classItem.number}"`;
        
        const { stdout } = await execAsync(command, { timeout: 30000 });
        
        if (!stdout || stdout.trim() === '') {
          console.log(`No data returned for class ${classItem.number}`);
          await addUpdateTracking(classItem._id, updateType, false);
          errorCount++;
          continue;
        }

        const updatedData = JSON.parse(stdout);
        
        if (updatedData.error) {
          console.log(`Error fetching data for class ${classItem.number}`);
          await addUpdateTracking(classItem._id, updateType, false);
          errorCount++;
          continue;
        }

        // Prepare update object - only update fields that were missing
        const updateFields = {};
        const fieldsToCheck = ['days', 'location', 'dates', 'units'];
        
        fieldsToCheck.forEach(field => {
          const currentValue = classItem[field];
          const newValue = updatedData[field];
          
          if (currentValue && 
              (currentValue === "N/A" || 
               currentValue.toLowerCase().includes("tbd") || 
               currentValue.toLowerCase().includes("to be determined")) &&
              newValue && newValue !== "N/A") {
            updateFields[field] = newValue;
          }
        });

        // Update time if we have better data
        if (updatedData.startTime && updatedData.endTime && 
            updatedData.startTime !== "N/A" && updatedData.endTime !== "N/A") {
          const currentTime = classItem.time;
          if (currentTime === "N/A" || 
              currentTime.toLowerCase().includes("tbd") || 
              currentTime.toLowerCase().includes("to be determined")) {
            updateFields.time = `${updatedData.startTime} - ${updatedData.endTime}`;
          }
        }

        // Always update seat status
        updateFields.seatStatus = updatedData.seatStatus;

        const fieldsUpdated = Object.keys(updateFields).filter(key => key !== 'seatStatus');
        
        if (fieldsUpdated.length > 0) {
          await Class.findByIdAndUpdate(classItem._id, updateFields);
          await addUpdateTracking(classItem._id, updateType, true, fieldsUpdated);
          console.log(`✅ Updated ${classItem.number} with: ${fieldsUpdated.join(', ')}`);
          updatedCount++;
        } else {
          // Just update seat status
          await Class.findByIdAndUpdate(classItem._id, { seatStatus: updatedData.seatStatus });
          await addUpdateTracking(classItem._id, updateType, true, []);
          console.log(`ℹ️  No new info for ${classItem.number} (seat status updated)`);
          noChangeCount++;
        }

        // Be nice to the server - longer delay for pre-semester updates
        const delay = updateType === 'pre' ? 2000 : 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        console.error(`❌ Error updating class ${classItem.number}:`, error);
        await addUpdateTracking(classItem._id, updateType, false);
        errorCount++;
      }
    }

    console.log(`\n${updateType.toUpperCase()} UPDATE COMPLETE:`);
    console.log(`✅ Successfully updated: ${updatedCount} classes`);
    console.log(`ℹ️  No changes needed: ${noChangeCount} classes`);
    console.log(`❌ Errors: ${errorCount} classes`);
    console.log(`📊 Total processed: ${updatedCount + noChangeCount + errorCount} classes`);

  } catch (error) {
    console.error('Error in scheduled update:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

// Check command line arguments
const updateType = process.argv[2] || 'pre'; // 'pre' or 'final'

if (!['pre', 'final'].includes(updateType)) {
  console.error('Usage: node scheduledClassUpdate.js [pre|final]');
  process.exit(1);
}

// Run the update
scheduledClassUpdate(updateType);