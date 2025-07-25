// Fixed classController.js
const asyncHandler = require("express-async-handler");
const { exec } = require("child_process");
const Class = require("../models/classModel");
const path = require("path");

// Import notification service with error handling
let notificationService;
try {
  notificationService = require("../services/notificationService").notificationService;
} catch (error) {
  console.error("Error importing notification service:", error);
  notificationService = null;
}

//@desc Get all classes
//@routes GET /api/classes
//@access Private
const getClasses = asyncHandler(async (req, res) => {
  const classes = await Class.find({ user_id: req.user.id });
  res.status(200).json(classes);
});

//@desc Create new class
//@routes POST /api/classes
//@access Private
const createClass = asyncHandler(async (req, res) => {
  console.log("The request body is: ", req.body);
  
  // Check if this is a manual entry or lookup-based entry
  const { 
    course, 
    title, 
    number, 
    instructors,
    days,
    time,
    location,
    dates,
    units,
    seatStatus,
    isLookupBased = false
  } = req.body;

  // For lookup-based entries, we might get startTime and endTime separately
  let combinedTime = time;
  if (req.body.startTime && req.body.endTime) {
    combinedTime = `${req.body.startTime} - ${req.body.endTime}`;
  }

  // Basic validation
  if (!course || !title || !number || !instructors) {
    res.status(400);
    throw new Error("Please provide all required class details (course, title, number, instructors)");
  }

  // Create the class object with all available fields
  const classData = {
    course,
    title,
    number,
    instructors,
    user_id: req.user.id,
    // Optional fields with defaults
    days: days || "N/A",
    time: combinedTime || "N/A",
    location: location || "N/A",
    dates: dates || "N/A",
    units: units || "N/A",
    seatStatus: seatStatus || "Closed"
  };

  const newClass = await Class.create(classData);

  // Only add to notification tracking if service is available
  if (notificationService) {
    try {
      await notificationService.handleClassAdded(req.user.id, newClass._id);
    } catch (error) {
      console.error("Error adding class to notification tracking:", error);
      // Don't fail the request if notification service fails
    }
  }

  res.status(201).json(newClass);
});

//@desc Get class by ID
//@routes GET /api/classes/:id
//@access Private
const getClass = asyncHandler(async (req, res) => {
  try {
    const singleClass = await Class.findById(req.params.id);
    if (!singleClass) {
      res.status(404);
      throw new Error("Class not found");
    }

    // Check if user owns this class
    if (singleClass.user_id.toString() !== req.user.id) {
      res.status(403);
      throw new Error("User doesn't have permission to access this class");
    }

    res.status(200).json(singleClass);
  } catch (error) {
    console.error("Error in getClass:", error);
    if (error.name === 'CastError') {
      res.status(400);
      throw new Error("Invalid class ID format");
    }
    throw error;
  }
});

//@desc Update class
//@routes PUT /api/classes/:id
//@access Private
const updateClass = asyncHandler(async (req, res) => {
  const singleClass = await Class.findById(req.params.id);
  if (!singleClass) {
    res.status(404);
    throw new Error("Class not found");
  }

  if (singleClass.user_id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("User doesn't have permission to update this class");
  }

  const updatedClass = await Class.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );
  res.status(200).json(updatedClass);
});

//@desc Delete class
//@routes DELETE /api/classes/:id
//@access Private
const deleteClass = asyncHandler(async (req, res) => {
  const singleClass = await Class.findById(req.params.id);
  if (!singleClass) {
    res.status(404);
    throw new Error("Class not found");
  }

  if (singleClass.user_id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("User doesn't have permission to delete this class");
  }

  // Remove from notification tracking
  if (notificationService) {
    try {
      await notificationService.handleClassRemoved(req.user.id, req.params.id);
    } catch (error) {
      console.error("Error removing class from notification tracking:", error);
      // Don't fail the request if notification service fails
    }
  }

  await singleClass.deleteOne({ _id: req.params.id });
  res.status(200).json(singleClass);
});

//@desc Lookup class by number (using Python script)
//@routes POST /api/classes/lookup
//@access Private
const lookupClass = asyncHandler(async (req, res) => {
  const { number } = req.body;
  if (!number) {
    return res.status(400).json({ message: "Class number is required" });
  }

  // Wrap exec in a Promise with better error handling
  const execPromise = (command) =>
    new Promise((resolve, reject) => {
      exec(command, { timeout: 45000 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Exec error: ${error}`);
          console.error(`Stderr: ${stderr}`);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });

  try {
    // Use absolute path for Python script
    const scriptPath = path.join(__dirname, '..', 'scripts', 'get_class_info.py');
    const command = `python3 "${scriptPath}" "${number}"`;  // CHANGED: python -> python3
    
    console.log(`Executing command: ${command}`);
    
    const stdout = await execPromise(command);
    
    if (!stdout || stdout.trim() === '') {
      return res.status(404).json({ message: "No data returned from class lookup" });
    }

    let classData;
    try {
      classData = JSON.parse(stdout);
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      console.error("Raw stdout:", stdout);
      return res.status(500).json({ message: "Error parsing class data" });
    }

    if (classData.error) {
      return res.status(404).json({ message: "Class not found" });
    }

    return res.status(200).json({
      number: classData.number,
      course: classData.course,
      title: classData.title,
      instructors: classData.instructors,
      seatStatus: classData.seatStatus,
      days: classData.days,
      startTime: classData.startTime,
      endTime: classData.endTime,
      location: classData.location,
      dates: classData.dates,
      units: classData.units
    });
  } catch (error) {
    console.error("Error in lookupClass:", error);
    return res.status(500).json({ 
      message: "Failed to fetch class info",
      error: error.message 
    });
  }
});

//@desc Get notification stats
//@routes GET /api/classes/notifications/stats
//@access Private
const getNotificationStats = asyncHandler(async (req, res) => {
  if (!notificationService) {
    return res.status(503).json({ 
      message: "Notification service not available",
      stats: { totalActive: 0, totalNotificationsSent: 0, lastChecked: null }
    });
  }

  try {
    const stats = await notificationService.getNotificationStats();
    res.status(200).json(stats);
  } catch (error) {
    console.error("Error getting notification stats:", error);
    res.status(500).json({ 
      message: "Error retrieving notification stats",
      stats: { totalActive: 0, totalNotificationsSent: 0, lastChecked: null }
    });
  }
});

module.exports = {
  getClasses,
  createClass,
  getClass,
  updateClass,
  deleteClass,
  lookupClass,
  getNotificationStats
};