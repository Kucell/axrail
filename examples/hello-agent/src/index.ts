import { runHelloAgentExample } from "./example.js";

const result = await runHelloAgentExample();

console.log(result.content);
console.log("Final project:", result.project);
console.log("Audit events:", result.eventTypes);
