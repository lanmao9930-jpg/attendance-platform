const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ENV_ID = "attendance-platform-d1b99a89a6e3";
const collections = ["attendance_schedules", "attendance_schedule_history", "attendance_reviews", "attendance_checkins"];

function runTcb(args) {
  const command = process.platform === "win32"
    ? [process.execPath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")]
    : ["npx"];
  const result = spawnSync(command[0], [...command.slice(1), "--yes", "-p", "@cloudbase/cli", "tcb", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: "y\n",
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function configureRoute() {
  const data = {
    domain: "*",
    routes: [{
      path: "/",
      upstreamResourceType: "WEB_SCF",
      upstreamResourceName: "attendance-platform",
      enable: true,
      enableAuth: false,
      enablePathTransmission: true
    }]
  };
  runTcb(["routes", "edit", "-e", ENV_ID, "--data", JSON.stringify(data), "--json"]);
}

function createCollections() {
  const commands = collections.flatMap((name) => [
    {
      TableName: name,
      CommandType: "INSERT",
      Command: JSON.stringify({ insert: name, documents: [{ _id: "__setup__", setup: true }] })
    },
    {
      TableName: name,
      CommandType: "DELETE",
      Command: JSON.stringify({ delete: name, deletes: [{ q: { _id: "__setup__" }, limit: 1 }] })
    }
  ]);
  runTcb(["db", "nosql", "execute", "--command", JSON.stringify(commands), "-e", ENV_ID, "--json"]);
}

function cleanupCheckin(recordId, photoPath) {
  if (!recordId || !photoPath) throw new Error("recordId and photoPath are required");
  const commands = [{
    TableName: "attendance_checkins",
    CommandType: "DELETE",
    Command: JSON.stringify({
      delete: "attendance_checkins",
      deletes: [{ q: { _id: recordId }, limit: 1 }]
    })
  }];
  runTcb(["db", "nosql", "execute", "--command", JSON.stringify(commands), "-e", ENV_ID, "--json"]);
  runTcb(["storage", "rm", photoPath, "-e", ENV_ID, "--force", "--json"]);
}

function cleanupTest(recordId, scheduleId, photoPath) {
  if (!recordId || !scheduleId || !photoPath) {
    throw new Error("recordId, scheduleId and photoPath are required");
  }
  const commands = [
    {
      TableName: "attendance_checkins",
      CommandType: "DELETE",
      Command: JSON.stringify({
        delete: "attendance_checkins",
        deletes: [{ q: { _id: recordId }, limit: 1 }]
      })
    },
    {
      TableName: "attendance_schedules",
      CommandType: "DELETE",
      Command: JSON.stringify({
        delete: "attendance_schedules",
        deletes: [{ q: { _id: scheduleId }, limit: 1 }]
      })
    },
    {
      TableName: "attendance_reviews",
      CommandType: "DELETE",
      Command: JSON.stringify({
        delete: "attendance_reviews",
        deletes: [{ q: { _id: scheduleId }, limit: 1 }]
      })
    }
  ];
  runTcb(["db", "nosql", "execute", "--command", JSON.stringify(commands), "-e", ENV_ID, "--json"]);
  runTcb(["storage", "rm", photoPath, "-e", ENV_ID, "--force", "--json"]);
}

const action = process.argv[2];
if (action === "route") configureRoute();
else if (action === "collections") createCollections();
else if (action === "cleanup-checkin") cleanupCheckin(process.argv[3], process.argv[4]);
else if (action === "cleanup-test") cleanupTest(process.argv[3], process.argv[4], process.argv[5]);
else throw new Error("Usage: node scripts/cloudbase-setup.js <route|collections|cleanup-checkin|cleanup-test>");
