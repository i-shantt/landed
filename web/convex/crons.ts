import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Live-mode tick. In demo mode this still runs; it just sees demo time.
crons.interval("tick", { seconds: 30 }, internal.timers.tick, {});
export default crons;
