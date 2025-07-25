const mongoose = require('mongoose');

const classSchema = mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    course: {
      type: String,
      required: [true, "Please add the course name"],
    },
    title: {
      type: String,
      required: [true, "Please add the class title"],
    },
    number: {
      type: String,
      required: [true, "Please add the class number"],
    },
    instructors: {
      type: [String], 
      required: [true, "Please add at least one instructor"],
    },
    days: {
      type: String,
      required: false,
      default: "N/A"
    },
    time: {
      type: String,
      required: false,
      default: "N/A"
    },
    location: {
      type: String,
      required: false,
      default: "N/A"
    },
    dates: {
      type: String,
      required: false,
      default: "N/A"
    },
    units: {
      type: String,
      required: false,
      default: "N/A"
    },
    seatStatus: {
      type: String,
      enum: ["Open", "Closed"],
      required: false,
      default: "Closed"
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Class", classSchema);