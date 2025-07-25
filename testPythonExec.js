const { exec } = require("child_process");

const classNumber = "87659";
const command = `python scripts/get_class_info.py ${classNumber}`;

exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
  if (error) {
    console.error("Exec error:", error);
    return;
  }
  console.log("STDOUT:", stdout);
  console.error("STDERR:", stderr);
});
