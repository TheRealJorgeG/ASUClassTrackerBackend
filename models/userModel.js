const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
    email: {
        type: String,
        required: [true, "Please add the email"],
        unique: [true, "Email already exists"],
    },
    password: {
        type: String,
        required: [true, "Please add the password"],
    },
    trackedClasses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Class",
    }],
    resetPasswordToken: {
        type: String,
        default: undefined
    },
    resetPasswordExpires: {
        type: Date,
        default: undefined
    }
}, {
    timestamps: true,
});

module.exports = mongoose.model("User", userSchema);