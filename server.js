import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import { OpenAI } from "openai";
import { openai } from "./config/openaiConfig.js";
import * as cheerio from "cheerio";
import { safeJqlTemplates } from "./config/jiraConfig.js";
import { fallbackGenerateJQL, generateJQL, getProjectStatusOverview, getMostRecentTaskDetails } from "./services/jiraService.js";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";
import { analyzeQueryIntent } from "./services/intentService.js";
import { getConversationMemory, updateConversationMemory, conversationMemory } from "./memory/conversationMemory.js";
import { getUserContext, detectFollowUpQuery, applyUserContext, getPersonalizedSystemPrompt } from "./memory/userContext.js";
import { 
  createJiraLink,
  createJiraFilterLink,
  sanitizeJql,
  extractTextFromADF,
  preprocessQuery,
  determineFieldsForIntent,

 } from "./utils/jiraUtils.js";

// Load environment variables
dotenv.config();

const app = express();
const port = 3000;
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "IHKA"; // Your project key

const CONFLUENCE_MAIN_PAGE_ID = process.env.CONFLUENCE_MAIN_PAGE_ID || "4624646162";
const CONFLUENCE_AUTO_INDEX = process.env.CONFLUENCE_AUTO_INDEX === "true";



// CORS setup
app.use(cors());
app.use(express.json());

// Serve static files from Vite build
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "dist")));

// Jira auth configuration
const JIRA_URL = process.env.JIRA_URL;
console.log("JIRA_URL", JIRA_URL);

const JIRA_USER = process.env.JIRA_USER;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const auth = {
  username: JIRA_USER,
  password: JIRA_API_TOKEN,
};

console.log("process.env.JIRA_PROJECT_KEY", process.env.JIRA_PROJECT_KEY);


// // Enhanced fallback JQL generator
// function fallbackGenerateJQL(query, intent) {
//   console.log("Using fallback JQL generation for query:", query, "with intent:", intent);

//   // Look for keywords to determine the right fallback
//   query = query.toLowerCase();

//   // Try to match intent to a safe template first
//   if (intent === "PROJECT_STATUS") return safeJqlTemplates.PROJECT_STATUS;
//   if (intent === "TASK_LIST" && /(how many|count|number of).*(high|highest|important|critical|priority).*(tasks|issues|tickets)/i.test(query)) return safeJqlTemplates.HIGH_PRIORITY_COUNT;
//   if (intent === "TIMELINE") return safeJqlTemplates.TIMELINE;
//   if (intent === "BLOCKERS") return safeJqlTemplates.BLOCKERS;
//   if (intent === "TASK_LIST" && /open|active|current/i.test(query)) return safeJqlTemplates.OPEN_TASKS;
//   if (intent === "TASK_LIST" && /closed|completed|done|resolved/i.test(query)) return safeJqlTemplates.CLOSED_TASKS;
//   if (intent === "TASK_LIST" && /high|highest|important|critical|priority/i.test(query)) return safeJqlTemplates.HIGH_PRIORITY;
//   if (intent === "TASK_LIST" && /highest priority (task|issue|ticket)/i.test(query)) return safeJqlTemplates.HIGHEST_PRIORITY_SINGLE;
//   if (intent === "TASK_LIST" && /unassigned|without assignee/i.test(query)) return safeJqlTemplates.UNASSIGNED_TASKS;
//   if (intent === "ASSIGNED_TASKS") return safeJqlTemplates.ASSIGNED_TASKS;
//   if (intent === "SPRINT") return safeJqlTemplates.CURRENT_SPRINT;
//   if (intent === "WORKLOAD") return safeJqlTemplates.ASSIGNED_TASKS;
//   if (intent === "ISSUE_TYPES") return safeJqlTemplates.ISSUE_TYPES;

//   // Extract any issue key that might be in the query
//   const issueKeyMatch = query.match(new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i"));
//   if (issueKeyMatch) {
//     return `key = "${issueKeyMatch[0]}"`;
//   }

//   // If no intent match or issue key, look for keywords in the query
//   if (/(?:work|issue|task)\s+types?|types? of work|categories/i.test(query)) return safeJqlTemplates.ISSUE_TYPES;
//   if (/timeline|deadline|due|schedule/i.test(query)) return safeJqlTemplates.TIMELINE;
//   if (/blocker|blocking|impediment|risk/i.test(query)) return safeJqlTemplates.BLOCKERS;
//   if (/high|priority|important|urgent|critical/i.test(query)) return safeJqlTemplates.HIGH_PRIORITY;
//   if (/open|active|current/i.test(query) && /task|issue|ticket/i.test(query)) return safeJqlTemplates.OPEN_TASKS;
//   if (/closed|completed|done|resolved/i.test(query)) return safeJqlTemplates.CLOSED_TASKS;
//   if (/assign|work|responsible/i.test(query)) return safeJqlTemplates.ASSIGNED_TASKS;
//   if (/recent|latest|new|update/i.test(query)) return safeJqlTemplates.RECENT_UPDATES;
//   if (/sprint/i.test(query)) return safeJqlTemplates.CURRENT_SPRINT;

//   // Extract assignee if present
//   const assigneeMatch = query.match(/assigned to (\w+)|(\w+)'s tasks/i);
//   if (assigneeMatch) {
//     const assignee = assigneeMatch[1] || assigneeMatch[2];
//     return `project = "${process.env.JIRA_PROJECT_KEY}" AND assignee ~ "${assignee}" ORDER BY updated DESC`;
//   }

//   // Default fallback - return open issues ordered by update date
//   return safeJqlTemplates.PROJECT_STATUS;
// }

// Enhanced intent analysis for more precise query understanding
// async function analyzeQueryIntent(query) {
//   // Store original query for logging
//   const originalQuery = query;

//   // Preprocess the query
//   query = query.trim().toLowerCase();

//   // First check for exact pattern matches we can directly classify with high confidence
//   if (/sprint|current sprint|active sprint|sprint status|sprint board/i.test(query)) {
//     console.log(`Direct match: "${originalQuery}" -> SPRINT`);
//     return "SPRINT";
//   }

//   if (/^(?:hi|hello|hey|hi there|greetings|how are you|what can you do|what do you do|help me|how do you work)/i.test(query.trim())) {
//     console.log(`Direct match: "${originalQuery}" -> GREETING`);
//     return "GREETING";
//   }

//   // Check for issue type related queries
//   if (/(?:work|issue|task)\s+types?|types? of (?:work|issue|task)|(?:what|which) (?:work|issue|task) types?/i.test(query)) {
//     console.log(`Direct match: "${originalQuery}" -> ISSUE_TYPES`);
//     return "ISSUE_TYPES";
//   }

//   const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
//   if (issueKeyPattern.test(query) && /^(?:show|tell|get|what is|about) ${process.env.JIRA_PROJECT_KEY}-\d+$/i.test(query.trim())) {
//     console.log(`Direct match: "${originalQuery}" -> TASK_DETAILS`);
//     return "TASK_DETAILS";
//   }

//   // Common pattern sets with confidence ranking for precise intent detection
//   const intentPatterns = [
//     {
//       intent: "PROJECT_STATUS",
//       highConfidencePatterns: [
//         /^(?:what|how) is (?:the |our )?project(?:'s)? (?:status|health|progress)/i,
//         /^(?:give|show) me (?:the |a )?project (?:status|overview|summary|health)/i,
//         /^project (?:status|health|overview|summary)$/i,
//       ],
//       mediumConfidencePatterns: [/status|progress|overview|health|how is the project/i],
//     },
//     {
//       intent: "TIMELINE",
//       highConfidencePatterns: [
//         /^(?:what|show) is (?:the |our )?(?:timeline|roadmap|schedule|calendar)/i,
//         /^(?:when|what) is (?:due|upcoming|planned|scheduled)/i,
//         /^(?:show|display) (?:the |our )?(?:timeline|roadmap|schedule|deadlines)/i,
//       ],
//       mediumConfidencePatterns: [/timeline|roadmap|schedule|deadline|due date|when|calendar/i],
//     },
//     {
//       intent: "BLOCKERS",
//       highConfidencePatterns: [
//         /^(?:what|any|show) (?:is|are) (?:blocking|blockers|impediments|obstacles)/i,
//         /^(?:show|list|find|get) (?:all |the |)?blockers/i,
//         /^(?:what|anything) (?:preventing|stopping|holding up) (?:the |our )?(?:progress|project|work)/i,
//       ],
//       mediumConfidencePatterns: [/block|blocker|blocking|stuck|impediment|obstacle|risk|critical|prevent/i],
//     },
//     {
//       intent: "WORKLOAD",
//       highConfidencePatterns: [
//         /^(?:what|how) is (?:the |our )?(?:team'?s?|team member'?s?) (?:workload|capacity|bandwidth)/i,
//         /^(?:who|which team member) (?:has|is) (?:too much|overloaded|busy|free|available)/i,
//         /^(?:show|display) (?:the |team |)?workload/i,
//       ],
//       mediumConfidencePatterns: [/workload|capacity|bandwidth|overloaded|busy|who.*working|team.* work/i],
//     },
//     {
//       intent: "ASSIGNED_TASKS",
//       highConfidencePatterns: [
//         /^(?:what|which|show) (?:tasks?|issues?|tickets?) (?:is|are) (?:assigned to|owned by) ([a-z]+)/i,
//         /^(?:what|show me) (?:is|are) ([a-z]+) working on/i,
//         /^(?:who|show) (?:is|are) (?:responsible for|assigned to|working on)/i,
//       ],
//       mediumConfidencePatterns: [/assign|working on|responsible|owner|who is|who's/i],
//     },
//     {
//       intent: "TASK_LIST",
//       highConfidencePatterns: [
//         /^(?:show|list|find|get) (?:all |the |)?(?:open|active|current|closed|completed|done|high priority) (?:tasks|issues|tickets)/i,
//         /^(?:what|which|list|get|show) (?:tasks|issues|tickets) (?:are|have)/i,
//         /^(?:show|list|find|get|what is|which is|what are|which are) (?:the |all |a )?(?:open|active|current|closed|completed|done|high priority|highest priority) (?:tasks|issues|tickets)/i,
//         /^(?:show|list|find|get|what is|which is) (?:the |a )?(?:open|active|current|closed|completed|done|high priority) (?:task|issue|ticket)/i,
//       ],
//       mediumConfidencePatterns: [/list|show|find|search|get|all|open|closed|high|task|issue|ticket/i],
//     },
//     {
//       intent: "TASK_DETAILS",
//       highConfidencePatterns: [
//         /^(?:tell|show|describe|what) (?:me |is |)?(?:about |details (?:for|about) )?${process.env.JIRA_PROJECT_KEY}-\d+/i,
//         /^${process.env.JIRA_PROJECT_KEY}-\d+/i,
//       ],
//       mediumConfidencePatterns: [new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i")],
//     },
//     {
//       intent: "COMMENTS",
//       highConfidencePatterns: [
//         /^(?:show|get|what|any) (?:comments|updates|activity) (?:on|for|about) ${process.env.JIRA_PROJECT_KEY}-\d+/i,
//         /^(?:what|who) (?:did|has) (?:someone|anyone|people|team) (?:say|comment|mention|note) (?:about|on|regarding)/i,
//       ],
//       mediumConfidencePatterns: [/comment|said|mentioned|update|notes/i],
//     },
//     {
//       intent: "SPRINT",
//       highConfidencePatterns: [
//         /^(?:how|what) is (?:the |our |current )?sprint/i,
//         /^(?:show|display|current) sprint/i,
//         /^sprint (?:status|progress|overview|details)/i,
//       ],
//       mediumConfidencePatterns: [/sprint/i],
//     },
//   ];

//   // Try to match against high confidence patterns first
//   for (const patternSet of intentPatterns) {
//     for (const pattern of patternSet.highConfidencePatterns) {
//       if (pattern.test(query)) {
//         console.log(`High confidence match: "${originalQuery}" -> ${patternSet.intent}`);
//         return patternSet.intent;
//       }
//     }
//   }

//   // Then try medium confidence patterns
//   let matchedIntents = [];
//   for (const patternSet of intentPatterns) {
//     for (const pattern of patternSet.mediumConfidencePatterns) {
//       if (pattern.test(query)) {
//         matchedIntents.push(patternSet.intent);
//         break; // Only add each intent once
//       }
//     }
//   }

//   // If we have one match, return it
//   if (matchedIntents.length === 1) {
//     console.log(`Medium confidence match: "${originalQuery}" -> ${matchedIntents[0]}`);
//     return matchedIntents[0];
//   }

//   // If we have multiple matches, try using AI to disambiguate
//   if (matchedIntents.length > 1) {
//     try {
//       console.log(`Multiple possible intents for "${originalQuery}": ${matchedIntents.join(", ")}. Using AI to disambiguate.`);

//       const response = await openai.chat.completions.create({
//         model: "gpt-4",
//         messages: [
//           {
//             role: "system",
//             content: `
//               You classify Jira-related questions into specific intent categories. 
//               Analyze the query carefully and return ONLY ONE of these categories:
              
//               - PROJECT_STATUS: Questions about overall project health, progress, metrics
//                 Examples: "How's the project going?", "What's our current status?", "Give me a project overview"
                
//               - TASK_LIST: Requests for lists of tasks matching certain criteria
//                 Examples: "Show me all open bugs", "List the high priority tasks", "What tasks are due this week?"
                
//               - ASSIGNED_TASKS: Questions about who is working on what
//                 Examples: "What is John working on?", "Show me Sarah's tasks", "Who's responsible for the login feature?"
                
//               - TASK_DETAILS: Questions about specific tickets or issues
//                 Examples: "Tell me about PROJ-123", "What's the status of the payment feature?", "Who's working on the homepage redesign?"
                
//               - BLOCKERS: Questions about impediments or high-priority issues
//                 Examples: "What's blocking us?", "Are there any critical issues?", "What should we focus on fixing first?"
                
//               - TIMELINE: Questions about deadlines, due dates, or project schedule
//                 Examples: "What's due this week?", "When will feature X be done?", "Show me upcoming deadlines"
                
//               - COMMENTS: Questions looking for updates, comments, or recent activity
//                 Examples: "Any updates on PROJ-123?", "What did John say about the login issue?", "Latest comments on the API task?"
                
//               - WORKLOAD: Questions about team capacity and individual workloads
//                 Examples: "Who has the most tasks?", "Is anyone overloaded?", "How's the team's capacity looking?"
                
//               - SPRINT: Questions about sprint status and activity
//                 Examples: "How's the current sprint?", "What's in this sprint?", "Sprint progress"

//               - ISSUE_TYPES: Questions about the types of work items in the project
//                 Examples: "What work types exist in the project?", "Show me the issue types", "What kind of tasks do we have?"
                
//               - GENERAL: General questions that don't fit other categories
//                 Examples: "Help me with Jira", "What can you do?", "How does this work?"
                
//               - CONVERSATION: Follow-up questions, clarifications, or conversational exchanges
//                 Examples: "Can you explain more?", "Thanks for that info", "That's not what I meant"
              
//               The system has already identified these as potential intents: ${matchedIntents.join(", ")}
//               Please select the MOST APPROPRIATE intent from these options only. Return ONLY the intent name.
//             `,
//           },
//           { role: "user", content: query },
//         ],
//         temperature: 0.1,
//       });

//       const selectedIntent = response.choices[0].message.content.trim();

//       // Make sure the AI returned one of our valid intents
//       if (matchedIntents.includes(selectedIntent)) {
//         console.log(`AI disambiguated: "${originalQuery}" -> ${selectedIntent}`);
//         return selectedIntent;
//       } else {
//         console.log(`AI returned invalid intent: ${selectedIntent}. Falling back to first matched intent.`);
//         return matchedIntents[0];
//       }
//     } catch (error) {
//       console.error("Error using AI to disambiguate intent:", error);
//       // In case of error, return the first matched intent
//       console.log(`Falling back to first matched intent: "${originalQuery}" -> ${matchedIntents[0]}`);
//       return matchedIntents[0];
//     }
//   }

//   // If we still don't have a match, try AI for the full query
//   try {
//     console.log(`No pattern matches for "${originalQuery}". Using AI for full intent analysis.`);

//     const response = await openai.chat.completions.create({
//       model: "gpt-4",
//       messages: [
//         {
//           role: "system",
//           content: `
//             You classify Jira-related questions into specific intent categories. 
//             Analyze the query carefully and return ONLY ONE of these categories:
            
//             - PROJECT_STATUS: Questions about overall project health, progress, metrics
//               Examples: "How's the project going?", "What's our current status?", "Give me a project overview"
              
//             - TASK_LIST: Requests for lists of tasks matching certain criteria
//               Examples: "Show me all open bugs", "List the high priority tasks", "What tasks are due this week?"
              
//             - ASSIGNED_TASKS: Questions about who is working on what
//               Examples: "What is John working on?", "Show me Sarah's tasks", "Who's responsible for the login feature?"
              
//             - TASK_DETAILS: Questions about specific tickets or issues
//               Examples: "Tell me about PROJ-123", "What's the status of the payment feature?", "Who's working on the homepage redesign?"
              
//             - BLOCKERS: Questions about impediments or high-priority issues
//               Examples: "What's blocking us?", "Are there any critical issues?", "What should we focus on fixing first?"
              
//             - TIMELINE: Questions about deadlines, due dates, or project schedule
//               Examples: "What's due this week?", "When will feature X be done?", "Show me upcoming deadlines"
              
//             - COMMENTS: Questions looking for updates, comments, or recent activity
//               Examples: "Any updates on PROJ-123?", "What did John say about the login issue?", "Latest comments on the API task?"
              
//             - WORKLOAD: Questions about team capacity and individual workloads
//               Examples: "Who has the most tasks?", "Is anyone overloaded?", "How's the team's capacity looking?"
              
//             - SPRINT: Questions about sprint status and activity
//               Examples: "How's the current sprint?", "What's in this sprint?", "Sprint progress"

//             - ISSUE_TYPES: Questions about the types of work items in the project
//               Examples: "What work types exist in the project?", "Show me the issue types", "What kind of tasks do we have?"
              
//             - GENERAL: General questions that don't fit other categories
//               Examples: "Help me with Jira", "What can you do?", "How does this work?"
              
//             - CONVERSATION: Follow-up questions, clarifications, or conversational exchanges
//               Examples: "Can you explain more?", "Thanks for that info", "That's not what I meant"
//           `,
//         },
//         { role: "user", content: query },
//       ],
//       temperature: 0.1,
//     });

//     const aiIntent = response.choices[0].message.content.trim();
//     console.log(`AI intent analysis: "${originalQuery}" -> ${aiIntent}`);
//     return aiIntent;
//   } catch (error) {
//     console.error("Error analyzing query intent with AI:", error);

//     // Ultimate fallback: keyword-based detection
//     console.log(`Falling back to keyword-based detection for "${originalQuery}"`);

//     // NEW: Check for issue type related queries in fallback
//     if (/(?:work|issue|task)\s+types?|types? of (?:work|issue|task)/i.test(query)) {
//       return "ISSUE_TYPES";
//     } else if (/timeline|roadmap|schedule|deadline|due date|what.* due|calendar|when/i.test(query)) {
//       return "TIMELINE";
//     } else if (/block|blocker|blocking|stuck|impediment|obstacle|risk|critical/i.test(query)) {
//       return "BLOCKERS";
//     } else if (/assign|working on|responsible|owner|who is|who's/i.test(query)) {
//       return "ASSIGNED_TASKS";
//     } else if (/status|progress|update|how is|how's|overview/i.test(query)) {
//       return "PROJECT_STATUS";
//     } else if (/list|show|find|search|get|all/i.test(query)) {
//       return "TASK_LIST";
//     } else if (/comment|said|mentioned|update|notes/i.test(query)) {
//       return "COMMENTS";
//     } else if (/workload|capacity|bandwidth|overloaded|busy/i.test(query)) {
//       return "WORKLOAD";
//     } else if (/sprint/i.test(query)) {
//       return "SPRINT";
//     } else if (issueKeyPattern.test(query)) {
//       return "TASK_DETAILS";
//     } else {
//       return "GENERAL";
//     }
//   }
// }

// Enhanced JQL generator with more nuanced query understanding and error recovery
// async function generateJQL(query, intent) {
//   try {
//     // Track start time for performance monitoring
//     const startTime = Date.now();

//     // First, check for pre-defined templates based on standardized queries
//     if (query === "show project status") return safeJqlTemplates.PROJECT_STATUS;
//     if (query === "show project timeline") return safeJqlTemplates.TIMELINE;
//     if (query === "show upcoming deadlines") return safeJqlTemplates.TIMELINE_UPCOMING;
//     if (query === "show project blockers") return safeJqlTemplates.BLOCKERS;
//     if (query === "show high risk items") return safeJqlTemplates.HIGH_PRIORITY;
//     if (query === "show team workload") return safeJqlTemplates.ASSIGNED_TASKS;
//     if (query === "show open tasks") return safeJqlTemplates.OPEN_TASKS;
//     if (query === "show closed tasks") return safeJqlTemplates.CLOSED_TASKS;
//     if (query === "show high priority tasks") return safeJqlTemplates.HIGH_PRIORITY;
//     if (query === "show highest priority task") return safeJqlTemplates.HIGHEST_PRIORITY_SINGLE;
//     if (query === "show unassigned tasks") return safeJqlTemplates.UNASSIGNED_TASKS;
//     if (query === "show recent updates") return safeJqlTemplates.RECENT_UPDATES;
//     if (query === "show current sprint") return safeJqlTemplates.CURRENT_SPRINT;
//     if (query === "show most recently updated task") return safeJqlTemplates.MOST_RECENT_TASK;
//     if (query === "show issue types") return safeJqlTemplates.ISSUE_TYPES;

//     // Check for specific issue key
//     const issueKeyPattern = new RegExp(`^\\s*${process.env.JIRA_PROJECT_KEY}-\\d+\\s*$`, "i");
//     if (issueKeyPattern.test(query)) {
//       const cleanKey = query.trim();
//       console.log("Direct issue key detected:", cleanKey);
//       return `key = "${cleanKey}"`;
//     }

//     // Check if the query contains a JIRA issue key within it
//     const containsIssueKey = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
//     const matches = query.match(containsIssueKey);
//     if (matches && matches.length > 0) {
//       const issueKey = matches[0];
//       console.log("Issue key found in query:", issueKey);
//       return `key = "${issueKey}"`;
//     }

//     // For some intent categories, use predefined safe templates
//     if (intent === "CONVERSATION" || intent === "GREETING") {
//       return safeJqlTemplates.RECENT_UPDATES;
//     }

//     if (intent === "SPRINT") {
//       return safeJqlTemplates.CURRENT_SPRINT;
//     }

//     if (intent === "PROJECT_STATUS") {
//       return safeJqlTemplates.PROJECT_STATUS;
//     }

//     if (intent === "ISSUE_TYPES") {
//       return safeJqlTemplates.ISSUE_TYPES;
//     }

//     // Special case for recent/latest task queries
//     if (/recent|latest|most recent|last|newest/i.test(query) && /edited|updated|modified|changed|task/i.test(query)) {
//       return safeJqlTemplates.MOST_RECENT_TASK;
//     }

//     // Extract specific entities from the query that might be useful for JQL
//     const extractedEntities = extractEntitiesFromQuery(query);
//     console.log("Extracted entities:", extractedEntities);

//     // If we have assignee info, and it's an assigned tasks query
//     if (extractedEntities.assignee && intent === "ASSIGNED_TASKS") {
//       return `project = "${process.env.JIRA_PROJECT_KEY}" AND assignee ~ "${extractedEntities.assignee}" AND status not in ("Done", "Closed", "Resolved") ORDER BY updated DESC`;
//     }

//     // If we have priority info, and it's a task list query
//     if (extractedEntities.priority && intent === "TASK_LIST") {
//       return `project = "${process.env.JIRA_PROJECT_KEY}" AND priority = "${extractedEntities.priority}" AND status not in ("Done", "Closed", "Resolved") ORDER BY updated DESC`;
//     }

//     // If we have a status and it's a task list query
//     if (extractedEntities.status && intent === "TASK_LIST") {
//       return `project = "${process.env.JIRA_PROJECT_KEY}" AND status = "${extractedEntities.status}" ORDER BY updated DESC`;
//     }

//     // Enhanced system prompt for JQL generation with AI
//     const systemPrompt = `
//       You are a specialized AI that converts natural language into precise Jira Query Language (JQL).
//       Your task is to generate ONLY valid JQL that will work correctly with Jira.
      
//       VERY IMPORTANT RULES:
//       1. Always add "project = ${process.env.JIRA_PROJECT_KEY}" to all JQL queries unless specifically told to search across all projects
//       2. Return ONLY the JQL query, nothing else. No explanations or additional text.
//       3. ALWAYS use double quotes for field values containing spaces
//       4. NEVER use commas outside of parentheses except in IN clauses - use AND or OR instead
//       5. NEVER use "LIMIT" in JQL - if quantity limiting is needed, use ORDER BY instead
//       6. For queries about recent/latest items, use "ORDER BY updated DESC" or "ORDER BY created DESC"
//       7. Ensure all special characters and reserved words are properly escaped
//       8. For multiple values in an IN statement, format like: status IN ("Open", "In Progress")
//       9. Avoid complex syntax with unclear operators
//       10. Avoid any syntax that might cause this error: "Expecting operator but got ','"
//       11. If the query asks about a specific person, include 'assignee ~ "PersonName"' in your JQL
//       12. If the query mentions status, always include a status condition like 'status = "In Progress"'
//       13. If any part of the query is unclear, prefer broader queries that return more results rather than potentially missing relevant issues
      
//       Common valid JQL patterns:
//       - status = "In Progress"
//       - assignee = "John Doe"
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND status IN ("Open", "In Progress")
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND priority = "High" AND assignee IS NOT EMPTY
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND labels = "frontend" AND status != "Done"
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND created >= -7d
      
//       FORBIDDEN PATTERNS:
//       - AVOID: status = open, assignee = john  ← NO COMMAS between conditions, missing quotes
//       - AVOID: status = "open", updated = "2023-01-01"  ← NO COMMAS between conditions
//       - AVOID: project, status = open  ← Invalid syntax, missing operators
//       - AVOID: LIMIT 5  ← Never use LIMIT keyword
//       - AVOID: ORDER BY status DESC LIMIT 10  ← Never use LIMIT keyword
      
//       CORRECT PATTERNS:
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND status = "Open" AND assignee = "John"
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND (status = "Open" OR status = "In Progress")
//       - project = "${process.env.JIRA_PROJECT_KEY}" AND status IN ("Open", "In Progress")
      
//       Generate a valid JQL query based on the user's intent: ${intent} and query: "${query}".
//     `;

//     // Use AI to generate the JQL
//     const response = await openai.chat.completions.create({
//       model: "gpt-4",
//       messages: [
//         { role: "system", content: systemPrompt },
//         { role: "user", content: `Convert this to precise JQL: "${query}"` },
//       ],
//       temperature: 0.1, // Lower temperature for consistent results
//     });

//     let jqlQuery = response.choices[0].message.content.trim();
//     console.log("AI-Generated JQL:", jqlQuery);

//     // Apply safety checks and sanitization to the AI-generated JQL
//     const sanitizedJQL = sanitizeJql(jqlQuery);

//     const endTime = Date.now();
//     console.log(`JQL generation took ${endTime - startTime}ms`);

//     return sanitizedJQL;
//   } catch (error) {
//     console.error("Error in primary JQL generation:", error);

//     try {
//       // Try a simplified AI approach with more constraints
//       console.log("Attempting simplified AI JQL generation...");

//       const simplifiedPrompt = `
//         Generate a simple, safe JQL query for Jira based on this query: "${query}"
//         The query intent is: ${intent}
        
//         REQUIREMENTS:
//         - Must start with project = "${process.env.JIRA_PROJECT_KEY}"
//         - Use only simple conditions with AND
//         - Stick to basic fields: status, assignee, priority
//         - ONLY output the JQL query, nothing else
//         - Never use commas between conditions
//         - Always use double quotes around values
//       `;

//       const simplifiedResponse = await openai.chat.completions.create({
//         model: "gpt-4",
//         messages: [{ role: "system", content: simplifiedPrompt }],
//         temperature: 0.1,
//         max_tokens: 100,
//       });

//       const simplifiedJQL = simplifiedResponse.choices[0].message.content.trim();
//       console.log("Simplified AI JQL generated:", simplifiedJQL);

//       // Double-check with sanitization
//       return sanitizeJql(simplifiedJQL);
//     } catch (secondError) {
//       console.error("Error in simplified JQL generation:", secondError);

//       // Final fallback to template-based JQL
//       console.log("Falling back to template-based JQL generation...");
//       return fallbackGenerateJQL(query, intent);
//     }
//   }
// }

// Helper function to extract useful entities from query for JQL generation
// function extractEntitiesFromQuery(query) {
//   const entities = {
//     assignee: null,
//     priority: null,
//     status: null,
//     type: null,
//     timeframe: null,
//   };

//   // Extract assignee
//   const assigneeMatch = query.match(/assigned to ([\w\s]+)|([\w\s]+)'s (tasks|issues|workload)|by ([\w\s]+)/i);
//   if (assigneeMatch) {
//     entities.assignee =
//       (assigneeMatch[1] || assigneeMatch[2] || assigneeMatch[4])?.trim().replace(/\s{2,}/g, " ");
//   }

//   // Extract priority
//   const priorityMatch = query.match(/priority (?:is |of |=)?\s*"?(high|highest|medium|low|lowest)"?/i);
//   if (priorityMatch) {
//     entities.priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
//   }

//   // Extract status
//   const statusMatch = query.match(/status (?:is |of |=)?\s*"?(open|in progress|done|closed|to do)"?/i);
//   if (statusMatch) {
//     entities.status = statusMatch[1].charAt(0).toUpperCase() + statusMatch[1].slice(1).toLowerCase();

//     // Special case for "In Progress" to get capitalization right
//     if (entities.status.toLowerCase() === "in progress") {
//       entities.status = "In Progress";
//     }
//   }

//   // Extract issue type
//   const typeMatch = query.match(/type (?:is |of |=)?\s*"?(bug|story|task|epic)"?/i);
//   if (typeMatch) {
//     entities.type = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase();
//   }

//   // Extract timeframe
//   if (/this week|current week/i.test(query)) {
//     entities.timeframe = "thisWeek";
//   } else if (/next week/i.test(query)) {
//     entities.timeframe = "nextWeek";
//   } else if (/this month|current month/i.test(query)) {
//     entities.timeframe = "thisMonth";
//   } else if (/overdue|late|past due/i.test(query)) {
//     entities.timeframe = "overdue";
//   } else if (/recent|latest|last/i.test(query)) {
//     entities.timeframe = "recent";
//   }

//   return entities;
// }

// Special handler for most recently edited task
// async function getMostRecentTaskDetails(req, res, query, sessionId) {
//   try {
//     // Get the most recently updated task
//     const recentTaskResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
//       params: {
//         jql: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
//         maxResults: 1,
//         fields: "summary,status,assignee,priority,created,updated,duedate,comment,description",
//       },
//       auth,
//     });

//     if (recentTaskResponse.data && recentTaskResponse.data.issues && recentTaskResponse.data.issues.length > 0) {
//       const issue = recentTaskResponse.data.issues[0];
//       const status = issue.fields.status?.name || "Unknown";
//       const assignee = issue.fields.assignee?.displayName || "Unassigned";
//       const summary = issue.fields.summary || "No summary";
//       const priority = issue.fields.priority?.name || "Not set";
//       const created = new Date(issue.fields.created).toLocaleDateString();
//       const updated = new Date(issue.fields.updated).toLocaleDateString();

//       // Description handling
//       let description = "No description provided.";
//       if (issue.fields.description) {
//         if (typeof issue.fields.description === "string") {
//           description = issue.fields.description;
//         } else if (issue.fields.description.content) {
//           try {
//             description = extractTextFromADF(issue.fields.description);
//           } catch (e) {
//             description = "Description contains rich formatting that cannot be displayed in plain text.";
//           }
//         }
//       }

//       // Comment handling
//       const comments = issue.fields.comment?.comments || [];
//       let commentMessage = "No comments found on this issue.";
//       if (comments.length > 0) {
//         const latestComment = comments[comments.length - 1];
//         const author = latestComment.author?.displayName || "Unknown";
//         const commentCreated = new Date(latestComment.created).toLocaleDateString();
//         let commentText = "";

//         if (typeof latestComment.body === "string") {
//           commentText = latestComment.body;
//         } else if (latestComment.body && latestComment.body.content) {
//           try {
//             commentText = extractTextFromADF(latestComment.body);
//           } catch (e) {
//             commentText = "Comment contains rich content that cannot be displayed in plain text.";
//           }
//         }

//         commentMessage = `**Latest comment** (by ${author} on ${commentCreated}):\n"${commentText}"`;
//       }

//       const formattedResponse =
//         `## ${createJiraLink(issue.key)}: ${summary} (Most Recently Updated)\n\n` +
//         `**Status**: ${status}\n` +
//         `**Priority**: ${priority}\n` +
//         `**Assignee**: ${assignee}\n` +
//         `**Created**: ${created}\n` +
//         `**Last Updated**: ${updated}\n\n` +
//         `### Description\n${description}\n\n` +
//         `### Latest Comment\n${commentMessage}`;

//       // Store response in conversation memory
//       if (conversationMemory[sessionId]) {
//         conversationMemory[sessionId].lastResponse = formattedResponse;
//       }

//       if (jql) {
//         const jiraFilterLink = createJiraFilterLink(jql);
//         formattedResponse += `\n\n[🡕 View these tasks in Jira](${jiraFilterLink})`;
//       }

//       return res.json({
//         message: formattedResponse,
//         rawData: issue,
//         meta: {
//           intent: "TASK_DETAILS",
//           issueKey: issue.key,
//         },
//       });
//     }
//     return null; // Continue with normal processing if no issues found
//   } catch (error) {
//     console.error("Error fetching most recent task:", error);
//     return null; // Continue with normal processing
//   }
// }

// Special handler for project status overview
// async function getProjectStatusOverview(req, res, sessionId) {
//   try {
//     // Get key project metrics in parallel
//     const [openResponse, inProgressResponse, doneResponse, highPriorityResponse, blockedResponse, unassignedResponse, recentResponse] =
//       await Promise.all([
//         // Open issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status = "Open"`,
//             maxResults: 0,
//           },
//           auth,
//         }),

//         // In Progress issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status = "In Progress"`,
//             maxResults: 0,
//           },
//           auth,
//         }),

//         // Done issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status = "Done"`,
//             maxResults: 0,
//           },
//           auth,
//         }),

//         // High priority issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND priority in ("High", "Highest") AND status != "Done"`,
//             maxResults: 5,
//             fields: "summary,status,assignee,priority",
//           },
//           auth,
//         }),

//         // Blocked issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND (status = "Blocked" OR labels = "blocker")`,
//             maxResults: 5,
//             fields: "summary,status,assignee,priority",
//           },
//           auth,
//         }),

//         // Unassigned issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND assignee IS EMPTY AND status != "Done"`,
//             maxResults: 5,
//             fields: "summary,status,priority",
//           },
//           auth,
//         }),

//         // Recently updated issues
//         axios.get(`${JIRA_URL}/rest/api/3/search`, {
//           params: {
//             jql: `project = ${process.env.JIRA_PROJECT_KEY} AND updated >= -7d ORDER BY updated DESC`,
//             maxResults: 5,
//             fields: "summary,status,updated,assignee",
//           },
//           auth,
//         }),
//       ]);

//     // Compile the data
//     const statusData = {
//       openCount: openResponse.data.total,
//       inProgressCount: inProgressResponse.data.total,
//       doneCount: doneResponse.data.total,
//       totalCount: openResponse.data.total + inProgressResponse.data.total + doneResponse.data.total,
//       highPriorityIssues: highPriorityResponse.data.issues,
//       highPriorityCount: highPriorityResponse.data.total,
//       blockedIssues: blockedResponse.data.issues,
//       blockedCount: blockedResponse.data.total,
//       unassignedIssues: unassignedResponse.data.issues,
//       unassignedCount: unassignedResponse.data.total,
//       recentIssues: recentResponse.data.issues,
//       recentCount: recentResponse.data.total,
//     };

//     // Calculate percentages for better insights
//     const completionPercentage = Math.round((statusData.doneCount / statusData.totalCount) * 100) || 0;

//     try {
//       // Generate a conversational response using AI
//       const prompt = `
//         You are a helpful project assistant providing a project status overview. 
//         You should be conversational, insightful and friendly.
        
//         Here is data about the current project:
//         - Open tasks: ${statusData.openCount}
//         - Tasks in progress: ${statusData.inProgressCount}
//         - Completed tasks: ${statusData.doneCount}
//         - Project completion: ${completionPercentage}%
//         - High priority issues: ${statusData.highPriorityCount}
//         - Blocked issues: ${statusData.blockedCount}
//         - Unassigned issues: ${statusData.unassignedCount}
//         - Recent updates: ${statusData.recentCount} in the last 7 days
        
//         Craft a brief, conversational summary of the project status that gives the key highlights.
//         Include relevant insights based on the numbers.
//         Format important information in bold using markdown (**bold**).
//         Use bullet points sparingly, and only when it helps readability.
//       `;

//       const response = await openai.chat.completions.create({
//         model: "gpt-4",
//         messages: [
//           { role: "system", content: prompt },
//           { role: "user", content: "Give me a friendly project status overview" },
//         ],
//         temperature: 0.7,
//       });

//       // Start with the AI-generated project overview
//       let formattedResponse = response.choices[0].message.content;

//       // Add high priority issues if there are any
//       if (statusData.highPriorityIssues.length > 0) {
//         formattedResponse += "\n\n### High Priority Issues\n";
//         for (const issue of statusData.highPriorityIssues.slice(0, 3)) {
//           const priority = issue.fields.priority?.name || "High";
//           const assignee = issue.fields.assignee?.displayName || "Unassigned";
//           formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${priority}, assigned to ${assignee})\n`;
//         }

//         if (statusData.highPriorityCount > 3) {
//           formattedResponse += `... and ${statusData.highPriorityCount - 3} more high priority issues.\n`;
//         }
//       }

//       // Add blocked issues if there are any
//       if (statusData.blockedIssues.length > 0) {
//         formattedResponse += "\n\n### Blocked Issues\n";
//         for (const issue of statusData.blockedIssues.slice(0, 3)) {
//           const assignee = issue.fields.assignee?.displayName || "Unassigned";
//           formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (assigned to ${assignee})\n`;
//         }

//         if (statusData.blockedCount > 3) {
//           formattedResponse += `... and ${statusData.blockedCount - 3} more blocked issues.\n`;
//         }
//       }

//       // Store in conversation memory
//       if (conversationMemory[sessionId]) {
//         conversationMemory[sessionId].lastResponse = formattedResponse;
//       }

//       return res.json({
//         message: formattedResponse,
//         rawData: statusData,
//         meta: {
//           intent: "PROJECT_STATUS",
//         },
//       });
//     } catch (aiError) {
//       console.error("Error generating AI project status:", aiError);

//       // Fallback to a formatted response without AI
//       let formattedResponse = `## Project Status Overview\n\n`;
//       formattedResponse += `**Current progress**: ${completionPercentage}% complete\n`;
//       formattedResponse += `**Open tasks**: ${statusData.openCount}\n`;
//       formattedResponse += `**In progress**: ${statusData.inProgressCount}\n`;
//       formattedResponse += `**Completed**: ${statusData.doneCount}\n\n`;

//       if (statusData.highPriorityCount > 0) {
//         formattedResponse += `**High priority issues**: ${statusData.highPriorityCount}\n`;
//       }

//       if (statusData.blockedCount > 0) {
//         formattedResponse += `**Blocked issues**: ${statusData.blockedCount}\n`;
//       }

//       if (statusData.unassignedCount > 0) {
//         formattedResponse += `**Unassigned tasks**: ${statusData.unassignedCount}\n`;
//       }

//       formattedResponse += `\n### Recent Activity\n`;
//       for (const issue of statusData.recentIssues.slice(0, 3)) {
//         const status = issue.fields.status?.name || "Unknown";
//         const updated = new Date(issue.fields.updated).toLocaleDateString();
//         formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status}, updated on ${updated})\n`;
//       }

//       // Store in conversation memory
//       if (conversationMemory[sessionId]) {
//         conversationMemory[sessionId].lastResponse = formattedResponse;
//       }

//       return res.json({
//         message: formattedResponse,
//         rawData: statusData,
//         meta: {
//           intent: "PROJECT_STATUS",
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error fetching project status:", error);
//     return null; // Continue with normal processing
//   }
// }

// Special handler for timeline queries
async function getProjectTimeline(req, res, query, sessionId) {
  try {
    // Determine timeline type
    let timeframeDesc = "upcoming";
    let jql = "";

    if (/past|previous|last|recent/i.test(query)) {
      timeframeDesc = "past";
      jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate <= now() AND duedate >= -30d ORDER BY duedate DESC`;
    } else if (/overdue|late|miss(ed)?|behind/i.test(query)) {
      timeframeDesc = "overdue";
      jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate < now() AND status != "Done" ORDER BY duedate ASC`;
    } else if (/this week|current week/i.test(query)) {
      timeframeDesc = "this week";
      jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= startOfWeek() AND duedate <= endOfWeek() ORDER BY duedate ASC`;
    } else if (/next week/i.test(query)) {
      timeframeDesc = "next week";
      jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate > endOfWeek() AND duedate <= endOfWeek(1) ORDER BY duedate ASC`;
    } else if (/this month|current month/i.test(query)) {
      timeframeDesc = "this month";
      jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= startOfMonth() AND duedate <= endOfMonth() ORDER BY duedate ASC`;
    } else {
      // Default to upcoming timeline
      jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= now() ORDER BY duedate ASC`;
    }

    // Execute timeline query
    const timelineResponse = await axios
      .get(`${JIRA_URL}/rest/api/3/search`, {
        params: {
          jql: jql,
          maxResults: 20,
          fields: "summary,status,assignee,priority,duedate",
        },
        auth,
      })
      .catch((error) => {
        console.error("Timeline JQL failed:", error);
        // Try a simpler fallback
        return axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND duedate IS NOT EMPTY ORDER BY duedate ASC`,
            maxResults: 20,
            fields: "summary,status,assignee,priority,duedate",
          },
          auth,
        });
      });

    if (timelineResponse.data && timelineResponse.data.issues && timelineResponse.data.issues.length > 0) {
      // Group issues by date
      const issuesByDate = {};
      const allIssues = timelineResponse.data.issues;

      allIssues.forEach((issue) => {
        if (!issue.fields.duedate) return;

        const dueDate = new Date(issue.fields.duedate);

        // Format by month and year
        const dateKey = dueDate.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

        if (!issuesByDate[dateKey]) {
          issuesByDate[dateKey] = [];
        }

        issuesByDate[dateKey].push(issue);
      });

      // Try to use AI to create a natural response
      try {
        const timelineData = {
          timeframe: timeframeDesc,
          totalDueDatesCount: allIssues.length,
          timelineGroups: Object.entries(issuesByDate).map(([date, issues]) => ({
            date,
            count: issues.length,
            examples: issues.slice(0, 5).map((issue) => ({
              key: issue.key,
              summary: issue.fields.summary,
              status: issue.fields.status?.name || "Unknown",
              priority: issue.fields.priority?.name || "Unknown",
              assignee: issue.fields.assignee?.displayName || "Unassigned",
            })),
          })),
        };

        const prompt = `
          You are a helpful Jira assistant providing timeline information about a project.
          
          Create a conversational, helpful response about the ${timeframeDesc} timeline.
          Organize information by date and highlight important upcoming deadlines.
          
          Make your response conversational and easy to read, not just a list of data.
          Use markdown formatting, especially for grouping items by date.
          Limit details to what's necessary - be concise but informative.
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `Timeline data: ${JSON.stringify(timelineData)}` },
          ],
          temperature: 0.7,
        });

        const formattedResponse = aiResponse.choices[0].message.content;

        // Store in conversation memory
        if (conversationMemory[sessionId]) {
          conversationMemory[sessionId].lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "TIMELINE",
            timeframe: timeframeDesc,
          },
        });
      } catch (aiError) {
        console.error("Error generating AI timeline:", aiError);

        // Fallback to a simpler format
        let formattedResponse = `## Project Timeline (${timeframeDesc})\n\n`;

        if (Object.keys(issuesByDate).length === 0) {
          formattedResponse += "No issues with due dates found in this timeframe.";
        } else {
          Object.entries(issuesByDate).forEach(([dateGroup, issues]) => {
            formattedResponse += `### ${dateGroup}\n`;

            issues.slice(0, 5).forEach((issue) => {
              const status = issue.fields.status?.name || "Unknown";
              const assignee = issue.fields.assignee?.displayName || "Unassigned";
              const date = new Date(issue.fields.duedate).toLocaleDateString();

              formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (Due: ${date}, ${status}, Assigned to: ${assignee})\n`;
            });

            if (issues.length > 5) {
              formattedResponse += `... and ${issues.length - 5} more items due in ${dateGroup}.\n`;
            }

            formattedResponse += "\n";
          });
        }

        // Store in conversation memory
        if (conversationMemory[sessionId]) {
          conversationMemory[sessionId].lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "TIMELINE",
            timeframe: timeframeDesc,
          },
        });
      }
    }

    return null; // Continue with normal processing if no issues
  } catch (error) {
    console.error("Error handling timeline query:", error);
    return null; // Continue with normal processing
  }
}

// Special handler for team workload
async function getTeamWorkload(req, res, query, sessionId) {
  try {
    // Get assignments for all team members
    const workloadResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: `project = ${process.env.JIRA_PROJECT_KEY} AND assignee IS NOT EMPTY AND status != "Done"`,
        maxResults: 100,
        fields: "summary,status,assignee,priority",
      },
      auth,
    });

    if (workloadResponse.data && workloadResponse.data.issues && workloadResponse.data.issues.length > 0) {
      // Group issues by assignee
      const issuesByAssignee = {};
      const issues = workloadResponse.data.issues;

      issues.forEach((issue) => {
        const assignee = issue.fields.assignee?.displayName || "Unassigned";

        if (!issuesByAssignee[assignee]) {
          issuesByAssignee[assignee] = [];
        }

        issuesByAssignee[assignee].push(issue);
      });

      // Try to use AI to create a natural response
      try {
        const workloadData = {
          totalActiveIssues: issues.length,
          teamMembers: Object.entries(issuesByAssignee).map(([name, tasks]) => ({
            name,
            taskCount: tasks.length,
            highPriorityCount: tasks.filter((t) => t.fields.priority?.name === "Highest" || t.fields.priority?.name === "High").length,
            examples: tasks.slice(0, 3).map((task) => ({
              key: task.key,
              summary: task.fields.summary,
              status: task.fields.status?.name,
              priority: task.fields.priority?.name,
            })),
          })),
        };

        // Sort team members by workload
        workloadData.teamMembers.sort((a, b) => b.taskCount - a.taskCount);

        const prompt = `
          You are a helpful Jira assistant analyzing team workload distribution.
          
          Create a conversational response about the team's current workload.
          Highlight who has the most work, who has high priority items, and any imbalances.
          
          Be helpful and insightful, not just listing raw data.
          Use markdown for formatting, especially for grouping by team member.
          Be concise but provide meaningful insights about the workload distribution.
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `Team workload data: ${JSON.stringify(workloadData)}` },
          ],
          temperature: 0.7,
        });

        const formattedResponse = aiResponse.choices[0].message.content;

        // Store in conversation memory
        if (conversationMemory[sessionId]) {
          conversationMemory[sessionId].lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "WORKLOAD",
          },
        });
      } catch (aiError) {
        console.error("Error generating AI workload:", aiError);

        // Fallback to a simpler format
        let formattedResponse = `## Team Workload Overview\n\n`;

        // Sort assignees by workload
        const sortedAssignees = Object.entries(issuesByAssignee).sort((a, b) => b[1].length - a[1].length);

        formattedResponse += `Currently there are **${issues.length} active tasks** assigned across **${sortedAssignees.length} team members**.\n\n`;

        sortedAssignees.forEach(([assignee, tasks]) => {
          const highPriorityCount = tasks.filter((t) => t.fields.priority?.name === "Highest" || t.fields.priority?.name === "High").length;

          formattedResponse += `### ${assignee}\n`;
          formattedResponse += `**Total tasks**: ${tasks.length}`;

          if (highPriorityCount > 0) {
            formattedResponse += ` (${highPriorityCount} high priority)`;
          }

          formattedResponse += `\n\n`;

          // Show examples of their tasks
          tasks.slice(0, 3).forEach((task) => {
            const status = task.fields.status?.name || "Unknown";
            const priority = task.fields.priority?.name || "";

            formattedResponse += `• ${task.key}: ${task.fields.summary} (${status}`;
            if (priority) formattedResponse += `, ${priority}`;
            formattedResponse += `)\n`;
          });

          if (tasks.length > 3) {
            formattedResponse += `... and ${tasks.length - 3} more tasks.\n`;
          }

          formattedResponse += `\n`;
        });

        // Store in conversation memory
        if (conversationMemory[sessionId]) {
          conversationMemory[sessionId].lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "WORKLOAD",
          },
        });
      }
    }

    return null; // Continue with normal processing if no issues
  } catch (error) {
    console.error("Error handling workload query:", error);
    return null; // Continue with normal processing
  }
}

// Special handler for advanced timeline queries
async function getAdvancedTimeline(req, res, query, sessionId) {
  try {
    // Extract time parameters from the query
    const timeParams = extractTimeParameters(query);
    console.log("Extracted time parameters:", timeParams);

    // Default to upcoming if no specific timeframe mentioned
    if (!timeParams.type) {
      timeParams.type = "upcoming";
    }

    // Build appropriate JQL based on detailed time parameters
    let jql = "";

    switch (timeParams.type) {
      case "thisWeek":
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= startOfWeek() AND duedate <= endOfWeek() ORDER BY duedate ASC`;
        break;
      case "nextWeek":
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate > endOfWeek() AND duedate <= endOfWeek(1) ORDER BY duedate ASC`;
        break;
      case "thisMonth":
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= startOfMonth() AND duedate <= endOfMonth() ORDER BY duedate ASC`;
        break;
      case "nextMonth":
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate > endOfMonth() AND duedate <= endOfMonth(1) ORDER BY duedate ASC`;
        break;
      case "overdue":
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate < now() AND status != "Done" ORDER BY duedate ASC`;
        break;
      case "noDate":
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate IS EMPTY AND status != "Done" ORDER BY created DESC`;
        break;
      case "upcoming":
      default:
        jql = `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= now() ORDER BY duedate ASC`;
    }

    // Apply additional filters if present
    if (timeParams.assignee) {
      jql += ` AND assignee ~ "${timeParams.assignee}"`;
    }

    if (timeParams.issueType) {
      jql += ` AND issuetype = "${timeParams.issueType}"`;
    }

    if (timeParams.priority) {
      jql += ` AND priority = "${timeParams.priority}"`;
    }

    // Execute timeline query
    const timelineResponse = await axios
      .get(`${JIRA_URL}/rest/api/3/search`, {
        params: {
          jql: jql,
          maxResults: 50,
          fields: "summary,status,assignee,priority,duedate,created,updated,issuetype",
        },
        auth,
      })
      .catch((error) => {
        console.error("Timeline JQL failed:", error);
        // Try a simpler fallback
        return axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND duedate IS NOT EMPTY ORDER BY duedate ASC`,
            maxResults: 30,
            fields: "summary,status,assignee,priority,duedate",
          },
          auth,
        });
      });

    if (timelineResponse.data && timelineResponse.data.issues) {
      // Group issues by date for better organization
      const issuesByDate = organizeTimelineByDate(timelineResponse.data.issues, timeParams);
      const memory = getConversationMemory(sessionId);

      try {
        // Generate a more natural, structured timeline response
        const timelineData = {
          timeframe: getTimeframeDescription(timeParams),
          totalCount: timelineResponse.data.total,
          issuesWithDueDates: timelineResponse.data.issues.filter((i) => i.fields.duedate).length,
          issuesWithoutDueDates: timelineResponse.data.issues.filter((i) => !i.fields.duedate).length,
          timelineGroups: Object.entries(issuesByDate).map(([date, issues]) => ({
            date,
            count: issues.length,
            examples: issues.slice(0, 5).map((issue) => ({
              key: issue.key,
              summary: issue.fields.summary,
              status: issue.fields.status?.name || "Unknown",
              priority: issue.fields.priority?.name || "Unknown",
              assignee: issue.fields.assignee?.displayName || "Unassigned",
              dueDate: issue.fields.duedate ? new Date(issue.fields.duedate).toLocaleDateString() : null,
            })),
            remainingCount: issues.length > 5 ? issues.length - 5 : 0,
          })),
        };

        // Determine if there are overdue items
        const now = new Date();
        const overdueItems = timelineResponse.data.issues.filter(
          (issue) => issue.fields.duedate && new Date(issue.fields.duedate) < now && issue.fields.status.name !== "Done"
        );

        // Add warning if there are overdue items
        if (overdueItems.length > 0) {
          timelineData.overdueCount = overdueItems.length;
          timelineData.overdueWarning = true;
        }

        // Add upcoming critical dates
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);
        const dueSoonItems = timelineResponse.data.issues.filter(
          (issue) => issue.fields.duedate && new Date(issue.fields.duedate) >= now && new Date(issue.fields.duedate) <= nextWeek
        );

        if (dueSoonItems.length > 0) {
          timelineData.dueSoonCount = dueSoonItems.length;
          timelineData.nextDeadline = dueSoonItems.sort((a, b) => new Date(a.fields.duedate) - new Date(b.fields.duedate))[0];
        }

        // Get user's verbosity preference
        const verbosityLevel = memory.userPreferences?.verbosityLevel || "medium";

        // Adjust prompt based on user verbosity preference
        const systemPrompt = `
          You are a helpful Jira assistant providing timeline information about a project.
          
          Create a ${
            verbosityLevel === "concise"
              ? "brief and direct"
              : verbosityLevel === "detailed"
              ? "comprehensive and thorough"
              : "balanced and helpful"
          } response about the ${timelineData.timeframe} timeline.
          
          ${
            verbosityLevel === "concise"
              ? "Focus only on the most essential deadlines and group items efficiently."
              : verbosityLevel === "detailed"
              ? "Provide a detailed breakdown by date, with context about each deadline group."
              : "Organize information by date and highlight important upcoming deadlines."
          }
          
          Make your response conversational and easy to read.
          Use markdown formatting, especially for grouping items by date.
          ${overdueItems.length > 0 ? "Draw attention to overdue items as they require urgent attention." : ""}
          ${dueSoonItems.length > 0 ? "Highlight items due in the next week as they are approaching deadline." : ""}
          
          ${
            timelineData.timelineGroups.length === 0
              ? "No issues with due dates were found for this timeframe. Explain this in a helpful way."
              : ""
          }
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Timeline data: ${JSON.stringify(timelineData)}` },
          ],
          temperature: 0.7,
        });

        const formattedResponse = aiResponse.choices[0].message.content;

        // Store in conversation memory
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "TIMELINE",
            timeframe: timelineData.timeframe,
            overdueItems: overdueItems.length,
            upcomingDeadlines: dueSoonItems.length,
          },
        });
      } catch (aiError) {
        console.error("Error generating AI timeline:", aiError);

        // Fallback to a structured format
        let formattedResponse = `## Project Timeline (${getTimeframeDescription(timeParams)})\n\n`;

        if (Object.keys(issuesByDate).length === 0) {
          formattedResponse += "No issues with due dates found in this timeframe.";
        } else {
          if (overdueItems.length > 0) {
            formattedResponse += `⚠️ **Warning**: There are ${overdueItems.length} overdue items that need attention.\n\n`;
          }

          Object.entries(issuesByDate).forEach(([dateGroup, issues]) => {
            formattedResponse += `### ${dateGroup}\n`;

            issues.slice(0, 5).forEach((issue) => {
              const status = issue.fields.status?.name || "Unknown";
              const assignee = issue.fields.assignee?.displayName || "Unassigned";
              const date = issue.fields.duedate ? new Date(issue.fields.duedate).toLocaleDateString() : "No due date";
              const priority = issue.fields.priority?.name || "";

              formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status}, ${
                priority ? priority + ", " : ""
              }Assigned to: ${assignee})\n`;
            });

            if (issues.length > 5) {
              formattedResponse += `... and ${issues.length - 5} more items due in ${dateGroup}.\n`;
            }

            formattedResponse += "\n";
          });
        }

        // Store in conversation memory
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "TIMELINE",
            timeframe: getTimeframeDescription(timeParams),
          },
        });
      }
    }

    return null; // Continue with normal processing if no issues
  } catch (error) {
    console.error("Error handling advanced timeline query:", error);
    return null; // Continue with normal processing
  }
}

// Helper function to extract time parameters from query
function extractTimeParameters(query) {
  const params = {
    type: null, // thisWeek, nextWeek, thisMonth, nextMonth, upcoming, overdue, noDate
    assignee: null, // specific person
    issueType: null, // bug, story, task, etc.
    priority: null, // high, medium, low
  };

  // Extract timeframe
  if (/this week|current week/i.test(query)) {
    params.type = "thisWeek";
  } else if (/next week/i.test(query)) {
    params.type = "nextWeek";
  } else if (/this month|current month/i.test(query)) {
    params.type = "thisMonth";
  } else if (/next month/i.test(query)) {
    params.type = "nextMonth";
  } else if (/overdue|late|miss(ed)?|behind/i.test(query)) {
    params.type = "overdue";
  } else if (/no due date|missing deadline|without deadline|no deadline/i.test(query)) {
    params.type = "noDate";
  } else if (/upcoming|future|planned|scheduled/i.test(query)) {
    params.type = "upcoming";
  }

  // Extract assignee
  const assigneeMatch = query.match(/assigned to (\w+)|(\w+)'s (deadlines|due dates|tasks)/i);
  if (assigneeMatch) {
    params.assignee = assigneeMatch[1] || assigneeMatch[2];
  }

  // Extract issue type
  const typeMatch = query.match(/type(?:s)? (?:is |are |=)?\s*"?(bug|story|task|epic)"?s?/i);
  if (typeMatch) {
    params.issueType = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase();
  }

  // Extract priority
  const priorityMatch = query.match(/priority (?:is |=)?\s*"?(high|highest|medium|low|lowest)"?/i);
  if (priorityMatch) {
    params.priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
  }

  return params;
}

// Helper function to organize timeline issues by date
function organizeTimelineByDate(issues, timeParams) {
  const issuesByDate = {};
  const now = new Date();

  // Separate overdue items for special highlighting
  if (timeParams.type !== "overdue") {
    const overdueIssues = issues.filter(
      (issue) => issue.fields.duedate && new Date(issue.fields.duedate) < now && issue.fields.status.name !== "Done"
    );

    if (overdueIssues.length > 0) {
      issuesByDate["Overdue"] = overdueIssues;
    }
  }

  // Group into appropriate time buckets based on query type
  issues.forEach((issue) => {
    if (!issue.fields.duedate) return;

    const dueDate = new Date(issue.fields.duedate);
    let dateKey;

    // Skip already categorized overdue items
    if (dueDate < now && issue.fields.status.name !== "Done" && timeParams.type !== "overdue") {
      return;
    }

    if (timeParams.type === "thisWeek" || timeParams.type === "nextWeek") {
      // For week views, group by day of week
      dateKey = dueDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    } else if (timeParams.type === "upcoming") {
      // For upcoming, categorize as This Week, Next Week, This Month, Future
      const thisWeekEnd = new Date(now);
      thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()));

      const nextWeekEnd = new Date(thisWeekEnd);
      nextWeekEnd.setDate(thisWeekEnd.getDate() + 7);

      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      if (dueDate <= thisWeekEnd) {
        dateKey = "This Week";
      } else if (dueDate <= nextWeekEnd) {
        dateKey = "Next Week";
      } else if (dueDate <= thisMonthEnd) {
        dateKey = "Later This Month";
      } else {
        const monthYear = dueDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        dateKey = monthYear;
      }
    } else {
      // Default - group by month and year
      dateKey = dueDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }

    if (!issuesByDate[dateKey]) {
      issuesByDate[dateKey] = [];
    }

    issuesByDate[dateKey].push(issue);
  });

  // Sort each group by due date
  Object.values(issuesByDate).forEach((group) => {
    group.sort((a, b) => (a.fields.duedate && b.fields.duedate ? new Date(a.fields.duedate) - new Date(b.fields.duedate) : 0));
  });

  return issuesByDate;
}

// Helper to get human-readable timeframe description
function getTimeframeDescription(timeParams) {
  switch (timeParams.type) {
    case "thisWeek":
      return "this week";
    case "nextWeek":
      return "next week";
    case "thisMonth":
      return "this month";
    case "nextMonth":
      return "next month";
    case "overdue":
      return "overdue items";
    case "noDate":
      return "items without due dates";
    case "upcoming":
    default:
      return "upcoming deadlines";
  }
}

// Advanced handler for workload analysis
async function getDetailedWorkloadAnalysis(req, res, query, sessionId) {
  try {
    // Extract parameters from query
    const workloadParams = {
      showUnassigned: /unassigned|not assigned/i.test(query),
      focusPerson: null,
      includeCompleted: /include (done|completed|finished)/i.test(query),
      showPriority: /by priority|priority breakdown/i.test(query),
      showStatus: /by status|status breakdown/i.test(query),
    };

    // Check if query focuses on a specific person
    const personMatch = query.match(/(?:about|for|on) (\w+)['s]? workload/i);
    if (personMatch) {
      workloadParams.focusPerson = personMatch[1];
    }

    // Build appropriate JQL
    let jql = `project = ${process.env.JIRA_PROJECT_KEY}`;

    if (!workloadParams.includeCompleted) {
      jql += ` AND status != "Done"`;
    }

    if (workloadParams.focusPerson) {
      jql += ` AND assignee ~ "${workloadParams.focusPerson}"`;
    } else if (!workloadParams.showUnassigned) {
      jql += ` AND assignee IS NOT EMPTY`;
    }

    jql += ` ORDER BY assignee ASC, priority DESC`;

    // Fetch all assignments
    const workloadResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: jql,
        maxResults: 100,
        fields: "summary,status,assignee,priority,duedate,issuetype,created,updated",
      },
      auth,
    });

    if (workloadResponse.data && workloadResponse.data.issues && workloadResponse.data.issues.length > 0) {
      // Analyze workload distribution
      const workloadAnalysis = analyzeWorkloadDistribution(workloadResponse.data.issues, workloadParams);

      // Get user preferences for response style
      const memory = getConversationMemory(sessionId);
      const verbosityLevel = memory.userPreferences?.verbosityLevel || "medium";

      try {
        // Generate AI response
        const systemPrompt = `
          You are a helpful Jira assistant analyzing team workload distribution.
          
          Create a ${
            verbosityLevel === "concise"
              ? "brief and focused"
              : verbosityLevel === "detailed"
              ? "comprehensive and detailed"
              : "balanced and informative"
          } response about the team's current workload.
          
          ${
            verbosityLevel === "concise"
              ? "Focus only on the key metrics and most significant workload imbalances."
              : verbosityLevel === "detailed"
              ? "Provide detailed breakdowns of workload by person, with analysis of distribution and potential issues."
              : "Balance detail with clarity, highlighting important workload patterns."
          }
          
          ${
            workloadParams.focusPerson
              ? `Focus specifically on ${workloadParams.focusPerson}'s workload and tasks.`
              : "Highlight who has the most work, who has high priority items, and any imbalances."
          }
          
          Be helpful and insightful, not just listing raw data.
          Use markdown formatting, especially for organizing by team member.
          Highlight any concerning workload imbalances or overloaded team members.
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Team workload data: ${JSON.stringify(workloadAnalysis)}` },
          ],
          temperature: 0.7,
        });

        const formattedResponse = aiResponse.choices[0].message.content;

        // Store in conversation memory
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "WORKLOAD",
            focusPerson: workloadParams.focusPerson,
            workloadDistribution: workloadAnalysis.distributionSummary,
          },
        });
      } catch (aiError) {
        console.error("Error generating AI workload analysis:", aiError);

        // Fallback to a structured format
        let formattedResponse = `## Team Workload Analysis\n\n`;

        if (workloadParams.focusPerson) {
          const personData = workloadAnalysis.assignees.find((a) => a.name.toLowerCase() === workloadParams.focusPerson.toLowerCase());

          if (personData) {
            formattedResponse += `### ${personData.name}'s Workload\n`;
            formattedResponse += `**Total tasks**: ${personData.taskCount}\n`;
            formattedResponse += `**High priority**: ${personData.highPriorityCount}\n`;

            if (personData.dueSoon > 0) {
              formattedResponse += `**Due soon**: ${personData.dueSoon} items due in the next 7 days\n`;
            }

            if (personData.overdue > 0) {
              formattedResponse += `**Overdue**: ${personData.overdue} items past due\n`;
            }

            formattedResponse += `\n**Current tasks**:\n`;
            personData.tasks.slice(0, 5).forEach((task) => {
              formattedResponse += `• ${task.key}: ${task.summary} (${task.status}, ${task.priority}${
                task.dueDate ? `, Due: ${task.dueDate}` : ""
              })\n`;
            });

            if (personData.tasks.length > 5) {
              formattedResponse += `... and ${personData.tasks.length - 5} more tasks\n`;
            }
          } else {
            formattedResponse += `No tasks found for ${workloadParams.focusPerson}.\n`;
          }
        } else {
          // Compare workloads
          formattedResponse += `**Total team workload**: ${workloadAnalysis.totalTasks} active tasks across ${workloadAnalysis.assignees.length} team members\n\n`;

          if (workloadAnalysis.unassignedCount > 0) {
            formattedResponse += `⚠️ There are ${workloadAnalysis.unassignedCount} unassigned tasks that need attention.\n\n`;
          }

          // Sort by workload (highest first)
          workloadAnalysis.assignees
            .sort((a, b) => b.taskCount - a.taskCount)
            .forEach((assignee) => {
              const workloadLevel =
                assignee.taskCount > 8 ? "**Heavily loaded**" : assignee.taskCount > 4 ? "Moderately loaded" : "Lightly loaded";

              formattedResponse += `### ${assignee.name} (${assignee.taskCount} tasks) - ${workloadLevel}\n`;

              if (assignee.highPriorityCount > 0) {
                formattedResponse += `${assignee.highPriorityCount} high priority tasks`;
                if (assignee.overdue > 0) {
                  formattedResponse += `, ${assignee.overdue} overdue`;
                }
                formattedResponse += `\n`;
              }

              // List a few example tasks
              formattedResponse += `\n**Example tasks**:\n`;
              assignee.tasks.slice(0, 3).forEach((task) => {
                formattedResponse += `• ${task.key}: ${task.summary} (${task.status}, ${task.priority})\n`;
              });

              if (assignee.tasks.length > 3) {
                formattedResponse += `... and ${assignee.tasks.length - 3} more tasks\n`;
              }

              formattedResponse += `\n`;
            });
        }

        // Store in conversation memory
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "WORKLOAD",
            focusPerson: workloadParams.focusPerson,
          },
        });
      }
    }

    return null; // Continue with normal processing if no issues
  } catch (error) {
    console.error("Error handling workload query:", error);
    return null; // Continue with normal processing
  }
}

// Helper function to analyze workload distribution
function analyzeWorkloadDistribution(issues, params) {
  // Group issues by assignee
  const issuesByAssignee = {};
  const now = new Date();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  issues.forEach((issue) => {
    const assignee = issue.fields.assignee?.displayName || "Unassigned";

    if (!issuesByAssignee[assignee]) {
      issuesByAssignee[assignee] = [];
    }

    issuesByAssignee[assignee].push(issue);
  });

  // Calculate workload metrics for each assignee
  const assigneeData = Object.entries(issuesByAssignee).map(([name, tasks]) => {
    const highPriorityCount = tasks.filter(
      (task) => task.fields.priority?.name === "Highest" || task.fields.priority?.name === "High"
    ).length;

    const dueSoon = tasks.filter(
      (task) => task.fields.duedate && new Date(task.fields.duedate) > now && new Date(task.fields.duedate) - now < oneWeek
    ).length;

    const overdue = tasks.filter(
      (task) => task.fields.duedate && new Date(task.fields.duedate) < now && task.fields.status.name !== "Done"
    ).length;

    // Get status breakdown
    const statusBreakdown = {};
    tasks.forEach((task) => {
      const status = task.fields.status?.name || "Unknown";
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });

    // Get type breakdown
    const typeBreakdown = {};
    tasks.forEach((task) => {
      const type = task.fields.issuetype?.name || "Unknown";
      typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
    });

    return {
      name,
      taskCount: tasks.length,
      highPriorityCount,
      dueSoon,
      overdue,
      statusBreakdown,
      typeBreakdown,
      tasks: tasks.map((task) => ({
        key: task.key,
        summary: task.fields.summary,
        status: task.fields.status?.name || "Unknown",
        priority: task.fields.priority?.name || "Unknown",
        dueDate: task.fields.duedate ? new Date(task.fields.duedate).toLocaleDateString() : null,
        isOverdue: task.fields.duedate && new Date(task.fields.duedate) < now && task.fields.status.name !== "Done",
        isDueSoon: task.fields.duedate && new Date(task.fields.duedate) > now && new Date(task.fields.duedate) - now < oneWeek,
      })),
    };
  });

  // Find team members with unusually high or low workloads
  const totalAssignees = assigneeData.filter((a) => a.name !== "Unassigned").length;
  const totalAssignedTasks = assigneeData.filter((a) => a.name !== "Unassigned").reduce((sum, a) => sum + a.taskCount, 0);

  const avgTasksPerPerson = totalAssigneeData > 0 ? totalAssignedTasks / totalAssignees : 0;

  // Identify overloaded and underloaded team members
  const overloadedMembers = assigneeData.filter((a) => a.name !== "Unassigned" && a.taskCount > avgTasksPerPerson * 1.5).map((a) => a.name);

  const underloadedMembers = assigneeData
    .filter((a) => a.name !== "Unassigned" && a.taskCount < avgTasksPerPerson * 0.5)
    .map((a) => a.name);

  // Get count of unassigned tasks
  const unassignedCount = issuesByAssignee["Unassigned"]?.length || 0;

  // Calculate overall workload distribution
  const maxWorkload = Math.max(...assigneeData.filter((a) => a.name !== "Unassigned").map((a) => a.taskCount));
  const minWorkload = Math.min(...assigneeData.filter((a) => a.name !== "Unassigned").map((a) => a.taskCount));
  const workloadGap = maxWorkload - minWorkload;

  // Evaluate workload distribution
  let distributionSummary = "balanced";
  if (workloadGap > avgTasksPerPerson) {
    distributionSummary = "highly unbalanced";
  } else if (workloadGap > avgTasksPerPerson / 2) {
    distributionSummary = "somewhat unbalanced";
  }

  return {
    totalTasks: issues.length,
    unassignedCount,
    assignees: assigneeData,
    overloadedMembers,
    underloadedMembers,
    avgTasksPerPerson,
    distributionSummary,
    maxWorkload,
    minWorkload,
    workloadGap,
  };
}

async function compareIssues(req, res, query, sessionId) {
  try {
    // Extract issue keys
    const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "gi");
    const matches = query.match(issueKeyPattern);

    if (matches && matches.length >= 2) {
      const issueKey1 = matches[0];
      const issueKey2 = matches[1];

      // Fetch both issues with all relevant fields
      const [issue1Response, issue2Response] = await Promise.all([
        axios.get(`${JIRA_URL}/rest/api/3/issue/${issueKey1}`, {
          params: {
            fields: "summary,status,assignee,priority,created,updated,duedate,issuetype,description,comment,labels,fixVersions,components",
          },
          auth,
        }),
        axios.get(`${JIRA_URL}/rest/api/3/issue/${issueKey2}`, {
          params: {
            fields: "summary,status,assignee,priority,created,updated,duedate,issuetype,description,comment,labels,fixVersions,components",
          },
          auth,
        }),
      ]);

      const issue1 = issue1Response.data;
      const issue2 = issue2Response.data;

      // Analyze what aspects the user might be interested in
      const comparisonFocus = analyzeComparisonFocus(query);

      // Get user preferences
      const memory = getConversationMemory(sessionId);
      const verbosityLevel = memory.userPreferences?.verbosityLevel || "medium";

      // Format the comparison
      try {
        // Extract data to compare
        const issue1Data = extractIssueData(issue1);
        const issue2Data = extractIssueData(issue2);

        // Find similarities and differences
        const comparison = compareIssueData(issue1Data, issue2Data);

        // Generate a prompt based on focus and preferences
        const systemPrompt = `
          You are a helpful Jira assistant comparing two issues. Create a clear, ${
            verbosityLevel === "concise"
              ? "brief and direct"
              : verbosityLevel === "detailed"
              ? "comprehensive and thorough"
              : "balanced and insightful"
          } comparison highlighting the ${comparisonFocus ? `differences in ${comparisonFocus}` : "similarities and differences"}.
          
          Format the response with markdown, organizing the comparison in a way that makes the differences easy to spot.
          ${
            verbosityLevel === "concise"
              ? "Focus only on the key differences and use a compact format."
              : verbosityLevel === "detailed"
              ? "Provide a detailed analysis of both similarities and differences with explanations of their significance."
              : "Highlight important differences while also noting significant similarities."
          }
          
          Include a brief analysis of what the comparison reveals (e.g., "Issue 2 has higher priority but later due date").
          ${comparisonFocus ? `Since the user seems interested in comparing ${comparisonFocus}, emphasize that aspect.` : ""}
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Compare these two issues: ${JSON.stringify({
                issue1: issue1Data,
                issue2: issue2Data,
                comparison: comparison,
              })}`,
            },
          ],
          temperature: 0.7,
        });

        const formattedResponse = aiResponse.choices[0].message.content.trim();

        // Store in conversation memory
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "COMPARE_ISSUES",
            issueKeys: [issueKey1, issueKey2],
            focus: comparisonFocus,
          },
        });
      } catch (aiError) {
        console.error("Error generating comparison response:", aiError);

        // Create a simple comparison if AI fails
        let formattedResponse = `## Comparison: ${issueKey1} vs ${issueKey2}\n\n`;

        // Two-column comparison for key fields
        formattedResponse += `| Field | ${createJiraLink(issueKey1)} | ${issueKey2} |\n`;
        formattedResponse += `| ----- | ----- | ----- |\n`;
        formattedResponse += `| Summary | ${issue1.fields.summary} | ${issue2.fields.summary} |\n`;
        formattedResponse += `| Status | ${issue1.fields.status?.name || "Unknown"} | ${issue2.fields.status?.name || "Unknown"} |\n`;
        formattedResponse += `| Assignee | ${issue1.fields.assignee?.displayName || "Unassigned"} | ${
          issue2.fields.assignee?.displayName || "Unassigned"
        } |\n`;
        formattedResponse += `| Priority | ${issue1.fields.priority?.name || "Not set"} | ${issue2.fields.priority?.name || "Not set"} |\n`;
        formattedResponse += `| Type | ${issue1.fields.issuetype?.name || "Unknown"} | ${issue2.fields.issuetype?.name || "Unknown"} |\n`;

        if (issue1.fields.duedate || issue2.fields.duedate) {
          formattedResponse += `| Due Date | ${issue1.fields.duedate ? new Date(issue1.fields.duedate).toLocaleDateString() : "None"} | ${
            issue2.fields.duedate ? new Date(issue2.fields.duedate).toLocaleDateString() : "None"
          } |\n`;
        }

        // Highlight key differences
        formattedResponse += `\n### Key Differences\n\n`;

        if (issue1.fields.status?.name !== issue2.fields.status?.name) {
          formattedResponse += `• **Status**: ${createJiraLink(issueKey1)} is in ${issue1.fields.status?.name || "Unknown"} while ${issueKey2} is in ${
            issue2.fields.status?.name || "Unknown"
          }\n`;
        }

        if ((issue1.fields.assignee?.displayName || "Unassigned") !== (issue2.fields.assignee?.displayName || "Unassigned")) {
          formattedResponse += `• **Assignee**: ${issueKey1} is assigned to ${
            issue1.fields.assignee?.displayName || "Unassigned"
          } while ${issueKey2} is assigned to ${issue2.fields.assignee?.displayName || "Unassigned"}\n`;
        }

        if ((issue1.fields.priority?.name || "Not set") !== (issue2.fields.priority?.name || "Not set")) {
          formattedResponse += `• **Priority**: ${issueKey1} is ${
            issue1.fields.priority?.name || "Not set"
          } priority while ${issueKey2} is ${issue2.fields.priority?.name || "Not set"} priority\n`;
        }

        // Store response
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "COMPARE_ISSUES",
            issueKeys: [issueKey1, issueKey2],
          },
        });
      }
    }

    return null; // Continue with normal processing if we couldn't find two issues
  } catch (error) {
    console.error("Error comparing issues:", error);
    return null; // Continue with normal processing
  }
}

// Helper function to analyze what the user wants to compare
function analyzeComparisonFocus(query) {
  // Check for focus on specific aspects
  if (/status|state|progress/i.test(query)) {
    return "status";
  } else if (/priority|importance|urgency/i.test(query)) {
    return "priority";
  } else if (/assign|who|person|responsible/i.test(query)) {
    return "assignee";
  } else if (/due|deadline|when|date/i.test(query)) {
    return "due dates";
  } else if (/time|duration|how long/i.test(query)) {
    return "timeframes";
  } else if (/comment|said|mentioned/i.test(query)) {
    return "comments";
  } else if (/label|tag|category/i.test(query)) {
    return "labels";
  } else if (/component|part|module/i.test(query)) {
    return "components";
  }

  return null; // No specific focus
}

// Helper function to extract relevant data from an issue
function extractIssueData(issue) {
  // Process comments if they exist
  let comments = [];
  if (issue.fields.comment && issue.fields.comment.comments) {
    comments = issue.fields.comment.comments.map((comment) => ({
      author: comment.author?.displayName || "Unknown",
      created: comment.created,
      body:
        typeof comment.body === "string"
          ? comment.body.substring(0, 100) + (comment.body.length > 100 ? "..." : "")
          : "Complex formatted comment",
    }));
  }

  // Process description
  let description = "No description";
  if (issue.fields.description) {
    if (typeof issue.fields.description === "string") {
      description = issue.fields.description.substring(0, 150) + (issue.fields.description.length > 150 ? "..." : "");
    } else {
      description = "Complex formatted description";
    }
  }

  // Extract labels
  const labels = issue.fields.labels || [];

  // Extract components
  const components = (issue.fields.components || []).map((c) => c.name);

  // Extract fix versions
  const fixVersions = (issue.fields.fixVersions || []).map((v) => v.name);

  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name || "Unknown",
    assignee: issue.fields.assignee?.displayName || "Unassigned",
    priority: issue.fields.priority?.name || "Not set",
    dueDate: issue.fields.duedate ? new Date(issue.fields.duedate).toLocaleDateString() : null,
    issuetype: issue.fields.issuetype?.name || "Unknown",
    created: new Date(issue.fields.created).toLocaleDateString(),
    updated: new Date(issue.fields.updated).toLocaleDateString(),
    description: description,
    comments: comments,
    commentCount: comments.length,
    labels: labels,
    components: components,
    fixVersions: fixVersions,
  };
}

// Helper function to compare two issues and find similarities and differences
function compareIssueData(issue1, issue2) {
  const differences = {};
  const similarities = {};

  // Compare basic fields
  if (issue1.status !== issue2.status) {
    differences.status = { issue1: issue1.status, issue2: issue2.status };
  } else {
    similarities.status = issue1.status;
  }

  if (issue1.assignee !== issue2.assignee) {
    differences.assignee = { issue1: issue1.assignee, issue2: issue2.assignee };
  } else {
    similarities.assignee = issue1.assignee;
  }

  if (issue1.priority !== issue2.priority) {
    differences.priority = { issue1: issue1.priority, issue2: issue2.priority };
  } else {
    similarities.priority = issue1.priority;
  }

  if (issue1.issuetype !== issue2.issuetype) {
    differences.issuetype = { issue1: issue1.issuetype, issue2: issue2.issuetype };
  } else {
    similarities.issuetype = issue1.issuetype;
  }

  // Due date comparison
  if (issue1.dueDate !== issue2.dueDate) {
    differences.dueDate = { issue1: issue1.dueDate, issue2: issue2.dueDate };

    // Check which is due first
    if (issue1.dueDate && issue2.dueDate) {
      const date1 = new Date(issue1.dueDate);
      const date2 = new Date(issue2.dueDate);
      differences.dueDateComparison = date1 < date2 ? `${issue1.key} is due earlier` : `${issue2.key} is due earlier`;
    }
  } else {
    similarities.dueDate = issue1.dueDate;
  }

  // Compare arrays (labels, components)
  if (JSON.stringify(issue1.labels.sort()) !== JSON.stringify(issue2.labels.sort())) {
    const commonLabels = issue1.labels.filter((l) => issue2.labels.includes(l));
    const uniqueToIssue1 = issue1.labels.filter((l) => !issue2.labels.includes(l));
    const uniqueToIssue2 = issue2.labels.filter((l) => !issue1.labels.includes(l));

    differences.labels = {
      commonLabels,
      uniqueToIssue1,
      uniqueToIssue2,
    };
  } else if (issue1.labels.length > 0) {
    similarities.labels = issue1.labels;
  }

  if (JSON.stringify(issue1.components.sort()) !== JSON.stringify(issue2.components.sort())) {
    const commonComponents = issue1.components.filter((c) => issue2.components.includes(c));
    const uniqueToIssue1 = issue1.components.filter((c) => !issue2.components.includes(c));
    const uniqueToIssue2 = issue2.components.filter((c) => !issue1.components.includes(c));

    differences.components = {
      commonComponents,
      uniqueToIssue1,
      uniqueToIssue2,
    };
  } else if (issue1.components.length > 0) {
    similarities.components = issue1.components;
  }

  // Compare metrics
  differences.commentCount = {
    issue1: issue1.commentCount,
    issue2: issue2.commentCount,
    difference: Math.abs(issue1.commentCount - issue2.commentCount),
  };

  // Age comparison
  const created1 = new Date(issue1.created);
  const created2 = new Date(issue2.created);
  if (created1.getTime() !== created2.getTime()) {
    differences.created = {
      issue1: issue1.created,
      issue2: issue2.created,
      comparison: created1 < created2 ? `${issue1.key} was created earlier (older)` : `${issue2.key} was created earlier (older)`,
    };
  } else {
    similarities.created = issue1.created;
  }

  // Last updated
  const updated1 = new Date(issue1.updated);
  const updated2 = new Date(issue2.updated);
  if (updated1.getTime() !== updated2.getTime()) {
    differences.updated = {
      issue1: issue1.updated,
      issue2: issue2.updated,
      comparison: updated1 > updated2 ? `${issue1.key} was updated more recently` : `${issue2.key} was updated more recently`,
    };
  } else {
    similarities.updated = issue1.updated;
  }

  return {
    differences,
    similarities,
    summary: {
      totalDifferences: Object.keys(differences).length,
      totalSimilarities: Object.keys(similarities).length,
      majorDifferences: Object.keys(differences).filter((k) => ["status", "priority", "assignee", "dueDate", "issuetype"].includes(k)),
      isSummaryDifferent: issue1.summary !== issue2.summary,
    },
  };
}

// Special handler for issue types and issue type counts
async function getIssueTypes(req, res, query, sessionId) {
  try {
    // Get issues with their types
    const issueTypesResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: `project = ${process.env.JIRA_PROJECT_KEY}`,
        maxResults: 1000, // Large enough to get all issue types
        fields: "issuetype,status",
      },
      auth,
    });

    if (issueTypesResponse.data && issueTypesResponse.data.issues) {
      // Extract unique issue types
      const issueTypes = {};

      issueTypesResponse.data.issues.forEach((issue) => {
        const issueType = issue.fields.issuetype;
        if (issueType && issueType.name) {
          if (!issueTypes[issueType.name]) {
            issueTypes[issueType.name] = {
              count: 0,
              openCount: 0,
              id: issueType.id,
              description: issueType.description || null,
              iconUrl: issueType.iconUrl || null,
            };
          }
          issueTypes[issueType.name].count++;

          // Count open issues of each type
          const status = issue.fields.status?.name || "";
          if (status !== "Done" && status !== "Closed" && status !== "Resolved") {
            issueTypes[issueType.name].openCount++;
          }
        }
      });

      // Check if the query is asking about a specific issue type
      const askingAboutBugs = /how many bugs|number of bugs|total bugs|bug count|count bugs/i.test(query);
      const askingAboutStories = /how many stories|number of stories|total stories|story count|count stories/i.test(query);
      const askingAboutTasks = /how many tasks|number of tasks|total tasks|task count|count tasks/i.test(query);

      if (askingAboutBugs || askingAboutStories || askingAboutTasks) {
        let typeName = "";
        if (askingAboutBugs) typeName = "Bug";
        else if (askingAboutStories) typeName = "Story";
        else if (askingAboutTasks) typeName = "Task";

        // Check if this type exists in the project
        if (issueTypes[typeName]) {
          const typeData = issueTypes[typeName];
          const totalCount = typeData.count;
          const openCount = typeData.openCount;
          const percentage = Math.round((totalCount / issueTypesResponse.data.total) * 100);

          let formattedResponse = `## ${typeName}s in ${process.env.JIRA_PROJECT_KEY}\n\n`;
          formattedResponse += `There are **${totalCount} ${typeName.toLowerCase()}s** in the project`;

          if (openCount > 0) {
            formattedResponse += `, with **${openCount}** of them currently open/active`;
          }

          formattedResponse += `.\n\n`;

          if (percentage > 0) {
            formattedResponse += `${typeName}s make up **${percentage}%** of all issues in the project.`;
          }

          // Store in conversation memory
          if (conversationMemory[sessionId]) {
            conversationMemory[sessionId].lastResponse = formattedResponse;
          }

          return res.json({
            message: formattedResponse,
            meta: {
              intent: "ISSUE_TYPES",
              specificType: typeName,
            },
          });
        } else {
          // Handle case where the requested type doesn't exist
          let formattedResponse = `## ${typeName}s in ${process.env.JIRA_PROJECT_KEY}\n\n`;
          formattedResponse += `I couldn't find any issues of type "${typeName}" in this project. `;
          formattedResponse += `\n\nThe issue types that exist in this project are:\n\n`;

          Object.keys(issueTypes).forEach((type) => {
            formattedResponse += `• **${type}**: ${issueTypes[type].count} issues\n`;
          });

          // Store in conversation memory
          if (conversationMemory[sessionId]) {
            conversationMemory[sessionId].lastResponse = formattedResponse;
          }

          return res.json({
            message: formattedResponse,
            meta: {
              intent: "ISSUE_TYPES",
              specificType: typeName,
              typeExists: false,
            },
          });
        }
      }

      // For general issue types queries (not asking about a specific count)
      try {
        const issueTypesData = {
          projectKey: process.env.JIRA_PROJECT_KEY,
          totalIssues: issueTypesResponse.data.total,
          issueTypes: Object.entries(issueTypes).map(([name, data]) => ({
            name,
            count: data.count,
            openCount: data.openCount,
            percentage: Math.round((data.count / issueTypesResponse.data.total) * 100),
          })),
        };

        const prompt = `
          You are a helpful Jira assistant providing information about issue types in a project.
          
          Create a conversational, helpful response about the work types (also known as issue types) in the project.
          Be very clear that these are the official issue types/work types in the project.
          
          Make your response conversational and easy to read.
          Use markdown formatting to organize the information.
          Limit details to what's necessary - be concise but informative.
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `Issue types data: ${JSON.stringify(issueTypesData)}` },
          ],
          temperature: 0.7,
        });

        const formattedResponse = aiResponse.choices[0].message.content;
        if (jiraData.jql) {
          const jiraFilterLink = createJiraFilterLink(jiraData.jql);
          formattedResponse += `\n\n[🡕 View these tasks in Jira](${jiraFilterLink})`;
        }


        // Store in conversation memory
        if (conversationMemory[sessionId]) {
          conversationMemory[sessionId].lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "ISSUE_TYPES",
          },
        });
      } catch (aiError) {
        console.error("Error generating AI issue types response:", aiError);

        // Fallback to a simpler format
        let formattedResponse = `## Work Types in ${process.env.JIRA_PROJECT_KEY}\n\n`;

        // Sort issue types by count (most common first)
        const sortedTypes = Object.entries(issueTypes).sort((a, b) => b[1].count - a[1].count);

        formattedResponse += `In this project, there are ${sortedTypes.length} work types (issue types):\n\n`;

        sortedTypes.forEach(([typeName, typeData]) => {
          const percentage = Math.round((typeData.count / issueTypesResponse.data.total) * 100);
          formattedResponse += `**${typeName}**: ${typeData.count} issues (${percentage}% of total)`;

          if (typeData.openCount > 0) {
            formattedResponse += ` - ${typeData.openCount} open/active`;
          }

          formattedResponse += `\n`;
        });

        formattedResponse += `\nThese are the official work types defined in your Jira project.`;

        // Store in conversation memory
        if (conversationMemory[sessionId]) {
          conversationMemory[sessionId].lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "ISSUE_TYPES",
          },
        });
      }
    }

    return null; // Continue with normal processing if no issues found
  } catch (error) {
    console.error("Error handling issue types query:", error);
    return null; // Continue with normal processing
  }
}

// Enhanced response generation function with better conversational capabilities
async function generateResponse(query, jiraData, intent, context = {}) {
  // Basic data checks
  if (!jiraData || !jiraData.issues) {
    return "I couldn't find any relevant information for your query.";
  }

  const issueCount = jiraData.issues.length;
  const totalCount = jiraData.total;

  // Handle empty results case specifically
  if (issueCount === 0) {
    const noResultsResponses = [
      "I couldn't find any issues matching your criteria. Would you like to try a different search?",
      "I looked, but didn't find any matching issues in Jira. Could you try rephrasing your question?",
      "No results found for that query. Maybe we could try a broader search?",
      "I don't see any issues that match what you're looking for. Let me know if you'd like to try a different approach.",
    ];
    return noResultsResponses[Math.floor(Math.random() * noResultsResponses.length)];
  }

  // Handle greeting and conversational intents specially
  if (intent === "GREETING") {
    const greetingResponses = [
      "Hi there! I'm your Jira assistant. I can help you with:\n\n• Finding tasks and issues\n• Checking project status\n• Understanding who's working on what\n• Tracking blockers and high-priority items\n• Monitoring deadlines and timelines\n\nJust ask me a question about your Jira project!",
      "Hello! I'm here to help you navigate your Jira project. You can ask me about:\n\n• Open and closed tasks\n• Task assignments and ownership\n• Project timelines and deadlines\n• High priority issues and blockers\n• Recent updates and changes\n\nWhat would you like to know about your project today?",
      'Hey! I\'m your Jira chatbot assistant. Some things you can ask me:\n\n• "What\'s the status of our project?"\n• "Show me open bugs assigned to Sarah"\n• "Any blockers in the current sprint?"\n• "Tell me about NIHK-123"\n• "What\'s due this week?"\n\nHow can I help you today?',
    ];
    return greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
  }

  if (intent === "CONVERSATION") {
    // Pull out recent project activity for conversational context
    const recentActivity = jiraData.issues.slice(0, 3).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || "Unknown",
    }));

    const conversationPrompt = `
      You are a friendly Jira assistant chatting with a user. The user has said: "${query}"
      
      This appears to be a conversational follow-up rather than a direct query about Jira data.
      
      Some recent activity in the project includes:
      ${recentActivity.map((i) => `- ${i.key}: ${i.summary} (${i.status})`).join("\n")}
      
      Respond in a friendly, helpful way. If they're asking for more information or clarification,
      offer to help them by suggesting specific types of queries they could ask. If they're
      expressing appreciation, acknowledge it warmly and ask if they need anything else.
      
      Don't fabricate Jira data that wasn't provided. Make your response conversational and natural.
    `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: conversationPrompt },
          { role: "user", content: query },
        ],
        temperature: 0.7,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error("Error generating conversational response:", error);
      return "I'm here to help with your Jira queries. What would you like to know about your project?";
    }
  }

  try {
    // Create a more varied and context-aware system prompt based on intent
    let systemPrompt = `
      You are a helpful, friendly Jira project assistant providing information in a conversational, natural tone.
      
      Format requirements for the frontend:
      - Use markdown formatting that works with the frontend:
        - ## for main headers (issue keys)
        - ### for section headers
        - **bold** for field names and important information
        - • or - for bullet points
        - Line breaks to separate sections
    `;

    // Add intent-specific guidance
    if (intent === "PROJECT_STATUS") {
      systemPrompt += `
        For PROJECT_STATUS intent:
        - Begin with a conversational summary of the project's current state
        - Highlight key metrics (open issues, in progress, completed)
        - Mention any critical or high priority items
        - Add insights about progress and bottlenecks
        - Organize information in a clear, scannable way
        - ALWAYS include specific numbers and counts
      `;
    } else if (intent === "TASK_LIST") {
      systemPrompt += `
        For TASK_LIST intent:
        - Start with a brief overview of the results ("I found X tasks...")
        - Group tasks logically (by status, priority, etc.)
        - For each task, include the key, summary, status and assignee
        - Limit to showing 5-7 tasks with a note about the rest
        - Add a brief insight about the tasks if possible
        - ALWAYS include the total count, group them by status or priority if applicable
        - If user asks for more details, suggest they ask about a specific task key
        - If user asks for a count of tasks (specific or overall), provide that count clearly
      `;
    } else if (intent === "ASSIGNED_TASKS") {
      systemPrompt += `
        For ASSIGNED_TASKS intent:
        - Group tasks by assignee in a clear structure
        - For each person, list 2-3 of their most important tasks
        - Include task key, summary and status
        - Add a brief comment about each person's workload
        - Highlight any potential overloading or imbalances
        - Be specific about counts and distribution
      `;
    } else if (intent === "TASK_DETAILS") {
      systemPrompt += `
        For TASK_DETAILS intent:
        - Use a clear header with the issue key and summary
        - In the header, format the issue key as a clickable markdown link like [IHKA-123](https://asioso.atlassian.net/browse/IHKA-123)
        - Organize details into logical sections
        - Include all important fields (status, priority, assignee, dates)
        - Format description and comments for readability
        - Highlight the most recent or important information
        - NEVER omit important information
        - Use [IHKA-123](https://asioso.atlassian.net/browse/IHKA-123) format to make Jira issue keys clickable
      `;
    } else if (intent === "BLOCKERS") {
      systemPrompt += `
        For BLOCKERS intent:
        - Use slightly urgent language appropriate for blockers
        - Clearly identify the most critical issues first
        - For each blocker, include who it's assigned to and its status
        - Group by priority if there are multiple blockers
        - Suggest possible next steps if appropriate
        - Be precise about what's blocking and why
      `;
    } else if (intent === "TIMELINE") {
      systemPrompt += `
        For TIMELINE intent:
        - Organize items chronologically
        - Group by timeframe (this week, next week, this month)
        - Highlight upcoming deadlines
        - Include due dates, current status, and assignees
        - Add context about timing and priorities
        - If tasks are overdue, clearly mark them as such
      `;
    } else if (intent === "COMMENTS") {
      systemPrompt += `
        For COMMENTS intent:
        - Show the most recent comments first
        - Include the author and date for each comment
        - Format the comment text for readability
        - Provide context around what the comment is referring to
        - Highlight important points from the comments
      `;
    } else if (intent === "WORKLOAD") {
      systemPrompt += `
        For WORKLOAD intent:
        - Compare team members' workloads
        - Show who has the most and least tasks
        - Highlight who has high priority items
        - Note any potential overloading
        - Suggest workload balancing if needed
      `;
    } else if (intent === "SPRINT") {
      systemPrompt += `
        For SPRINT intent:
        - Provide an overview of the current sprint status
        - Group issues by status (to do, in progress, done)
        - Highlight progress (% complete, days remaining)
        - Note any blockers or at-risk items
        - Keep the tone conversational and insightful
      `;
    } else if (intent === "ISSUE_TYPES") {
      systemPrompt += `
        For ISSUE_TYPES intent:
        - Begin with a clear statement about the work types (issue types) in the project
        - List each type with its count and percentage of total issues
        - Keep explanations concise and focused on the official types
        - Mention that these are the official work/issue types defined in the project
        - Always include counts and percentages
      `;
    }

    systemPrompt += `
      General guidelines:
      - Maintain a conversational, helpful tone throughout
      - Begin with a direct response to their query, then provide supporting details
      - Keep lists concise - show 5 items max and summarize the rest if there are more
      - Show Jira issue keys in their original format (${process.env.JIRA_PROJECT_KEY}-123) 
      - Vary your language patterns and openings to sound natural
      - Add relevant insights beyond just listing data
      - Include specific counts and metrics when available
      - Adjust your tone based on the urgency/priority of the issues
      - Never mention JQL or technical implementation details
      - End with a brief, helpful question or suggestion if appropriate

      The query intent is: ${intent}
      The user asked: "${query}"
    `;

    // Prepare a condensed version of the Jira data
    const condensedIssues = jiraData.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || "Unknown",
      priority: issue.fields.priority?.name || "Unknown",
      assignee: issue.fields.assignee?.displayName || "Unassigned",
      created: issue.fields.created,
      updated: issue.fields.updated,
      dueDate: issue.fields.duedate || "No due date",
      comments:
        issue.fields.comment?.comments?.length > 0
          ? {
              count: issue.fields.comment.comments.length,
              latest: {
                author: issue.fields.comment.comments[issue.fields.comment.comments.length - 1].author?.displayName || "Unknown",
                created: issue.fields.comment.comments[issue.fields.comment.comments.length - 1].created,
                body:
                  typeof issue.fields.comment.comments[issue.fields.comment.comments.length - 1].body === "string"
                    ? issue.fields.comment.comments[issue.fields.comment.comments.length - 1].body.substring(0, 150) + "..."
                    : "Complex formatted comment",
              },
            }
          : null,
      description: issue.fields.description ? "Has description" : "No description",
      issuetype: issue.fields.issuetype?.name || "Unknown",
    }));

    // Add analysis of the query and data to provide context
    const queryAnalysis = {
      seemsUrgent: /urgent|asap|immediately|critical|blocker/i.test(query),
      mentionsTime: /due date|deadline|when|timeline|schedule|milestone/i.test(query),
      mentionsPerson: /assigned to|working on|responsible for/i.test(query),
      isSpecific: /specific|exactly|precisely|only/i.test(query),
      requestsCount: /how many|count|number of/i.test(query),
    };

    // Calculate basic statistics to enrich the response
    const statistics = {
      statusBreakdown: condensedIssues.reduce((acc, issue) => {
        acc[issue.status] = (acc[issue.status] || 0) + 1;
        return acc;
      }, {}),
      priorityBreakdown: condensedIssues.reduce((acc, issue) => {
        acc[issue.priority] = (acc[issue.priority] || 0) + 1;
        return acc;
      }, {}),
      assigneeBreakdown: condensedIssues.reduce((acc, issue) => {
        const assignee = issue.assignee || "Unassigned";
        acc[assignee] = (acc[assignee] || 0) + 1;
        return acc;
      }, {}),
    };

    // Add conversation context if available
    const conversationContext = context.previousQueries
      ? {
          previousQueries: context.previousQueries.slice(-3),
          previousIntents: context.previousIntents?.slice(-3),
          lastResponse: context.lastResponse,
          // Track the specific issues, assignees, or topics from previous messages
          recentMentionedIssues: extractRecentIssues(context.previousQueries),
          recentMentionedAssignees: extractRecentAssignees(context.previousQueries),
        }
      : {};

    const contextData = {
      query,
      total: jiraData.total,
      shownCount: condensedIssues.length,
      issues: condensedIssues,
      queryAnalysis,
      statistics,
      ...conversationContext,
    };

    // Adjust temperature based on intent
    let temperature = 0.7; // Default
    if (intent === "TASK_DETAILS" || intent === "PROJECT_STATUS") {
      temperature = 0.4; // Lower for factual responses
    } else if (intent === "CONVERSATION" || intent === "GREETING") {
      temperature = 0.8; // Higher for conversational responses
    }

    // Use a higher temperature for more varied responses
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Query: "${query}"\nJira data: ${JSON.stringify(contextData)}\n\nGenerate a helpful, conversational response.`,
        },
      ],
      temperature: temperature,
      max_tokens: 800, // Ensure we get a full, detailed response
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error generating response:", error);

    // Intent-specific fallback responses
    // This ensures that even if AI fails, we provide a relevant, helpful response

    if (intent === "PROJECT_STATUS") {
      let response = `## Project Status Overview\n\n`;

      // Calculate basic statistics
      const statusCounts = {};
      jiraData.issues.forEach((issue) => {
        const status = issue.fields.status?.name || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      // Add status breakdown
      response += `Here's the current status of the project:\n\n`;
      for (const [status, count] of Object.entries(statusCounts)) {
        response += `• **${status}**: ${count} issues\n`;
      }

      // Add recent activity
      response += `\n### Recent Activity\n`;
      for (let i = 0; i < Math.min(3, issueCount); i++) {
        const issue = jiraData.issues[i];
        const status = issue.fields.status?.name || "Unknown";
        response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status})\n`;
      }

      return response;
    }

    if (intent === "TIMELINE") {
      let response = `## Project Timeline\n\n`;

      // Group by due date (month)
      const issuesByMonth = {};
      jiraData.issues.forEach((issue) => {
        if (!issue.fields.duedate) return;

        const dueDate = new Date(issue.fields.duedate);
        const month = dueDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

        if (!issuesByMonth[month]) {
          issuesByMonth[month] = [];
        }

        issuesByMonth[month].push(issue);
      });

      // Format timeline
      if (Object.keys(issuesByMonth).length === 0) {
        response += "I didn't find any issues with due dates in the timeline.";
      } else {
        for (const [month, issues] of Object.entries(issuesByMonth)) {
          response += `### ${month}\n`;

          issues.forEach((issue) => {
            const status = issue.fields.status?.name || "Unknown";
            const dueDate = new Date(issue.fields.duedate).toLocaleDateString();
            response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (Due: ${dueDate}, ${status})\n`;
          });

          response += "\n";
        }
      }

      

      return response;
    }

    if (intent === "BLOCKERS" || intent === "HIGH_PRIORITY") {
      let response = `## Key Issues Requiring Attention\n\n`;

      const priorityCounts = {};
      jiraData.issues.forEach((issue) => {
        const priority = issue.fields.priority?.name || "Unknown";
        priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
      });

      response += `I found ${issueCount} issues that need attention:\n\n`;

      // Group by priority
      jiraData.issues.forEach((issue) => {
        const priority = issue.fields.priority?.name || "Unknown";
        const status = issue.fields.status?.name || "Unknown";
        const assignee = issue.fields.assignee?.displayName || "Unassigned";

        response += `• **${createJiraLink(issue.key)}**: ${issue.fields.summary} (${priority}, ${status}, Assigned to: ${assignee})\n`;
      });

      return response;
    }

    if (intent === "ASSIGNED_TASKS" || intent === "WORKLOAD") {
      let response = `## Team Workload\n\n`;

      if (jiraData.jql) {
        const jiraFilterLink = createJiraFilterLink(jiraData.jql);
        response += `\n\n[🡕 View these tasks in Jira](${jiraFilterLink})`;
      }

      // Group by assignee
      const issuesByAssignee = {};
      jiraData.issues.forEach((issue) => {
        const assignee = issue.fields.assignee?.displayName || "Unassigned";

        if (!issuesByAssignee[assignee]) {
          issuesByAssignee[assignee] = [];
        }

        issuesByAssignee[assignee].push(issue);
      });

      // Format by assignee
      for (const [assignee, issues] of Object.entries(issuesByAssignee)) {
        response += `### ${assignee} (${issues.length} issues)\n`;

        issues.slice(0, 3).forEach((issue) => {
          const status = issue.fields.status?.name || "Unknown";
          response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status})\n`;
        });

        if (issues.length > 3) {
          response += `... and ${issues.length - 3} more issues.\n`;
        }

        response += "\n";
      }



      return response;
    }

    if (intent === "TASK_DETAILS" && jiraData.issues.length > 0) {
      const issue = jiraData.issues[0];
      const status = issue.fields.status?.name || "Unknown";
      const assignee = issue.fields.assignee?.displayName || "Unassigned";
      const summary = issue.fields.summary || "No summary";
      const priority = issue.fields.priority?.name || "Not set";
      const created = new Date(issue.fields.created).toLocaleDateString();
      const updated = new Date(issue.fields.updated).toLocaleDateString();

      const response =
        `## ${createJiraLink(issue.key)}: ${summary}\n\n` +
        `**Status**: ${status}\n` +
        `**Priority**: ${priority}\n` +
        `**Assignee**: ${assignee}\n` +
        `**Created**: ${created}\n` +
        `**Last Updated**: ${updated}\n\n`;

      return response;
    }

    // Default fallback for other intents
    // Group by status for better organization
    const issuesByStatus = {};
    jiraData.issues.forEach((issue) => {
      const status = issue.fields.status?.name || "Unknown";
      if (!issuesByStatus[status]) {
        issuesByStatus[status] = [];
      }
      issuesByStatus[status].push(issue);
    });

    // Choose a varied opening phrase
    const openingPhrases = [
      `I found ${issueCount} issues related to your query.`,
      `There are ${issueCount} issues that match what you're looking for.`,
      `Your search returned ${issueCount} issues.`,
      `I've located ${issueCount} relevant issues in the project.`,
      `Looking at your query, I found ${issueCount} matching issues.`,
    ];

    let response = openingPhrases[Math.floor(Math.random() * openingPhrases.length)];
    if (totalCount > issueCount) {
      response += ` (Out of ${totalCount} total in the project)`;
    }
    response += `\n\n`;

    // Format in a more readable way
    for (const [status, issues] of Object.entries(issuesByStatus)) {
      response += `**${status}**:\n`;
      issues.forEach((issue) => {
        const assignee = issue.fields.assignee?.displayName || "Unassigned";
        response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (Assigned to: ${assignee})\n`;
      });
      response += "\n";
    }

    // Varied closing prompts
    const closingPrompts = [
      "Is there a specific issue you'd like to know more about?",
      "Would you like details about any of these issues?",
      "Let me know if you need more information on any particular issue.",
      "I can tell you more about any of these issues if you're interested.",
      "Would you like to dive deeper into any of these?",
    ];

    response += closingPrompts[Math.floor(Math.random() * closingPrompts.length)];

    return response;
  }
}

// Helper functions for extracting context from conversation
function extractRecentIssues(queries) {
  const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "gi");
  const issues = [];

  queries?.forEach((query) => {
    const matches = query.match(issueKeyPattern);
    if (matches) issues.push(...matches);
  });

  return [...new Set(issues)].slice(-3); // Only keep most recent 3 unique issues
}

function extractRecentAssignees(queries) {
  const assigneePattern = /assigned to ([\w\s]+)|(\w+)'s tasks/gi;
  const assignees = [];

  queries?.forEach((query) => {
    let match;
    while ((match = assigneePattern.exec(query)) !== null) {
      const assignee = match[1] || match[2];
      if (assignee) assignees.push(assignee.trim());
    }
  });

  return [...new Set(assignees)].slice(-3); // Only keep most recent 3 unique assignees
}

// Store conversation context
// Enhanced conversation memory with user preference tracking
// const conversationMemory = {};

// // Initialize or get conversation memory for a session
// function getConversationMemory(sessionId = "default") {
//   if (!conversationMemory[sessionId]) {
//     // Create a fully initialized memory object
//     conversationMemory[sessionId] = {
//       queries: [],
//       intents: [],
//       lastResponse: null,
//       lastIssueKey: null,
//       userPreferences: {
//         verbosityLevel: "medium",
//         favoriteAssignees: {},
//         favoriteStatuses: {},
//         frequentIssueTypes: {},
//         preferredSortOrder: null,
//         avgQueryLength: 0,
//         queryCount: 0,
//         lastActive: Date.now(),
//         sessionDuration: 0,
//         sessionStartTime: Date.now(),
//       },
//       responseMetrics: {
//         totalResponses: 0,
//         aiGeneratedResponses: 0,
//         fallbackResponses: 0,
//         emptyResultsResponses: 0,
//         averageResponseTime: 0,
//         totalResponseTime: 0,
//       },
//     };
//   } else {
//     // Ensure all required fields exist (defensive programming)
//     const memory = conversationMemory[sessionId];

//     if (!memory.queries) memory.queries = [];
//     if (!memory.intents) memory.intents = [];

//     // Initialize userPreferences if it doesn't exist
//     if (!memory.userPreferences) {
//       memory.userPreferences = {
//         verbosityLevel: "medium",
//         favoriteAssignees: {},
//         favoriteStatuses: {},
//         frequentIssueTypes: {},
//         preferredSortOrder: null,
//         avgQueryLength: 0,
//         queryCount: 0,
//         lastActive: Date.now(),
//         sessionDuration: 0,
//         sessionStartTime: Date.now(),
//       };
//     }

//     // Initialize responseMetrics if it doesn't exist
//     if (!memory.responseMetrics) {
//       memory.responseMetrics = {
//         totalResponses: 0,
//         aiGeneratedResponses: 0,
//         fallbackResponses: 0,
//         emptyResultsResponses: 0,
//         averageResponseTime: 0,
//         totalResponseTime: 0,
//       };
//     }
//   }

//   return conversationMemory[sessionId];
// }

// // Update conversation memory with new query and response
// function updateConversationMemory(sessionId, query, intent, response, responseTime, usedAI = true, hadResults = true) {
//   const memory = getConversationMemory(sessionId);

//   // Update query history
//   memory.queries.push(query);
//   if (memory.queries.length > 10) {
//     memory.queries.shift(); // Keep only the 10 most recent
//   }

//   // Update intent history
//   memory.intents.push(intent);
//   if (memory.intents.length > 10) {
//     memory.intents.shift();
//   }

//   // Store last response
//   memory.lastResponse = response;

//   // Track last viewed issue if applicable
//   const issueKeyMatch = query.match(new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i"));
//   if (issueKeyMatch && intent === "TASK_DETAILS") {
//     memory.lastIssueKey = issueKeyMatch[0];
//   }

//   // Ensure userPreferences exists
//   if (!memory.userPreferences) {
//     memory.userPreferences = {
//       verbosityLevel: "medium",
//       favoriteAssignees: {},
//       favoriteStatuses: {},
//       frequentIssueTypes: {},
//       preferredSortOrder: null,
//       avgQueryLength: 0,
//       queryCount: 0,
//       lastActive: null,
//       sessionDuration: 0,
//       sessionStartTime: Date.now(),
//     };
//   }

//   // Ensure responseMetrics exists
//   if (!memory.responseMetrics) {
//     memory.responseMetrics = {
//       totalResponses: 0,
//       aiGeneratedResponses: 0,
//       fallbackResponses: 0,
//       emptyResultsResponses: 0,
//       averageResponseTime: 0,
//       totalResponseTime: 0,
//     };
//   }

//   // Update user preferences based on this interaction
//   updateUserPreferences(memory, query, intent, response);

//   // Update response metrics
//   memory.responseMetrics.totalResponses++;
//   memory.responseMetrics.totalResponseTime += responseTime;
//   memory.responseMetrics.averageResponseTime = memory.responseMetrics.totalResponseTime / memory.responseMetrics.totalResponses;

//   if (usedAI) {
//     memory.responseMetrics.aiGeneratedResponses++;
//   } else {
//     memory.responseMetrics.fallbackResponses++;
//   }

//   if (!hadResults) {
//     memory.responseMetrics.emptyResultsResponses++;
//   }

//   // Update session metrics
//   memory.userPreferences.lastActive = Date.now();
//   memory.userPreferences.sessionDuration = memory.userPreferences.lastActive - memory.userPreferences.sessionStartTime;
//   memory.userPreferences.queryCount = (memory.userPreferences.queryCount || 0) + 1;

//   // Update average query length
//   const prevQueryCount = memory.userPreferences.queryCount - 1;
//   const totalQueryLength = memory.userPreferences.avgQueryLength * prevQueryCount + query.length;
//   memory.userPreferences.avgQueryLength = totalQueryLength / memory.userPreferences.queryCount;

//   return memory;
// }

// Update user preferences based on interactions
// function updateUserPreferences(memory, query, intent, response) {
//   // Make sure userPreferences exists
//   if (!memory.userPreferences) {
//     memory.userPreferences = {
//       verbosityLevel: "medium",
//       favoriteAssignees: {},
//       favoriteStatuses: {},
//       frequentIssueTypes: {},
//       preferredSortOrder: null,
//       avgQueryLength: 0,
//       queryCount: 0,
//       lastActive: Date.now(),
//       sessionDuration: 0,
//       sessionStartTime: Date.now(),
//     };
//   }

//   // Check verbosity preference based on query
//   if (/brief|short|quick|summary|summarize/i.test(query)) {
//     memory.userPreferences.verbosityLevel = "concise";
//   } else if (/detail|detailed|in depth|elaborate|full|comprehensive/i.test(query)) {
//     memory.userPreferences.verbosityLevel = "detailed";
//   }

//   // Track mentioned assignees
//   const assigneeMatch = query.match(/assigned to (\w+)|(\w+)'s tasks/i);
//   if (assigneeMatch) {
//     const assignee = assigneeMatch[1] || assigneeMatch[2];
//     if (!memory.userPreferences.favoriteAssignees) memory.userPreferences.favoriteAssignees = {};
//     memory.userPreferences.favoriteAssignees[assignee] = (memory.userPreferences.favoriteAssignees[assignee] || 0) + 1;
//   }

//   // Track mentioned statuses
//   const statusMatch = query.match(/status (?:is |=)?\s*"?(open|in progress|done|closed|to do)"?/i);
//   if (statusMatch) {
//     const status = statusMatch[1].toLowerCase();
//     if (!memory.userPreferences.favoriteStatuses) memory.userPreferences.favoriteStatuses = {};
//     memory.userPreferences.favoriteStatuses[status] = (memory.userPreferences.favoriteStatuses[status] || 0) + 1;
//   }

//   // Track issue types they're interested in
//   const typeMatch = query.match(/type (?:is |=)?\s*"?(bug|story|task|epic)"?/i);
//   if (typeMatch) {
//     const issueType = typeMatch[1].toLowerCase();
//     if (!memory.userPreferences.frequentIssueTypes) memory.userPreferences.frequentIssueTypes = {};
//     memory.userPreferences.frequentIssueTypes[issueType] = (memory.userPreferences.frequentIssueTypes[issueType] || 0) + 1;
//   }

//   // Track sort order preference
//   if (/sort by|order by/i.test(query)) {
//     if (/recent|latest|newest|updated/i.test(query)) {
//       memory.userPreferences.preferredSortOrder = "updated DESC";
//     } else if (/oldest|first|created/i.test(query)) {
//       memory.userPreferences.preferredSortOrder = "created ASC";
//     } else if (/priority/i.test(query)) {
//       memory.userPreferences.preferredSortOrder = "priority DESC";
//     } else if (/due date|deadline/i.test(query)) {
//       memory.userPreferences.preferredSortOrder = "duedate ASC";
//     }
//   }
// }

// Get user context for personalized responses
// function getUserContext(sessionId = "default") {
//   // Make sure we have a valid memory object with all required fields
//   const memory = getConversationMemory(sessionId);

//   // Ensure all required properties exist
//   if (!memory.userPreferences) {
//     memory.userPreferences = {
//       verbosityLevel: "medium",
//       favoriteAssignees: {},
//       favoriteStatuses: {},
//       frequentIssueTypes: {},
//       preferredSortOrder: null,
//       avgQueryLength: 0,
//       queryCount: 0,
//       lastActive: null,
//       sessionDuration: 0,
//       sessionStartTime: Date.now(),
//     };
//   }

//   if (!memory.responseMetrics) {
//     memory.responseMetrics = {
//       totalResponses: 0,
//       aiGeneratedResponses: 0,
//       fallbackResponses: 0,
//       emptyResultsResponses: 0,
//       averageResponseTime: 0,
//       totalResponseTime: 0,
//     };
//   }

//   // Calculate top preferences (safely)
//   const topAssignee =
//     Object.entries(memory.userPreferences.favoriteAssignees || {})
//       .sort((a, b) => b[1] - a[1])
//       .map(([name]) => name)[0] || null;

//   const topIssueType =
//     Object.entries(memory.userPreferences.frequentIssueTypes || {})
//       .sort((a, b) => b[1] - a[1])
//       .map(([type]) => type)[0] || null;

//   // Calculate recency metrics
//   const isReturningUser = (memory.userPreferences.sessionCount || 0) > 1;
//   const hasRecentActivity = memory.queries.length > 0;

//   // Get conversation flow information
//   const recentIntents = memory.intents.slice(-3);
//   const isFollowUp = detectFollowUpQuery(memory.queries);

//   return {
//     preferences: {
//       verbosityLevel: memory.userPreferences.verbosityLevel || "medium",
//       preferredSortOrder: memory.userPreferences.preferredSortOrder || null,
//       topAssignee,
//       topIssueType,
//     },
//     conversation: {
//       previousQueries: memory.queries.slice(-3),
//       previousIntents: recentIntents,
//       lastResponse: memory.lastResponse,
//       lastIssueKey: memory.lastIssueKey || null,
//       isFollowUp,
//       hasRecentActivity,
//     },
//     metrics: {
//       queryCount: memory.userPreferences.queryCount || 0,
//       avgQueryLength: memory.userPreferences.avgQueryLength || 0,
//       isReturningUser,
//       sessionDuration: memory.userPreferences.sessionDuration || 0,
//     },
//   };
// }

// Detect if the current query is a follow-up to the previous one
// function detectFollowUpQuery(queries) {
//   if (queries.length < 2) return false;

//   const currentQuery = queries[queries.length - 1].toLowerCase();

//   // Check for pronouns referring to previous results
//   if (/\b(it|them|those|these|this|that|they)\b/i.test(currentQuery)) {
//     return true;
//   }

//   // Check for queries that start with conjunctions
//   if (/^(and|but|also|what about|how about)/i.test(currentQuery)) {
//     return true;
//   }

//   // Check for very short queries that wouldn't make sense standalone
//   if (currentQuery.split(" ").length <= 3 && !/^(show|list|find|what|who|how|when)/i.test(currentQuery)) {
//     return true;
//   }

//   return false;
// }

// Apply user context to enhance search results
// function applyUserContext(jql, userContext) {
//   // Don't modify specific issue queries
//   if (jql.includes("key =")) {
//     return jql;
//   }

//   let enhancedJql = jql;

//   // Apply sort order preference if not already specified
//   if (userContext.preferences.preferredSortOrder && !jql.includes("ORDER BY")) {
//     enhancedJql += ` ORDER BY ${userContext.preferences.preferredSortOrder}`;
//   }

//   // For generic queries, consider prioritizing their favorite issue types
//   if (userContext.preferences.topIssueType && !jql.includes("issuetype") && userContext.metrics.queryCount > 5) {
//     // Only suggest their preferred issue type, don't force it
//     console.log(`User prefers ${userContext.preferences.topIssueType} issues, but using original query`);
//   }

//   return enhancedJql;
// }

// Generate personalized response templates based on user context
// function getPersonalizedSystemPrompt(userContext, intent) {
//   let personalization = "";

//   // Adjust verbosity based on preference
//   if (userContext.preferences.verbosityLevel === "concise") {
//     personalization += `
//       The user prefers concise, to-the-point responses. Keep your answer brief and focused.
//       Limit examples and avoid unnecessary details. Prioritize facts, numbers, and key insights.
//     `;
//   } else if (userContext.preferences.verbosityLevel === "detailed") {
//     personalization += `
//       The user prefers detailed, comprehensive responses. Provide thorough explanations and context.
//       Include relevant examples and supporting details. Offer additional insights where applicable.
//     `;
//   }

//   // Add personalization for returning users
//   if (userContext.metrics.queryCount > 5) {
//     personalization += `
//       This is a returning user who has asked ${userContext.metrics.queryCount} questions.
//       They tend to ask about ${userContext.preferences.topIssueType || "various issues"} 
//       ${userContext.preferences.topAssignee ? `assigned to ${userContext.preferences.topAssignee}` : ""}.
//     `;
//   }

//   // Add context for follow-ups
//   if (userContext.conversation.isFollowUp) {
//     personalization += `
//       This appears to be a follow-up to their previous question.
//       Their last query was: "${userContext.conversation.previousQueries[userContext.conversation.previousQueries.length - 2]}"
//       Your last response included information about ${summarizeLastResponse(userContext.conversation.lastResponse)}.
//     `;
//   }

//   // Add context for recently viewed issues
//   if (userContext.conversation.lastIssueKey) {
//     personalization += `
//       The user recently viewed issue ${userContext.conversation.lastIssueKey}.
//       If this query seems related, you may want to reference this issue in your response.
//     `;
//   }

//   return personalization;
// }

// Create a brief summary of the last response for context
// function summarizeLastResponse(lastResponse) {
//   if (!lastResponse) return "various project items";

//   // Extract key information from the last response
//   if (lastResponse.includes("status") && lastResponse.includes("project")) {
//     return "project status";
//   } else if (lastResponse.includes("timeline") || lastResponse.includes("due")) {
//     return "project timeline";
//   } else if (lastResponse.includes("blocker") || lastResponse.includes("impediment")) {
//     return "project blockers";
//   } else if (lastResponse.includes("workload") || lastResponse.includes("assigned")) {
//     return "team workload";
//   } else if (lastResponse.match(/NIHK-\d+/)) {
//     const issueKey = lastResponse.match(/NIHK-\d+/)[0];
//     return `issue ${issueKey}`;
//   } else {
//     return "various project items";
//   }
// }

// Helper to determine how many results to fetch based on intent and user context
function determineResultsLimit(intent, userContext) {
  // For detailed users, return more results
  const isDetailedUser = userContext.preferences.verbosityLevel === "detailed";

  switch (intent) {
    case "TASK_LIST":
    case "ASSIGNED_TASKS":
      return isDetailedUser ? 30 : 20;
    case "TIMELINE":
      return isDetailedUser ? 75 : 50;
    case "WORKLOAD":
      return 100; // Need comprehensive data for workload analysis
    case "PROJECT_STATUS":
      return isDetailedUser ? 75 : 50;
    default:
      return isDetailedUser ? 30 : 20;
  }
}

function handleQueryError(error, query, sessionId) {
  console.error("Error details:", error);

  // Create a friendly error message based on the type of error
  if (error.response && error.response.status === 400) {
    return "I'm having trouble understanding that query. Could you try rephrasing it?";
  } else if (error.response && error.response.status === 401) {
    return "I'm having trouble accessing the Jira data right now. This might be an authentication issue.";
  } else if (error.response && error.response.status === 404) {
    return "I couldn't find what you're looking for. Please check if the issue or project exists.";
  } else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
    return "I can't connect to Jira at the moment. Please check your connection and try again later.";
  } else if (error.message && error.message.includes("timeout")) {
    return "The request took too long to complete. Please try a simpler query or try again later.";
  } else if (error.message && error.message.includes("JQL")) {
    return "I couldn't properly format your query. Could you try phrasing it differently?";
  }

  // For general fallback errors
  const generalErrorMessages = [
    "I encountered an issue while processing your request. Could you try again?",
    "Something went wrong on my end. Let's try a different approach.",
    "I'm having trouble with that query. Could you rephrase it or try something else?",
    "I wasn't able to complete that request successfully. Let's try something simpler.",
  ];

  return generalErrorMessages[Math.floor(Math.random() * generalErrorMessages.length)];
}

function createFallbackResponse(data, intent, query) {
  // Default fallback
  let response = `I found ${data.issues ? data.issues.length : 0} issues related to your query.`;

  if (!data.issues || data.issues.length === 0) {
    return "I couldn't find any issues matching your criteria.";
  }

  // Add some basic formatting based on intent
  if (intent === "PROJECT_STATUS") {
    response = `## Project Status Overview\n\n`;

    // Group by status
    const statusCounts = {};
    data.issues.forEach((issue) => {
      const status = issue.fields.status?.name || "Unknown";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    // Add status breakdown
    for (const [status, count] of Object.entries(statusCounts)) {
      response += `• **${status}**: ${count} issues\n`;
    }

    // Add some recent issues
    response += `\n### Recent Activity\n`;
    for (let i = 0; i < Math.min(3, data.issues.length); i++) {
      const issue = data.issues[i];
      const status = issue.fields.status?.name || "Unknown";
      response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status})\n`;
    }
  } else if (intent === "TASK_DETAILS" && data.issues.length > 0) {
    const issue = data.issues[0];
    const status = issue.fields.status?.name || "Unknown";
    const assignee = issue.fields.assignee?.displayName || "Unassigned";
    const summary = issue.fields.summary || "No summary";
    const priority = issue.fields.priority?.name || "Not set";

    const title = createJiraLink(issue.key);
    response =
      `## ${title}: ${summary}\n\n` + `**Status**: ${status}\n` + `**Priority**: ${priority}\n` + `**Assignee**: ${assignee}\n`;
  } else {
    // Default formatting for other intents
    response += "\n\n";

    // Group issues by status
    const groupedByStatus = {};
    data.issues.forEach((issue) => {
      const status = issue.fields.status?.name || "Unknown";
      if (!groupedByStatus[status]) {
        groupedByStatus[status] = [];
      }
      groupedByStatus[status].push(issue);
    });

    // Format issues by status group
    for (const [status, issues] of Object.entries(groupedByStatus)) {
      response += `### ${status}\n`;

      issues.slice(0, 5).forEach((issue) => {
        const assignee = issue.fields.assignee?.displayName || "Unassigned";
        response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (Assigned to: ${assignee})\n`;
      });

      if (issues.length > 5) {
        response += `... and ${issues.length - 5} more ${status} issues.\n`;
      }

      response += "\n";
    }
  }

  return response;
}



// function determineFieldsForIntent(intent) {
//   // Set default fields for all queries
//   let fields = "summary,status,assignee,priority";

//   // Add intent-specific fields
//   if (intent === "PROJECT_STATUS") {
//     fields += ",updated,created,issuetype";
//   } else if (intent === "TIMELINE") {
//     fields += ",duedate,created,updated";
//   } else if (intent === "BLOCKERS" || intent === "HIGH_PRIORITY") {
//     fields += ",labels,issuetype";
//   } else if (intent === "TASK_LIST") {
//     fields += ",issuetype,created";
//   } else if (intent === "ASSIGNED_TASKS" || intent === "WORKLOAD") {
//     fields += ",duedate,issuetype";
//   } else if (intent === "TASK_DETAILS") {
//     fields += ",description,comment,created,updated,duedate,issuelinks,labels,components";
//   } else if (intent === "COMMENTS") {
//     fields += ",comment,updated";
//   } else if (intent === "SPRINT") {
//     fields += ",sprint,created,updated";
//   }

//   return fields;
// }

// BITBUCKET FUNCTIONALITY START
const BITBUCKET_URL = process.env.BITBUCKET_URL || "https://api.bitbucket.org/2.0";
const BITBUCKET_WORKSPACE = process.env.BITBUCKET_WORKSPACE;
const BITBUCKET_REPO = process.env.BITBUCKET_REPO;

const bitbucketAuth = {
  username: process.env.BITBUCKET_USER,
  password: process.env.BITBUCKET_API_TOKEN,
};
// Helper function to make Bitbucket API requests
async function callBitbucketApi(endpoint, params = {}) {
  try {
    // Determine the full URL based on if endpoint is already a full URL
    const url = endpoint.startsWith("http") ? endpoint : `${BITBUCKET_URL}${endpoint}`;

    const response = await axios.get(url, {
      params,
      auth: bitbucketAuth,
      headers: {
        Accept: "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Error calling Bitbucket API (${endpoint}):`, error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    }
    throw error;
  }
}

// Function to get repository information
async function getBitbucketRepos() {
  try {
    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      return await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}`);
    }
    // For Bitbucket Server
    else {
      return await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos`);
    }
  } catch (error) {
    console.error("Error fetching Bitbucket repositories:", error);
    throw error;
  }
}

// Function to get commits for a repository
async function getBitbucketCommits(repository, limit = 10) {
  try {
    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      return await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/commits`, {
        limit,
      });
    }
    // For Bitbucket Server
    else {
      return await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/commits`, {
        limit,
      });
    }
  } catch (error) {
    console.error(`Error fetching commits for ${repository}:`, error);
    throw error;
  }
}

// Function to get pull requests for a repository
async function getBitbucketPullRequests(repository, state = "OPEN", limit = 10) {
  try {
    console.log(`Fetching ${state} pull requests for ${repository}...`);

    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      // Ensure lowercase state for Bitbucket Cloud API
      const cloudState = state.toLowerCase();

      // First try with state parameter (should work for Cloud)
      let response = await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/pullrequests`, {
        state: cloudState,
        limit: limit * 2, // Fetch more to allow for filtering
      });

      // Log the raw response for debugging
      console.log(`Received ${response.values?.length || 0} pull requests from API`);

      // Verify that returned PRs actually match the requested state by checking the state field directly
      if (response.values && response.values.length > 0) {
        // Filter PRs to ensure they really are in the requested state
        const filteredPRs = response.values.filter((pr) => {
          // For OPEN state, check if it's neither MERGED nor DECLINED/CLOSED
          if (state.toUpperCase() === "OPEN") {
            return pr.state && pr.state.toLowerCase() === "open";
          }
          // For MERGED state
          else if (state.toUpperCase() === "MERGED") {
            return pr.state && pr.state.toLowerCase() === "merged";
          }
          // For DECLINED state
          else if (state.toUpperCase() === "DECLINED") {
            return pr.state && pr.state.toLowerCase() === "declined";
          }
          // For any other state, match exactly
          return pr.state && pr.state.toLowerCase() === cloudState;
        });

        console.log(`Filtered to ${filteredPRs.length} pull requests that are truly in ${state} state`);

        // Return the filtered results
        return {
          ...response,
          values: filteredPRs.slice(0, limit), // Apply the original limit to filtered results
        };
      }

      return response;
    }
    // For Bitbucket Server
    else {
      // Map states to Bitbucket Server state values
      let serverState = state.toUpperCase();
      if (serverState === "OPEN") {
        serverState = "OPEN";
      } else if (serverState === "MERGED") {
        serverState = "MERGED";
      } else if (serverState === "DECLINED") {
        serverState = "DECLINED";
      }

      let response = await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/pull-requests`, {
        state: serverState,
        limit: limit * 2,
      });

      // Log the raw response for debugging
      console.log(`Received ${response.values?.length || 0} pull requests from API`);

      // Verify pulled PRs actually match the requested state (if fields available)
      if (response.values && response.values.length > 0) {
        const filteredPRs = response.values.filter((pr) => {
          // For Bitbucket Server, the structure might be different
          // Look for status property that should indicate the PR state
          if (state.toUpperCase() === "OPEN") {
            return (!pr.closed && !pr.merged) || pr.state === "OPEN" || pr.status === "OPEN";
          } else if (state.toUpperCase() === "MERGED") {
            return pr.merged || pr.state === "MERGED" || pr.status === "MERGED";
          } else if (state.toUpperCase() === "DECLINED") {
            return pr.closed || pr.state === "DECLINED" || pr.status === "DECLINED";
          }
          return true; // If we can't determine state, include it
        });

        console.log(`Filtered to ${filteredPRs.length} pull requests that are truly in ${state} state`);

        // Return the filtered results
        return {
          ...response,
          values: filteredPRs.slice(0, limit),
        };
      }

      return response;
    }
  } catch (error) {
    console.error(`Error fetching pull requests for ${repository}:`, error);
    throw error;
  }
}

// Function to get branches for a repository
async function getBitbucketBranches(repository, limit = 10) {
  try {
    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      return await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/refs/branches`, {
        limit,
      });
    }
    // For Bitbucket Server
    else {
      return await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/branches`, {
        limit,
      });
    }
  } catch (error) {
    console.error(`Error fetching branches for ${repository}:`, error);
    throw error;
  }
}

// Function to get code changes related to a Jira issue
async function getCodeChangesForJiraIssue(issueKey, limit = 10) {
  try {
    // This implementation will vary based on how your Jira and Bitbucket are integrated
    // Option 1: If using Bitbucket Cloud with Jira Cloud integration
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      // Use the Jira development information API
      const jiraDevelopmentInfo = await axios.get(`${JIRA_URL}/rest/dev-status/1.0/issue/detail`, {
        params: {
          issueId: issueKey,
          applicationType: "bitbucket",
          dataType: "repository",
        },
        auth,
      });

      return jiraDevelopmentInfo.data;
    }
    // Option 2: Using commit message search (fallback method)
    else {
      // For simplicity, we'll check all repositories in the workspace
      const repos = await getBitbucketRepos();
      const repoList = repos.values || [];

      const results = [];

      // For each repo, search for commits mentioning the issue key
      for (const repo of repoList.slice(0, 5)) {
        // Limit to 5 repos to avoid overloading
        const repoName = repo.name || repo.slug;
        try {
          // Note: This is a simple implementation - more sophisticated would use actual Bitbucket API search
          const commits = await getBitbucketCommits(repoName, 100);

          // Filter commits that mention the issue key
          const relatedCommits = (commits.values || []).filter((commit) => commit.message && commit.message.includes(issueKey));

          if (relatedCommits.length > 0) {
            results.push({
              repository: repoName,
              commits: relatedCommits.slice(0, limit),
            });
          }
        } catch (error) {
          console.error(`Error searching commits in ${repoName}:`, error);
          // Continue with other repos even if one fails
        }
      }

      return { repositories: results };
    }
  } catch (error) {
    console.error(`Error finding code changes for Jira issue ${issueKey}:`, error);
    throw error;
  }
}

// Test function to verify Bitbucket connectivity
async function testBitbucketConnection() {
  try {
    console.log("Testing Bitbucket connection...");
    const repos = await getBitbucketRepos();
    console.log(`Successfully connected to Bitbucket! Found ${repos.size || repos.values?.length || 0} repositories.`);
    return true;
  } catch (error) {
    console.error("Failed to connect to Bitbucket:", error);
    return false;
  }
}

// Call the test function when server starts
testBitbucketConnection().then((success) => {
  if (success) {
    console.log("Bitbucket integration is ready.");
  } else {
    console.log("Bitbucket integration is not available. The chatbot will continue to work with Jira only.");
  }
});

// Intent detection for Bitbucket queries
async function detectBitbucketIntent(query) {
  // Lowercase and normalize the query for easier matching
  const lowercaseQuery = query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/[.,;?!]/g, ""); // Remove punctuation

  console.log(`Processing query for Bitbucket intent: "${lowercaseQuery}"`);

  // List of Bitbucket-specific keywords to help identify Bitbucket queries
  const bitbucketKeywords = [
    "repo",
    "repository",
    "repositories",
    "bitbucket",
    "git",
    "commit",
    "commits",
    "branch",
    "branches",
    "pull request",
    "pr",
    "prs",
    "merge",
    "source",
    "code",
    "clone",
    "push",
    "main",
    "master",
    "develop",
    "dev",
  ];

  // Quick test - if the query contains Bitbucket keywords, it's more likely to be a Bitbucket query
  const containsBitbucketKeywords = bitbucketKeywords.some((keyword) => lowercaseQuery.includes(keyword));

  // If there are clearly no Bitbucket keywords, return null early
  if (!containsBitbucketKeywords && !/(code|changes|repository)/i.test(lowercaseQuery)) {
    // Early rejection for clearly Jira-focused queries
    if (/project status|status of (the )?project|how is the project|project health|project progress/i.test(lowercaseQuery)) {
      console.log("Clearly a project status query - not Bitbucket related");
      return null;
    }
    return null;
  }

  // LATEST COMMIT DETECTION
  if (
      /\b(commit)\b.*\b(last|latest|newest|recent)\b/i.test(lowercaseQuery) ||
      /\b(last|latest|newest|recent)\b.*\bcommit\b/i.test(lowercaseQuery)
    ) {
      // Extract branch and repo if specified, else use defaults
      const branchMatch =
        lowercaseQuery.match(/on ([\w/-]+)/i) ||
        lowercaseQuery.match(/for ([\w/-]+)/i) ||
        lowercaseQuery.match(/in ([\w/-]+)/i) ||
        lowercaseQuery.match(/to ([\w/-]+)/i);
      const branch = branchMatch ? branchMatch[1] : "master";
      const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
      const repoMatch = query.match(repoPattern);
      const repoName = repoMatch ? repoMatch[1] : BITBUCKET_REPO;

      return {
        intent: "BITBUCKET_LATEST_COMMIT",
        branch,
        repository: repoName,
      };
    }

  // BRANCH COMMITS DETECTION
  // Improved patterns for branch commit queries
  if (
    /(last|latest|recent|newest|what was|what is|what are|what were|show|list|get|find)\s+.*\s+(commit|commits)(\s+on|\s+to|\s+in|\s+for)?\s+(the\s+)?([\w\/-]+)(\s+branch)?/i.test(
      lowercaseQuery
    ) ||
    /(commit|commits)(\s+on|\s+to|\s+in|\s+for)\s+(the\s+)?([\w\/-]+)(\s+branch)?/i.test(lowercaseQuery) ||
    /(branch|on branch)\s+([\w\/-]+).*\s+(commit|commits)/i.test(lowercaseQuery)
  ) {
    // Extract the branch name using multiple patterns
    let branchMatch =
      lowercaseQuery.match(/(commit|commits)(?:\s+on|\s+to|\s+in|\s+for)\s+(?:the\s+)?([\w\/-]+)(?:\s+branch)?/i) ||
      lowercaseQuery.match(
        /(?:last|latest|recent|newest|what was|what is|what are|what were|show|list|get|find)\s+.*\s+(?:commit|commits)(?:\s+on|\s+to|\s+in|\s+for)?\s+(?:the\s+)?([\w\/-]+)(?:\s+branch)?/i
      ) ||
      lowercaseQuery.match(/(?:branch|on branch)\s+([\w\/-]+).*\s+(?:commit|commits)/i);

    let branchName = null;
    if (branchMatch) {
      branchName = branchMatch[branchMatch.length - 1]; // Take the last capture group which should be the branch name
    }

    // If we can't identify a clear branch name, default to "master" or "main"
    if (!branchName && /(last|latest|recent) commit/i.test(lowercaseQuery)) {
      branchName = "master"; // Default to master if just asking about latest commit
    }

    // Extract repository name if specified
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);
    const repoName = repoMatch ? repoMatch[1] : null;

    console.log(`Detected branch commit query - Branch: ${branchName}, Repository: ${repoName || "default"}`);

    return {
      intent: "BITBUCKET_BRANCH_COMMITS",
      branch: branchName,
      repository: repoName || BITBUCKET_REPO,
    };
  }

  // REPOSITORY LISTING DETECTION
  // Match various ways of asking about repositories
  if (
    /(?:list|show|display|get|find|what|which)(?:\s+me)?(?:\s+all|\s+the)?\s+(?:repos|repositories)/i.test(lowercaseQuery) ||
    /(?:repos|repositories)(?:\s+do we have|\s+are there|\s+exist|\s+available|\s+in bitbucket)/i.test(lowercaseQuery) ||
    /(?:how many|are there any|do we have any)(?:\s+repos|repositories)/i.test(lowercaseQuery) ||
    /(?:bitbucket|git)\s+(?:repos|repositories)/i.test(lowercaseQuery) ||
    (/(repos|repositories)/.test(lowercaseQuery) && !/(jira|comment|project status)/.test(lowercaseQuery))
  ) {
    return "BITBUCKET_REPOS";
  }

  // GENERAL COMMITS DETECTION
  // Enhanced patterns for commit queries
  if (
    /(?:recent|latest|last|newest|what was|what is|what were|latest)\s+(?:commits)/i.test(lowercaseQuery) ||
    /(?:show|list|find|get)(?:\s+me)?(?:\s+the)?(?:\s+recent|\s+latest|\s+last)?\s+commits/i.test(lowercaseQuery) ||
    /(?:commit history|history of commits|commit log|git log)/i.test(lowercaseQuery) ||
    /(?:what|when)(?:\s+commits|changes)(?:\s+were made|\s+happened|\s+occurred)/i.test(lowercaseQuery) ||
    (/commit/.test(lowercaseQuery) && !/jira|task|issue|project status/.test(lowercaseQuery))
  ) {
    // Check for repository specification
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);

    if (repoMatch) {
      return {
        intent: "BITBUCKET_COMMITS",
        repository: repoMatch[1],
      };
    }

    return "BITBUCKET_COMMITS";
  }

  // BRANCHES DETECTION
  // Enhanced patterns for branch queries
  if (
    /(?:list|show|display|get|find|what|which)(?:\s+me)?(?:\s+all|\s+the)?\s+branches/i.test(lowercaseQuery) ||
    /(?:branches)(?:\s+do we have|\s+are there|\s+exist|\s+available)/i.test(lowercaseQuery) ||
    /(?:how many|are there any|do we have any)(?:\s+branches)/i.test(lowercaseQuery) ||
    /(?:branch list|branch information|branch details|available branches)/i.test(lowercaseQuery) ||
    (/(branch|branches)/.test(lowercaseQuery) && !/(jira|issue|task|project status)/.test(lowercaseQuery))
  ) {
    // Check for repository specification
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);

    if (repoMatch) {
      return {
        intent: "BITBUCKET_BRANCHES",
        repository: repoMatch[1],
      };
    }

    return "BITBUCKET_BRANCHES";
  }

  // PULL REQUEST DETECTION - MORE PRECISE PATTERNS
  // Enhanced patterns for pull request queries with stricter matching
  if (
    // Must explicitly mention "pull request" or "PR" and have clear intent indicators
    // Specific phrases about pull requests
    (/(?:open|active|current|all|any|new|closed|merged|recent|latest)\s+(?:pull requests?|prs?)/i.test(lowercaseQuery) ||
      /(?:show|list|display|get|find)(?:\s+me)?(?:\s+the|\s+all)?(?:\s+open|\s+active|\s+current|\s+all|\s+any|\s+new|\s+closed|\s+merged|\s+recent|\s+latest)?\s+(?:pull requests?|prs?)/i.test(
        lowercaseQuery
      ) ||
      /(?:do we have|are there|exist|are there any|is there|have|has)(?:\s+any|\s+open|\s+active|\s+current|\s+all|\s+new|\s+closed|\s+merged|\s+recent|\s+latest)?\s+(?:pull requests?|prs?)/i.test(
        lowercaseQuery
      )) &&
    // Exclude ambiguous project status queries
    !/(?:project status|status of project|project health|project progress)/i.test(lowercaseQuery)
  ) {
    // Determine PR state if specified
    let prState = "OPEN"; // Default to open
    if (/closed|completed|done|finished|resolved|merged/i.test(lowercaseQuery)) {
      prState = "MERGED"; // Assuming closed typically means merged in Git context
    } else if (/declined|rejected|canceled/i.test(lowercaseQuery)) {
      prState = "DECLINED";
    }

    // Check for repository specification
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);

    if (repoMatch) {
      return {
        intent: "BITBUCKET_PULL_REQUESTS",
        repository: repoMatch[1],
        state: prState,
      };
    }

    return {
      intent: "BITBUCKET_PULL_REQUESTS",
      state: prState,
    };
  }

  // REPOSITORY INFO DETECTION
  // Enhanced patterns for repository info queries
  if (
    /(?:tell|info|about|details|show|describe|what is|what's)(?:\s+me)?\s+(?:about|on)?\s+(?:repo(?:sitory)?|project)\s+([a-zA-Z0-9_-]+)/i.test(
      lowercaseQuery
    ) ||
    /(?:repo(?:sitory)?|project)\s+([a-zA-Z0-9_-]+)(?:\s+info|details|status|overview)/i.test(lowercaseQuery)
  ) {
    // Extract repository name
    const repoMatch = query.match(/(?:repo(?:sitory)?|project)\s+([a-zA-Z0-9_-]+)/i);
    const repoName = repoMatch ? repoMatch[1] : null;

    if (repoName) {
      return {
        intent: "BITBUCKET_REPO_INFO",
        repository: repoName,
      };
    }
  }

  // JIRA ISSUE CODE CHANGES DETECTION
  // Enhanced patterns for code changes related to Jira issues
  const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
  const issueMatch = query.match(issueKeyPattern);

  if (issueMatch && /(?:code|commit|push|change|changes|modification|update|related to|associated with|linked to)/i.test(lowercaseQuery)) {
    return {
      intent: "BITBUCKET_ISSUE_CODE",
      issueKey: issueMatch[0],
    };
  }

  // REPOSITORY SEARCH
  // If query mentions a specific repository but intent is unclear
  const generalRepoPattern = new RegExp(`(?:in|for|from|about)\\s+(?:the\\s+)?repo(?:sitory)?\\s+([\\w-]+)`, "i");
  const generalRepoMatch = query.match(generalRepoPattern);

  if (generalRepoMatch && containsBitbucketKeywords) {
    return {
      intent: "BITBUCKET_REPO_INFO",
      repository: generalRepoMatch[1],
    };
  }

  // If no specific Bitbucket intent is detected, return null
  // This will allow the query to be processed by the Jira intent detection
  return null;
}

// Main handler for Bitbucket queries
async function handleBitbucketQuery(query, intent, meta = {}) {
  try {
    console.log(`Handling Bitbucket query with intent: ${intent}`);
    console.log("Meta data:", meta);

    // If default repo is not set, but needed for the query
    const needsRepo = ["BITBUCKET_COMMITS", "BITBUCKET_BRANCHES", "BITBUCKET_PULL_REQUESTS", "BITBUCKET_BRANCH_COMMITS"].includes(intent);

    if (needsRepo && !meta.repository && !BITBUCKET_REPO) {
      // No repository specified and no default - ask user to specify
      return `I need to know which repository you're asking about. Please specify a repository name in your query, for example: "Show ${intent
        .toLowerCase()
        .replace("bitbucket_", "")} in my-repository"`;
    }

    // Handle different Bitbucket intents
    switch (intent) {
      case "BITBUCKET_REPOS":
        return await handleRepositoriesQuery();

      case "BITBUCKET_COMMITS":
        const repository = meta.repository || BITBUCKET_REPO;
        return await handleCommitsQuery(repository, meta.limit);

      case "BITBUCKET_BRANCH_COMMITS":
        const repo = meta.repository || BITBUCKET_REPO;
        const branch = meta.branch || "master";
        return await handleBranchCommitsQuery(repo, branch);

      case "BITBUCKET_LATEST_COMMIT":
      const repoLatest = meta.repository || BITBUCKET_REPO;
      const branchLatest = meta.branch || "master";
      return await handleBranchCommitsQuery(repoLatest, branchLatest, "latestOnly");

      case "BITBUCKET_BRANCHES":
        const branchRepo = meta.repository || BITBUCKET_REPO;
        return await handleBranchesQuery(branchRepo);

      case "BITBUCKET_PULL_REQUESTS":
        const prRepo = meta.repository || BITBUCKET_REPO;
        const state = meta.state || "OPEN";
        return await handlePullRequestsQuery(prRepo, state);

      case "BITBUCKET_REPO_INFO":
        if (!meta.repository && !BITBUCKET_REPO) {
          return "Please specify which repository you want information about.";
        }
        return await handleRepositoryInfoQuery(meta.repository || BITBUCKET_REPO);

      case "BITBUCKET_ISSUE_CODE":
        if (!meta.issueKey) {
          return "Please specify a valid Jira issue key to find related code changes.";
        }
        return await handleIssueCodeQuery(meta.issueKey);
      
        


      default:
        throw new Error(`Unknown Bitbucket intent: ${intent}`);
    }
  } catch (error) {
    console.error(`Error handling Bitbucket query: ${error.message}`);

    // Provide a more helpful error message based on the error type
    if (error.response) {
      if (error.response.status === 404) {
        // Not found errors
        if (meta.repository) {
          return `I couldn't find the repository "${meta.repository}". Please check if the repository name is correct.`;
        } else if (meta.branch) {
          return `I couldn't find the branch "${meta.branch}" in the repository. Please check if the branch name is correct.`;
        }
        return `I couldn't find the requested resource. Please check if the names are correct.`;
      } else if (error.response.status === 401 || error.response.status === 403) {
        // Authentication/authorization errors
        return `I don't have permission to access this information. This could be due to repository permissions or authentication issues.`;
      }
    }

    // Generic error
    return `I encountered an error while fetching information from Bitbucket: ${error.message}. Please check your query and try again.`;
  }
}

// Handler for listing repositories
async function handleRepositoriesQuery() {
  try {
    console.log("Fetching all repositories...");
    const reposData = await getBitbucketRepos();
    const repos = reposData.values || [];

    if (repos.length === 0) {
      return "I couldn't find any repositories in the workspace. This could be because there are no repositories or you don't have access to view them.";
    }

    // Process repository data to extract useful information
    const processedRepos = repos.map((repo) => {
      return {
        name: repo.name || repo.slug,
        slug: repo.slug,
        description: repo.description || "No description available",
        updated: repo.updated_on ? new Date(repo.updated_on).toLocaleDateString() : "Unknown",
        language: repo.language || "Not specified",
        mainBranch: repo.mainbranch?.name || "master",
        url: repo.links?.html?.href || "",
        isPrivate: repo.is_private || false,
      };
    });

    // Sort repositories by name for consistent output
    processedRepos.sort((a, b) => a.name.localeCompare(b.name));

    // Generate response
    let response = `## Bitbucket Repositories\n\n`;
    response += `I found ${repos.length} repositories in the workspace:\n\n`;

    // Group repositories by language for better organization
    const reposByLanguage = {};
    processedRepos.forEach((repo) => {
      const lang = repo.language || "Other";
      if (!reposByLanguage[lang]) {
        reposByLanguage[lang] = [];
      }
      reposByLanguage[lang].push(repo);
    });

    // Check if we should group by language (only if there are multiple languages)
    const languages = Object.keys(reposByLanguage);

    if (languages.length > 1 && processedRepos.length > 5) {
      // Group by language
      languages.sort().forEach((language) => {
        const langRepos = reposByLanguage[language];
        response += `### ${language} Repositories (${langRepos.length})\n\n`;

        langRepos.forEach((repo) => {
          response += `**${repo.name}**${repo.isPrivate ? " (Private)" : ""}\n`;
          response += `• Description: ${repo.description}\n`;
          response += `• Last Updated: ${repo.updated}\n`;
          if (repo.mainBranch) {
            response += `• Main Branch: ${repo.mainBranch}\n`;
          }
          response += `\n`;
        });
      });
    } else {
      // Simple list without grouping
      processedRepos.forEach((repo, index) => {
        response += `### ${index + 1}. ${repo.name}${repo.isPrivate ? " (Private)" : ""}\n`;
        response += `• Description: ${repo.description}\n`;
        response += `• Last Updated: ${repo.updated}\n`;
        response += `• Language: ${repo.language || "Not specified"}\n`;
        if (repo.mainBranch) {
          response += `• Main Branch: ${repo.mainBranch}\n`;
        }
        response += `\n`;
      });
    }

    response += `\nYou can ask about a specific repository by saying "Tell me about [repository name]" or "Show commits in [repository name]".`;

    return response;
  } catch (error) {
    console.error("Error fetching repositories:", error);
    throw error;
  }
}

// Handler for commit history
async function handleCommitsQuery(repository, limit = 10) {
  if (!repository) {
    return "Please specify a repository to view commits. For example: 'Show commits in my-repo'";
  }

  try {
    console.log(`Fetching commits for repository ${repository}...`);
    const commitsData = await getBitbucketCommits(repository, limit || 10);
    const commits = commitsData.values || [];

    if (commits.length === 0) {
      return `I couldn't find any commits in the repository '${repository}'. The repository might be empty or you might not have access to it.`;
    }

    let response = `## Recent Commits in ${repository}\n\n`;

    // Group commits by author for better organization if there are multiple authors
    const commitsByAuthor = {};
    commits.forEach((commit) => {
      const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

      if (!commitsByAuthor[author]) {
        commitsByAuthor[author] = [];
      }

      commitsByAuthor[author].push(commit);
    });

    const authors = Object.keys(commitsByAuthor);

    // Decide whether to group by author based on number of authors and commits
    if (authors.length > 1 && commits.length > 5) {
      // Group by author
      authors.forEach((author) => {
        const authorCommits = commitsByAuthor[author];
        response += `### Commits by ${author} (${authorCommits.length})\n\n`;

        authorCommits.forEach((commit, index) => {
          const date =
            commit.date || commit.authorTimestamp ? new Date(commit.date || commit.authorTimestamp).toLocaleString() : "Unknown date";

          const message = commit.message ? commit.message.split("\n")[0] : "No commit message";

          const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

          response += `**${index + 1}. ${hash}** (${date})\n`;
          response += `${message}\n\n`;
        });
      });
    } else {
      // Chronological list
      commits.forEach((commit, index) => {
        const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

        const date =
          commit.date || commit.authorTimestamp ? new Date(commit.date || commit.authorTimestamp).toLocaleString() : "Unknown date";

        const message = commit.message ? commit.message.split("\n")[0] : "No commit message";

        const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

        response += `### ${index + 1}. Commit ${hash}\n`;
        response += `**Author**: ${author}\n`;
        response += `**Date**: ${date}\n`;
        response += `**Message**: ${message}\n\n`;
      });
    }

    // Add navigation tips
    response += `\nYou can also ask about commits on a specific branch by saying "Show commits on [branch name] in ${repository}".`;

    return response;
  } catch (error) {
    console.error(`Error fetching commits for repository ${repository}:`, error);
    throw error;
  }
}

// Handler for branches
async function handleBranchesQuery(repository) {
  if (!repository) {
    return "Please specify a repository to view branches. For example: 'Show branches in my-repo'";
  }

  try {
    console.log(`Fetching branches for repository ${repository}...`);
    const branchesData = await getBitbucketBranches(repository);
    const branches = branchesData.values || [];

    if (branches.length === 0) {
      return `I couldn't find any branches in the repository '${repository}'. The repository might be new or you might not have access to it.`;
    }

    let response = `## Branches in ${repository}\n\n`;
    response += `I found ${branches.length} branches:\n\n`;

    // Improved branch type detection with more patterns
    const groupedBranches = {
      main: [],
      develop: [],
      feature: [],
      bugfix: [],
      hotfix: [],
      release: [],
      other: [],
    };

    branches.forEach((branch) => {
      const name = branch.name;

      // Determine branch type based on name pattern
      let type = "other";
      if (name === "main" || name === "master") {
        type = "main";
      } else if (name === "develop" || name === "development" || name === "dev") {
        type = "develop";
      } else if (name.match(/^feature\/|^feat\/|^features\//i)) {
        type = "feature";
      } else if (name.match(/^bugfix\/|^fix\/|^bug\//i)) {
        type = "bugfix";
      } else if (name.match(/^hotfix\/|^urgent\//i)) {
        type = "hotfix";
      } else if (name.match(/^release\/|^rel\//i)) {
        type = "release";
      }

      groupedBranches[type].push(branch);
    });

    // Main/master branches first (most important)
    if (groupedBranches.main.length > 0) {
      response += `### Main Branches\n`;
      groupedBranches.main.forEach((branch) => {
        response += `• **${branch.name}**`;
        if (branch.isDefault) response += " (default)";
        response += "\n";
      });
      response += `\n`;
    }

    // Develop branches next
    if (groupedBranches.develop.length > 0) {
      response += `### Development Branches\n`;
      groupedBranches.develop.forEach((branch) => {
        response += `• ${branch.name}\n`;
      });
      response += `\n`;
    }

    // Release branches (important for versioning)
    if (groupedBranches.release.length > 0) {
      response += `### Release Branches\n`;
      groupedBranches.release.forEach((branch) => {
        response += `• ${branch.name}\n`;
      });
      response += `\n`;
    }

    // Feature branches
    if (groupedBranches.feature.length > 0) {
      response += `### Feature Branches (${groupedBranches.feature.length})\n`;

      // If there are many feature branches, group them
      if (groupedBranches.feature.length > 10) {
        // Show only 10 most recent ones
        const sorted = [...groupedBranches.feature].sort((a, b) => {
          const dateA = a.target?.date ? new Date(a.target.date) : new Date(0);
          const dateB = b.target?.date ? new Date(b.target.date) : new Date(0);
          return dateB - dateA; // Sort newest first
        });

        sorted.slice(0, 10).forEach((branch) => {
          response += `• ${branch.name}\n`;
        });

        response += `... and ${groupedBranches.feature.length - 10} more feature branches\n`;
      } else {
        // Show all feature branches
        groupedBranches.feature.forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
      }
      response += `\n`;
    }

    // Bugfix branches
    if (groupedBranches.bugfix.length > 0) {
      response += `### Bugfix Branches (${groupedBranches.bugfix.length})\n`;

      // Similar approach as feature branches for many bugfixes
      if (groupedBranches.bugfix.length > 10) {
        const sorted = [...groupedBranches.bugfix].sort((a, b) => {
          const dateA = a.target?.date ? new Date(a.target.date) : new Date(0);
          const dateB = b.target?.date ? new Date(b.target.date) : new Date(0);
          return dateB - dateA; // Sort newest first
        });

        sorted.slice(0, 10).forEach((branch) => {
          response += `• ${branch.name}\n`;
        });

        response += `... and ${groupedBranches.bugfix.length - 10} more bugfix branches\n`;
      } else {
        groupedBranches.bugfix.forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
      }
      response += `\n`;
    }

    // Hotfix branches
    if (groupedBranches.hotfix.length > 0) {
      response += `### Hotfix Branches\n`;
      groupedBranches.hotfix.forEach((branch) => {
        response += `• ${branch.name}\n`;
      });
      response += `\n`;
    }

    // Other branches
    if (groupedBranches.other.length > 0) {
      response += `### Other Branches (${groupedBranches.other.length})\n`;

      if (groupedBranches.other.length > 10) {
        // Only show 10 if there are many
        groupedBranches.other.slice(0, 10).forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
        response += `... and ${groupedBranches.other.length - 10} more branches\n`;
      } else {
        groupedBranches.other.forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
      }
      response += `\n`;
    }

    // Add tips for related queries
    response += `\nYou can ask about commits on a specific branch by saying "Show commits on [branch name] in ${repository}".`;

    return response;
  } catch (error) {
    console.error(`Error fetching branches for repository ${repository}:`, error);
    throw error;
  }
}

async function handleBranchCommitsQuery(repository, branch, mode = "") {
  try {
    if (!repository) {
      return "Please specify a repository to view commits. For example: 'Show last commit on master in my-repo'";
    }

    if (!branch) {
      return "Please specify which branch you want to see commits for. For example: 'Show last commit on master'";
    }



    console.log(`Fetching commits for branch ${branch} in repository ${repository}...`);

    // Get branch information first to verify it exists
    let branchesData;
    try {
      branchesData = await getBitbucketBranches(repository);
    } catch (error) {
      console.error(`Error fetching branches for repository ${repository}:`, error);
      return `I couldn't access the branches in repository '${repository}'. Please check if the repository name is correct.`;
    }

    const branches = branchesData.values || [];
    const branchExists = branches.some((b) => b.name.toLowerCase() === branch.toLowerCase());

    if (!branchExists) {
      // If exact branch not found, look for similar branches
      const similarBranches = branches.filter((b) => b.name.toLowerCase().includes(branch.toLowerCase())).map((b) => b.name);

      if (similarBranches.length > 0) {
        return (
          `I couldn't find a branch named "${branch}" in repository "${repository}". Did you mean one of these branches?\n\n` +
          similarBranches.map((b) => `• ${b}`).join("\n")
        );
      } else {
        return (
          `I couldn't find a branch named "${branch}" in repository "${repository}". Available branches are:\n\n` +
          branches
            .slice(0, 10)
            .map((b) => `• ${b.name}`)
            .join("\n") +
          (branches.length > 10 ? `\n... and ${branches.length - 10} more branches.` : "")
        );
      }
    }

    // Now fetch commits for this branch
    let commitsData;
    try {
        const commitLimit = mode === "latestOnly" ? 1 : 10;
      // For Bitbucket Cloud
      if (BITBUCKET_URL.includes("bitbucket.org")) {
        commitsData = await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/commits/${branch}`, {
          limit: commitLimit,
        });
      }
      // For Bitbucket Server
      else {
        commitsData = await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/commits`, {
          until: branch,
          limit: commitLimit,
        });
      }
    } catch (error) {
      console.error(`Error fetching commits for branch ${branch}:`, error);
      return `I encountered an error fetching commits for branch "${branch}" in repository "${repository}". The error was: ${error.message}`;
    }

    const commits = commitsData.values || [];

    if (commits.length === 0) {
      return `I couldn't find any commits on branch "${branch}" in repository "${repository}".`;
    }

    // Format the response based on whether they asked for the latest commit or all commits
    if (mode === "latestOnly") {
      // Just show the most recent commit
      const commit = commits[0];
      const author = commit.author?.user?.display_name || commit.author?.raw || "Unknown";
      const date = commit.date || commit.authorTimestamp
        ? new Date(commit.date || commit.authorTimestamp).toLocaleString()
        : "Unknown date";
      const message = commit.message || "No commit message";
      const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

      let response = `## Latest Commit on "${branch}" in ${repository}\n\n`;
      response += `**Commit**: ${hash}\n`;
      response += `**Author**: ${author}\n`;
      response += `**Date**: ${date}\n`;
      response += `**Message**: ${message}\n\n`;

      return response;
    } else {
      // Show multiple recent commits
      let response = `## Recent Commits on "${branch}" in ${repository}\n\n`;

      commits.forEach((commit, index) => {
        const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

        const date =
          commit.date || commit.authorTimestamp ? new Date(commit.date || commit.authorTimestamp).toLocaleString() : "Unknown date";

        const message = commit.message
          ? commit.message.split("\n")[0] // Get only the first line of the commit message
          : "No commit message";

        const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

        response += `### ${index + 1}. Commit ${hash}\n`;
        response += `**Author**: ${author}\n`;
        response += `**Date**: ${date}\n`;
        response += `**Message**: ${message}\n\n`;
      });

      return response;
    }
  } catch (error) {
    console.error(`Error handling branch commits query:`, error);
    throw error;
  }
}

// Handler for pull requests
async function handlePullRequestsQuery(repository) {
  try {
    // If no repository specified, try to get pull requests from all repositories
    if (!repository) {
      // First get list of repositories
      const reposData = await getBitbucketRepos();
      const repos = reposData.values || [];

      if (repos.length === 0) {
        return "I couldn't find any repositories to check for pull requests.";
      }

      // Track total PRs across all repos
      let totalPRs = 0;
      let pullRequestsByRepo = [];

      // Check first 5 repositories (to avoid too many API calls)
      const reposToCheck = repos.slice(0, 5);

      // Add debugging info
      console.log(`Checking ${reposToCheck.length} repositories for pull requests...`);

      for (const repo of reposToCheck) {
        const repoName = repo.name || repo.slug;
        try {
          console.log(`Checking repository: ${repoName}`);
          const prData = await getBitbucketPullRequests(repoName, "OPEN");
          const repoPRs = prData.values || [];

          // Double-check the PR states for this repo (extra validation)
          const trulyOpenPRs = repoPRs.filter((pr) => {
            // Comprehensive check for what makes a PR truly "open"
            const isOpen =
              (pr.state && pr.state.toLowerCase() === "open") ||
              (pr.status && pr.status.toLowerCase() === "open") ||
              // Also check that it's not merged or closed
              (!pr.closed && !pr.merged);

            if (!isOpen) {
              console.log(
                `Filtering out PR "${pr.title}" because it appears to be not truly open: state=${pr.state}, merged=${pr.merged}, closed=${pr.closed}`
              );
            }

            return isOpen;
          });

          console.log(`Repository ${repoName}: Found ${repoPRs.length} PRs, ${trulyOpenPRs.length} are truly open`);

          if (trulyOpenPRs.length > 0) {
            pullRequestsByRepo.push({
              repository: repoName,
              pullRequests: trulyOpenPRs,
            });
            totalPRs += trulyOpenPRs.length;
          }
        } catch (error) {
          console.error(`Error fetching pull requests for ${repoName}:`, error);
          // Continue with other repos
        }
      }

      // Build the response
      if (totalPRs === 0) {
        if (repos.length > 5) {
          return `I checked 5 repositories and didn't find any open pull requests. There are ${
            repos.length - 5
          } more repositories I didn't check.`;
        } else {
          return "I didn't find any open pull requests in any of the repositories.";
        }
      }

      let response = `## Open Pull Requests\n\n`;
      response += `I found a total of ${totalPRs} open pull requests across ${pullRequestsByRepo.length} repositories:\n\n`;

      // List PRs by repository
      for (const repoPRs of pullRequestsByRepo) {
        response += `### ${repoPRs.repository} (${repoPRs.pullRequests.length} PRs)\n\n`;

        // Show details for each PR
        repoPRs.pullRequests.forEach((pr, index) => {
          const title = pr.title || "No title";
          const author = pr.author ? pr.author.display_name || pr.author.username : "Unknown";
          const created = pr.created_on ? new Date(pr.created_on).toLocaleDateString() : "Unknown";
          const sourceRef = pr.source ? pr.source.branch.name : "Unknown branch";
          const targetRef = pr.destination ? pr.destination.branch.name : "Unknown branch";

          response += `**${index + 1}. ${title}**\n`;
          response += `**Author**: ${author}\n`;
          response += `**Created**: ${created}\n`;
          response += `**From**: ${sourceRef} → **To**: ${targetRef}\n\n`;
        });
      }

      // If there are more repositories we didn't check
      if (repos.length > 5) {
        response += `Note: I only checked 5 out of ${repos.length} repositories. To see pull requests for a specific repository, ask "Show pull requests in [repository-name]".\n`;
      }

      return response;
    }

    // If a specific repository was provided, get PRs for just that repository
    console.log(`Fetching pull requests for specific repository: ${repository}`);
    const prData = await getBitbucketPullRequests(repository, "OPEN");
    let pullRequests = prData.values || [];

    // Extra validation step - filter to only truly open PRs
    pullRequests = pullRequests.filter((pr) => {
      const isOpen =
        (pr.state && pr.state.toLowerCase() === "open") || (pr.status && pr.status.toLowerCase() === "open") || (!pr.closed && !pr.merged);

      if (!isOpen) {
        console.log(`Filtering out PR "${pr.title}" because it appears to be not truly open`);
      }

      return isOpen;
    });

    console.log(`Found ${pullRequests.length} truly open pull requests in ${repository}`);

    if (pullRequests.length === 0) {
      return `I couldn't find any open pull requests in the repository '${repository}'.`;
    }

    let response = `## Open Pull Requests in ${repository}\n\n`;
    response += `I found ${pullRequests.length} open pull requests:\n\n`;

    pullRequests.forEach((pr, index) => {
      const title = pr.title || "No title";
      const author = pr.author ? pr.author.display_name || pr.author.username : "Unknown";
      const created = pr.created_on ? new Date(pr.created_on).toLocaleDateString() : "Unknown";
      const sourceRef = pr.source ? pr.source.branch.name : "Unknown branch";
      const targetRef = pr.destination ? pr.destination.branch.name : "Unknown branch";

      response += `### ${index + 1}. ${title}\n`;
      response += `**Author**: ${author}\n`;
      response += `**Created**: ${created}\n`;
      response += `**From**: ${sourceRef} → **To**: ${targetRef}\n`;

      // Add reviewers if available
      if (pr.reviewers && pr.reviewers.length > 0) {
        const reviewers = pr.reviewers.map((r) => r.display_name || r.username).join(", ");
        response += `**Reviewers**: ${reviewers}\n`;
      }

      // Add comment count if available
      if (pr.comment_count) {
        response += `**Comments**: ${pr.comment_count}\n`;
      }

      // Add description (first few lines)
      if (pr.description) {
        const shortDesc = pr.description.split("\n")[0];
        response += `**Description**: ${shortDesc}${pr.description.length > shortDesc.length ? "..." : ""}\n`;
      }

      // Add PR state explicitly for clarity
      response += `**State**: ${pr.state || "Open"}\n`;

      response += `\n`;
    });

    return response;
  } catch (error) {
    console.error(`Error handling pull requests query:`, error);
    throw error;
  }
}

// Handler for repository info
async function handleRepositoryInfoQuery(repository) {
  if (!repository) {
    return "Please specify a repository. For example: 'Tell me about repo-name'";
  }

  try {
    // For Bitbucket Cloud
    let repoInfo;
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      repoInfo = await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}`);
    }
    // For Bitbucket Server
    else {
      repoInfo = await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}`);
    }

    // Get additional info from other endpoints
    const [commitsData, branchesData, prData] = await Promise.all([
      getBitbucketCommits(repository, 5).catch(() => ({ values: [] })),
      getBitbucketBranches(repository).catch(() => ({ values: [] })),
      getBitbucketPullRequests(repository, "OPEN").catch(() => ({ values: [] })),
    ]);

    const commits = commitsData.values || [];
    const branches = branchesData.values || [];
    const pullRequests = prData.values || [];

    // Build the response
    let response = `## Repository: ${repoInfo.name || repository}\n\n`;

    // Basic info
    response += `**Description**: ${repoInfo.description || "No description"}\n`;
    if (repoInfo.language) {
      response += `**Main Language**: ${repoInfo.language}\n`;
    }
    if (repoInfo.created_on) {
      response += `**Created**: ${new Date(repoInfo.created_on).toLocaleDateString()}\n`;
    }
    if (repoInfo.updated_on) {
      response += `**Last Updated**: ${new Date(repoInfo.updated_on).toLocaleDateString()}\n`;
    }
    if (repoInfo.size) {
      response += `**Size**: ${(repoInfo.size / 1024).toFixed(2)} KB\n`;
    }

    // Stats
    response += `\n### Statistics\n`;
    response += `• ${branches.length} branches\n`;
    response += `• ${pullRequests.length} open pull requests\n`;

    // Recent activity
    if (commits.length > 0) {
      response += `\n### Recent Commits\n`;
      commits.forEach((commit, i) => {
        const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";
        const message = commit.message ? commit.message.split("\n")[0] : "No message";
        const date = commit.date ? new Date(commit.date).toLocaleDateString() : "Unknown";

        response += `• ${date} - ${author}: ${message}\n`;
      });
    }

    // Open PRs
    if (pullRequests.length > 0) {
      response += `\n### Open Pull Requests\n`;
      pullRequests.slice(0, 3).forEach((pr, i) => {
        const author = pr.author ? pr.author.display_name || pr.author.username : "Unknown";
        response += `• ${pr.title} (by ${author})\n`;
      });

      if (pullRequests.length > 3) {
        response += `• ... and ${pullRequests.length - 3} more pull requests\n`;
      }
    }

    return response;
  } catch (error) {
    console.error(`Error fetching repository info for ${repository}:`, error);
    throw error;
  }
}

// Handler for Jira issue code changes
async function handleIssueCodeQuery(issueKey) {
  if (!issueKey) {
    return "Please specify a Jira issue key. For example: 'Show code changes for NIHK-123'";
  }

  try {
    const codeChanges = await getCodeChangesForJiraIssue(issueKey);

    // Check if we got any results
    if (!codeChanges.repositories || codeChanges.repositories.length === 0) {
      return `I couldn't find any code changes related to issue ${issueKey}.`;
    }

    let response = `## Code Changes Related to ${issueKey}\n\n`;

    codeChanges.repositories.forEach((repo) => {
      response += `### Repository: ${repo.repository}\n\n`;

      if (repo.commits && repo.commits.length > 0) {
        response += `Found ${repo.commits.length} related commits:\n\n`;

        repo.commits.forEach((commit, index) => {
          const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

          const date = commit.date ? new Date(commit.date).toLocaleString() : "Unknown date";

          const message = commit.message || "No commit message";
          const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

          response += `**${index + 1}. Commit ${hash}**\n`;
          response += `**Author**: ${author}\n`;
          response += `**Date**: ${date}\n`;
          response += `**Message**: ${message}\n\n`;
        });
      } else {
        response += "No specific commits found.\n\n";
      }
    });

    return response;
  } catch (error) {
    console.error(`Error fetching code changes for issue ${issueKey}:`, error);
    throw error;
  }
}
// BITBUCKET FUNCTIONALITY END

// CONFLUENCE FUNCTIONALITY START
const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const CONFLUENCE_USER = process.env.JIRA_USER;
const CONFLUENCE_API_TOKEN = process.env.JIRA_API_TOKEN;

const confluenceAuth = {
  username: CONFLUENCE_USER,
  password: CONFLUENCE_API_TOKEN,
};

// Store indexed pages for quick searching
const confluenceIndex = new Map();
const pageHierarchy = new Map();

// Helper function to make Confluence API requests
async function callConfluenceApi(endpoint, params = {}) {
  try {
    const apiUrl = endpoint.startsWith("http") ? endpoint : `${CONFLUENCE_URL}/rest/api${endpoint}`;

    const response = await axios.get(apiUrl, {
      params,
      auth: confluenceAuth,
      headers: {
        Accept: "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Error calling Confluence API (${endpoint}):`, error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    }
    throw error;
  }
}

// Function to extract page ID from Confluence URL
function extractPageIdFromUrl(confluenceUrl) {
  try {
    const parsedUrl = new URL(confluenceUrl);

    // Handle different Confluence URL formats
    // Format 1: /pages/viewpage.action?pageId=123456
    if (parsedUrl.pathname.includes("/pages/viewpage.action")) {
      const pageId = parsedUrl.searchParams.get("pageId");
      if (pageId) return pageId;
    }

    // Format 2: /display/SPACE/Page+Title
    if (parsedUrl.pathname.includes("/display/")) {
      const pathParts = parsedUrl.pathname.split("/");
      const spaceKey = pathParts[2];
      const pageTitle = decodeURIComponent(pathParts[3] || "").replace(/\+/g, " ");
      return { spaceKey, pageTitle };
    }

    // Format 3: /spaces/SPACE/pages/123456/Page+Title
    if (parsedUrl.pathname.includes("/spaces/") && parsedUrl.pathname.includes("/pages/")) {
      const pathParts = parsedUrl.pathname.split("/");
      const pageIdIndex = pathParts.indexOf("pages") + 1;
      if (pageIdIndex < pathParts.length) {
        return pathParts[pageIdIndex];
      }
    }

    return null;
  } catch (error) {
    console.error("Error parsing Confluence URL:", error);
    return null;
  }
}

// Function to get page content by ID
async function getConfluencePageById(pageId) {
  try {
    const page = await callConfluenceApi(`/content/${pageId}`, {
      expand: "body.storage,ancestors,children.page,space,version",
    });

    return page;
  } catch (error) {
    console.error(`Error fetching page ${pageId}:`, error);
    throw error;
  }
}

// Function to get page content by space and title
async function getConfluencePageByTitle(spaceKey, title) {
  try {
    const results = await callConfluenceApi("/content", {
      spaceKey: spaceKey,
      title: title,
      expand: "body.storage,ancestors,children.page,space,version",
    });

    if (results.results && results.results.length > 0) {
      return results.results[0];
    }

    return null;
  } catch (error) {
    console.error(`Error fetching page by title ${title} in space ${spaceKey}:`, error);
    throw error;
  }
}

// Function to get child pages
async function getChildPages(pageId, depth = 2) {
  try {
    const children = await callConfluenceApi(`/content/${pageId}/child/page`, {
      expand: "body.storage,ancestors,children.page,space,version",
      limit: 50,
    });

    let allChildren = children.results || [];

    // Recursively get children if depth > 1
    if (depth > 1) {
      for (const child of children.results || []) {
        try {
          const grandChildren = await getChildPages(child.id, depth - 1);
          allChildren = allChildren.concat(grandChildren);
        } catch (error) {
          console.error(`Error fetching children of page ${child.id}:`, error);
        }
      }
    }

    return allChildren;
  } catch (error) {
    console.error(`Error fetching child pages for ${pageId}:`, error);
    return [];
  }
}

async function getAllChildPagesRecursive(pageId, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    console.log(`Reached maximum depth ${maxDepth} for page ${pageId}`);
    return [];
  }

  try {
    console.log(`Fetching children for page ${pageId} at depth ${currentDepth}`);

    const children = await callConfluenceApi(`/content/${pageId}/child/page`, {
      expand: "body.storage,ancestors,children.page,space,version",
      limit: 100, // Increased limit
    });

    let allChildren = children.results || [];
    console.log(`Found ${allChildren.length} direct children for page ${pageId}`);

    // Recursively get children of children
    for (const child of children.results || []) {
      try {
        const grandChildren = await getAllChildPagesRecursive(child.id, maxDepth, currentDepth + 1);
        allChildren = allChildren.concat(grandChildren);

        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching children of page ${child.id}:`, error.message);
      }
    }

    return allChildren;
  } catch (error) {
    console.error(`Error fetching child pages for ${pageId} at depth ${currentDepth}:`, error);
    return [];
  }
}

async function autoIndexMainPage() {
  if (!CONFLUENCE_MAIN_PAGE_ID) {
    console.log("CONFLUENCE_MAIN_PAGE_ID not set. Skipping auto-indexing.");
    return null;
  }

  try {
    console.log(`🚀 Starting auto-indexing of main page: ${CONFLUENCE_MAIN_PAGE_ID}`);

    // Get the main page
    const mainPage = await getConfluencePageById(CONFLUENCE_MAIN_PAGE_ID);
    if (!mainPage) {
      throw new Error(`Main page ${CONFLUENCE_MAIN_PAGE_ID} not found`);
    }

    // Extract and store the main page
    const mainPageData = extractStructuredContent(mainPage);
    confluenceIndex.set(mainPage.id, mainPageData);
    console.log(`✅ Indexed main page: ${mainPage.title} (${mainPage.id})`);

    // Get ALL child pages recursively
    console.log("🔍 Fetching all child pages...");
    const allChildPages = await getAllChildPagesRecursive(mainPage.id);

    console.log(`📊 Found ${allChildPages.length} total child pages`);

    // Index all child pages
    let indexedCount = 0;
    for (const childPage of allChildPages) {
      try {
        const childData = extractStructuredContent(childPage);
        confluenceIndex.set(childPage.id, childData);

        // Store parent-child relationship
        if (!pageHierarchy.has(mainPage.id)) {
          pageHierarchy.set(mainPage.id, []);
        }
        pageHierarchy.get(mainPage.id).push(childPage.id);

        indexedCount++;
        console.log(`✅ Indexed child page ${indexedCount}/${allChildPages.length}: ${childPage.title} (${childPage.id})`);

        // Add small delay to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`❌ Error indexing child page ${childPage.id}:`, error.message);
      }
    }

    const summary = {
      mainPage: mainPageData,
      totalChildPages: allChildPages.length,
      indexedChildPages: indexedCount,
      totalIndexed: 1 + indexedCount,
      failedPages: allChildPages.length - indexedCount,
    };

    console.log(`🎉 Auto-indexing complete! Indexed ${summary.totalIndexed} pages total`);
    console.log(`📊 Main: 1, Children: ${summary.indexedChildPages}/${summary.totalChildPages}`);

    return summary;
  } catch (error) {
    console.error("❌ Error during auto-indexing:", error);
    throw error;
  }
}

// Function to extract text content from Confluence storage format
function extractTextFromConfluenceContent(storageBody) {
  if (!storageBody || !storageBody.value) {
    return "";
  }

  try {
    const $ = cheerio.load(storageBody.value);

    // Remove script and style elements
    $("script, style").remove();

// Detect Confluence-style task lists and format them as markdown
$("ac\\:task-list ac\\:task").each(function () {
  const status = $(this).find("ac\\:task-status").text().trim();
  const body = $(this).find("ac\\:task-body").text().trim();
  const checked = status === "checked" ? "x" : " ";
  $(this).replaceWith(`- [${checked}] ${body}\n`);
});

// Extract the full cleaned text
let text = $("body").text().trim();
text = text.replace(/\s+/g, " ");

    return text;
  } catch (error) {
    console.error("Error extracting text from Confluence content:", error);
    return storageBody.value || "";
  }
}

// Function to extract structured content from Confluence page
function extractStructuredContent(page) {
  const textContent = extractTextFromConfluenceContent(page.body?.storage);

  return {
    id: page.id,
    title: page.title,
    spaceKey: page.space?.key,
    spaceName: page.space?.name,
    content: textContent,
    url: `${CONFLUENCE_URL}/pages/viewpage.action?pageId=${page.id}`,
    lastModified: page.version?.when,
    author: page.version?.by?.displayName,
    ancestors: page.ancestors?.map((a) => ({ id: a.id, title: a.title })) || [],
  };
}

// Function to index a page and its children
async function indexConfluencePage(pageIdentifier, includeChildren = true) {
  try {
    let page;

    // Get the main page
    if (typeof pageIdentifier === "string" && !isNaN(pageIdentifier)) {
      // It's a page ID
      page = await getConfluencePageById(pageIdentifier);
    } else if (typeof pageIdentifier === "object") {
      // It's a space key and title
      page = await getConfluencePageByTitle(pageIdentifier.spaceKey, pageIdentifier.pageTitle);
    } else {
      throw new Error("Invalid page identifier");
    }

    if (!page) {
      throw new Error("Page not found");
    }

    // Extract and store the main page
    const mainPageData = extractStructuredContent(page);
    confluenceIndex.set(page.id, mainPageData);

    console.log(`Indexed main page: ${page.title} (${page.id})`);

    // Get and index child pages if requested
    let childPages = [];
    if (includeChildren) {
      childPages = await getChildPages(page.id, 3); // Get 3 levels deep

      for (const childPage of childPages) {
        const childData = extractStructuredContent(childPage);
        confluenceIndex.set(childPage.id, childData);

        // Store parent-child relationship
        if (!pageHierarchy.has(page.id)) {
          pageHierarchy.set(page.id, []);
        }
        pageHierarchy.get(page.id).push(childPage.id);

        console.log(`Indexed child page: ${childPage.title} (${childPage.id})`);
      }
    }

    return {
      mainPage: mainPageData,
      childPages: childPages.map(extractStructuredContent),
      totalIndexed: 1 + childPages.length,
    };
  } catch (error) {
    console.error("Error indexing Confluence page:", error);
    throw error;
  }
}

// Enhanced Confluence intent detection for knowledge base queries
async function detectConfluenceKnowledgeBaseIntent(query) {
  const lowercaseQuery = query.toLowerCase().trim();
  
  // Check for refresh/reindex commands
  if (/(?:refresh|reload|reindex|update).*(?:confluence|docs|documentation|knowledge|pages)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_REFRESH';
  }
  
  // Check for knowledge base status
  if (/(?:how many|status|info|information).*(?:pages|docs|indexed|confluence)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_STATUS';
  }
  
  // If we have indexed content, treat most questions as knowledge base queries
  if (confluenceIndex.size > 0) {
    // General question patterns that should search the knowledge base
    if (
      /(?:what|how|when|where|why|explain|tell me|describe|show me|find|search|latest updates?|recent updates?|meeting notes?|minutes?|protocol|notes?|documentation|docs?|guide|manual|process|procedure|summary|overview)/i
      .test(lowercaseQuery)) {
      // Exclude obvious Jira/Bitbucket queries
      if (!/(?:jira|task|issue|ticket|bug|story|epic|sprint|bitbucket|repo|repository|commit|branch|pull request)/i.test(lowercaseQuery)) {
        return 'CONFLUENCE_KNOWLEDGE_SEARCH';
      }
    }
  }
  
  return null;
}

// Enhanced handler for knowledge base queries
async function handleConfluenceKnowledgeQuery(query, intent) {
  try {
    switch (intent) {
      case "CONFLUENCE_REFRESH":
        return await handleRefreshQuery();

      case "CONFLUENCE_STATUS":
        return await handleStatusQuery();

      case "CONFLUENCE_KNOWLEDGE_SEARCH":
        return await handleKnowledgeSearchQuery(query);

      default:
        throw new Error(`Unknown Confluence knowledge base intent: ${intent}`);
    }
  } catch (error) {
    console.error(`Error handling Confluence knowledge query: ${error.message}`);
    return `I encountered an error while searching the knowledge base: ${error.message}`;
  }
}

// Handler for refresh queries
async function handleRefreshQuery() {
  try {
    console.log("🔄 Refreshing indexed content...");

    // Clear existing index
    confluenceIndex.clear();
    pageHierarchy.clear();

    // Re-index everything
    const result = await autoIndexMainPage();

    if (result) {
      return (
        `## 🔄 Knowledge Base Refreshed\n\n` +
        `Successfully refreshed ${result.totalIndexed} pages\n\n` +
        `**Details:**\n` +
        `• Main page: ${result.mainPage?.title || "Unknown"}\n` +
        `• Child pages: ${result.indexedChildPages || 0}\n` +
        `• Total indexed: ${result.totalIndexed || 0}\n\n` +
        `You can now ask questions about the updated content!`
      );
    }

    return `## ❌ Refresh Failed\n\nFailed to refresh content.`;
  } catch (error) {
    console.error("Error refreshing content:", error);
    return `## ❌ Refresh Failed\n\n${error.message}`;
  }
}

// Handler for status queries
async function handleStatusQuery() {
  if (confluenceIndex.size === 0) {
    return (
      `## 📊 Knowledge Base Status\n\n` +
      `**Status:** Not initialized\n` +
      `**Indexed pages:** 0\n\n` +
      `The system should auto-index your main page on startup. Try restarting the server or ask me to refresh the knowledge base.`
    );
  }

  const pages = Array.from(confluenceIndex.values());
  const spaces = [...new Set(pages.map((p) => p.spaceName || p.spaceKey))];
  const lastModified = pages.reduce((latest, page) => {
    const pageDate = new Date(page.lastModified);
    return pageDate > latest ? pageDate : latest;
  }, new Date(0));

  return (
    `## 📊 Knowledge Base Status\n\n` +
    `**Status:** ✅ Active\n` +
    `**Indexed pages:** ${confluenceIndex.size}\n` +
    `**Spaces covered:** ${spaces.join(", ")}\n` +
    `**Last updated:** ${lastModified.toLocaleDateString()}\n\n` +
    `**Available commands:**\n` +
    `• Ask any question to search the knowledge base\n` +
    `• "Refresh confluence docs" to update content\n` +
    `• "Search for [topic]" to find specific information`
  );
}

// Function to search indexed pages
function searchIndexedPages(query, pageId = null) {
  const results = [];
  const searchTerms = query
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length > 2);

  // If pageId is specified, search only that page and its children
  let pagesToSearch;
  if (pageId) {
    pagesToSearch = [pageId];
    if (pageHierarchy.has(pageId)) {
      pagesToSearch = pagesToSearch.concat(pageHierarchy.get(pageId));
    }
  } else {
    pagesToSearch = Array.from(confluenceIndex.keys());
  }

  for (const id of pagesToSearch) {
    const pageData = confluenceIndex.get(id);
    if (!pageData) continue;

    const searchableText = `${pageData.title} ${pageData.content}`.toLowerCase();

    // Calculate relevance score
    let score = 0;
    for (const term of searchTerms) {
      const titleMatches = (pageData.title.toLowerCase().match(new RegExp(term, "g")) || []).length;
      const contentMatches = (pageData.content.toLowerCase().match(new RegExp(term, "g")) || []).length;

      score += titleMatches * 10 + contentMatches; // Title matches are weighted more
    }

    if (score > 0) {
      results.push({
        ...pageData,
        relevanceScore: score,
      });
    }
  }

  // Sort by relevance score
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results;
}

// Intent detection for Confluence queries
async function detectConfluenceIntent(query) {
  const lowercaseQuery = query.toLowerCase().trim();

  // Check for Confluence URLs in the query
  const confluenceUrlPattern = /https?:\/\/[^\/\s]+\/(?:wiki\/|display\/|pages\/|spaces\/)/i;
  const urlMatch = query.match(confluenceUrlPattern);

  if (urlMatch) {
    return {
      intent: "CONFLUENCE_INDEX_URL",
      url: urlMatch[0],
    };
  }

  // Check for refresh/reindex commands
  if (/(?:refresh|reload|reindex|update).*(?:confluence|docs|documentation|knowledge|pages)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_REFRESH';
  }
  
  // Check for knowledge base status
  if (/(?:how many|status|info|information).*(?:pages|docs|indexed|confluence)/i.test(lowercaseQuery) ||
      /confluence.*(?:status|info|pages)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_STATUS';
  }

  // If we have indexed content, treat knowledge-seeking questions as Confluence queries
  if (confluenceIndex.size > 0) {
    // General question patterns that should search the knowledge base
    if (/(?:what|how|when|where|why|explain|tell me|describe|show me|find|search|documentation|docs|guide|process|procedure)/i.test(lowercaseQuery)) {
      // Exclude obvious Jira/Bitbucket queries
      if (!/(?:jira|task|issue|ticket|bug|story|epic|sprint|assignee|status.*project|project.*status|bitbucket|repo|repository|commit|branch|pull request|pr)/i.test(lowercaseQuery)) {
        return 'CONFLUENCE_KNOWLEDGE_SEARCH';
      }
    }
  }

  // Pattern for searching indexed content
  if (/(?:search|find|look for|tell me about).*(?:in|from|on)\s+(?:confluence|wiki|docs|documentation)/i.test(lowercaseQuery)) {
    return "CONFLUENCE_SEARCH";
  }

  // Pattern for questions about indexed content  
  if (/(?:confluence|wiki|documentation|docs|page|article|knowledge base|kb|guide|manual|procedure|process)/i.test(lowercaseQuery) && 
      /(?:what|how|when|where|why|tell me|explain|describe)/i.test(lowercaseQuery)) {
    return "CONFLUENCE_QUESTION";
  }

  // Index management
  if (/(?:index|add|include).*(?:confluence|wiki|page)/i.test(lowercaseQuery)) {
    return "CONFLUENCE_INDEX_REQUEST";
  }

  return null;
}

// Main handler for Confluence queries
async function handleConfluenceQuery(query, intent, meta = {}) {
  try {
    console.log(`Handling Confluence query with intent: ${intent}`);

    switch (intent) {
      case "CONFLUENCE_INDEX_URL":
        return await handleIndexUrlQuery(meta.url);

      case "CONFLUENCE_SEARCH":
        return await handleSearchQuery(query);

      case "CONFLUENCE_QUESTION":
        return await handleQuestionQuery(query);

      case "CONFLUENCE_INDEX_REQUEST":
        return await handleIndexRequestQuery(query);

      case 'CONFLUENCE_REFRESH':
        return await handleRefreshQuery();
        
      case 'CONFLUENCE_STATUS':
        return await handleStatusQuery();
        
      case 'CONFLUENCE_KNOWLEDGE_SEARCH':
        return await handleKnowledgeSearchQuery(query);

      default:
        throw new Error(`Unknown Confluence intent: ${intent}`);
    }
  } catch (error) {
    console.error(`Error handling Confluence query: ${error.message}`);

    if (error.response) {
      if (error.response.status === 404) {
        return `I couldn't find the requested Confluence page. Please check if the URL is correct and you have access to it.`;
      } else if (error.response.status === 401 || error.response.status === 403) {
        return `I don't have permission to access this Confluence content. Please check the authentication settings.`;
      }
    }

    return `I encountered an error while accessing Confluence: ${error.message}. Please try again.`;
  }
}

// Handler for indexing a URL
async function handleIndexUrlQuery(confluenceUrl) {
  try {
    const pageIdentifier = extractPageIdFromUrl(confluenceUrl);

    if (!pageIdentifier) {
      return `I couldn't extract a valid page identifier from that URL. Please make sure it's a valid Confluence page URL.`;
    }

    const result = await indexConfluencePage(pageIdentifier, true);

    let response = `## Successfully Indexed Confluence Content\n\n`;
    response += `**Main Page**: ${result.mainPage.title}\n`;
    response += `**Space**: ${result.mainPage.spaceName || result.mainPage.spaceKey}\n`;
    response += `**Total Pages Indexed**: ${result.totalIndexed}\n\n`;

    if (result.childPages.length > 0) {
      response += `**Child Pages Indexed**:\n`;
      result.childPages.slice(0, 5).forEach((page, index) => {
        response += `• ${page.title}\n`;
      });

      if (result.childPages.length > 5) {
        response += `• ... and ${result.childPages.length - 5} more pages\n`;
      }
    }

    response += `\nYou can now ask questions about this content! Try asking:\n`;
    response += `• "What does the ${result.mainPage.title} page say about...?"\n`;
    response += `• "Search for information about [topic]"\n`;
    response += `• "Explain the process for..."\n`;

    return response;
  } catch (error) {
    console.error("Error indexing URL:", error);
    throw error;
  }
}

// Handler for search queries
async function handleSearchQuery(query) {
  try {
    // Extract search terms
    const searchMatch = query.match(/(?:search|find|look for)(?:\s+for)?\s+(.+?)(?:\s+in\s+|$)/i);
    const searchTerms = searchMatch ? searchMatch[1] : query.replace(/(?:search|find|look for|in confluence|in wiki|in docs)/gi, "").trim();

    if (!searchTerms) {
      return `Please specify what you'd like to search for. For example: "Search for user authentication process"`;
    }

    const results = searchIndexedPages(searchTerms);

    if (results.length === 0) {
      return `I couldn't find any information about "${searchTerms}" in the indexed Confluence pages. You might need to index more pages or try different search terms.`;
    }

    let response = `## Search Results for "${searchTerms}"\n\n`;
    response += `Found ${results.length} relevant page${results.length > 1 ? "s" : ""}:\n\n`;

    results.slice(0, 5).forEach((result, index) => {
      response += `### ${index + 1}. ${result.title}\n`;
      response += `**Space**: ${result.spaceName || result.spaceKey}\n`;

      // Show a relevant excerpt
      const excerpt = extractRelevantExcerpt(result.content, searchTerms);
      if (excerpt) {
        response += `**Excerpt**: ${excerpt}\n`;
      }

      response += `**URL**: [View Page](${result.url})\n\n`;
    });

    if (results.length > 5) {
      response += `... and ${results.length - 5} more results.\n\n`;
    }

    response += `You can ask follow-up questions about any of these pages!`;

    return response;
  } catch (error) {
    console.error("Error handling search query:", error);
    throw error;
  }
}

// Handler for question queries
async function handleQuestionQuery(query) {
  try {
    // Use the search function to find relevant pages
    const results = searchIndexedPages(query);

    if (results.length === 0) {
      return `I couldn't find information to answer your question in the indexed Confluence pages. Try indexing more pages or rephrasing your question.`;
    }

    // Use the top results to generate an answer
    const topResults = results.slice(0, 3);
    const context = topResults.map((result) => ({
      title: result.title,
      content: result.content.substring(0, 1000), // Limit content length
      url: result.url,
    }));

    try {
      // Generate AI response based on the Confluence content
      const systemPrompt = `
        You are a helpful assistant that answers questions based on Confluence documentation.
        Use the provided Confluence page content to answer the user's question accurately.
        
        Guidelines:
        - Base your answer primarily on the provided content
        - If the content doesn't fully answer the question, say so
        - Include references to the relevant pages
        - Format your response with markdown
        - Be concise but comprehensive
        - If the content is not sufficient, suggest the user to check the pages for more details
        - If there is no answer available, politely inform the user, like a fallback response
        - If the content is about Confluence, do not access Jira or Bitbucket content
        - If there are typos in the question, try to correct them based on the context, if not, ask them to retype the question
        - Use the provided Confluence documentation as a primary source of information, answer all questions based on the Confluence pages, as if I am asking GPT-4 directly
        - Regard the 'checkboxes' ([ ]) as a task list and TO DO list, and answer the question based on the context of the task list
        
        User question: "${query}"
      `;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Confluence content: ${JSON.stringify(context)}\n\nAnswer the question: "${query}"`,
          },
        ],
        temperature: 0.3, // Lower temperature for more factual responses
      });

      let response = aiResponse.choices[0].message.content.trim();

      // Add source references
      response += `\n\n**Sources**:\n`;
      topResults.forEach((result, index) => {
        response += `• [${result.title}](${result.url})\n`;
      });

      return response;
    } catch (aiError) {
      console.error("Error generating AI response:", aiError);

      // Fallback to showing relevant excerpts
      let response = `Based on the indexed Confluence pages, here's what I found:\n\n`;

      topResults.forEach((result, index) => {
        response += `### ${result.title}\n`;
        const excerpt = extractRelevantExcerpt(result.content, query);
        response += `${excerpt}\n\n`;
      });

      response += `**Sources**:\n`;
      topResults.forEach((result) => {
        response += `• [${result.title}](${result.url})\n`;
      });

      return response;
    }
  } catch (error) {
    console.error("Error handling question query:", error);
    throw error;
  }
}

// Handler for index requests
async function handleIndexRequestQuery(query) {
  return (
    `To index a Confluence page, please provide the full URL of the page you'd like me to index. For example:\n\n` +
    `"Index this page: https://your-company.atlassian.net/wiki/spaces/DOCS/pages/123456/Page+Title"\n\n` +
    `I'll automatically index the page and its child pages so you can ask questions about the content.`
  );
}

// Helper function to extract relevant excerpts
function extractRelevantExcerpt(content, searchTerms, maxLength = 200) {
  const terms = searchTerms
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length > 2);

  for (const term of terms) {
    const index = content.toLowerCase().indexOf(term);
    if (index !== -1) {
      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, start + maxLength);
      let excerpt = content.substring(start, end);

      // Clean up the excerpt
      if (start > 0) excerpt = "..." + excerpt;
      if (end < content.length) excerpt = excerpt + "...";

      return excerpt;
    }
  }

  // If no specific terms found, return the beginning
  return content.substring(0, maxLength) + (content.length > maxLength ? "..." : "");
}

// Handler for knowledge search queries
async function handleKnowledgeSearchQuery(query) {
  const results = searchIndexedPages(query, null); // Search all indexed pages

  if (results.length === 0) {
    return (
      `## 🔍 No Results Found\n\n` +
      `I couldn't find information about "${query}" in the ${confluenceIndex.size} indexed pages.\n\n` +
      `Try:\n` +
      `• Using different keywords\n` +
      `• Being more specific\n` +
      `• Asking about general topics covered in the documentation\n\n` +
      `Or ask me to "refresh confluence docs" to update the content.`
    );
  }

  try {
    // Generate AI answer based on search results
    const context = results.slice(0, 3).map((result) => ({
      title: result.title,
      content: result.content.substring(0, 1500),
      url: result.url,
      relevanceScore: result.relevanceScore,
    }));

    const systemPrompt = `
      You are a helpful documentation assistant answering questions about the IHK Akademie Relaunch External project.
      Answer the user's question based on the provided Confluence documentation.
      
      Guidelines:
      - Use the provided content to give a comprehensive answer
      - Structure your response with clear headings using ##
      - Include specific details and examples when available
      - If the content doesn't fully answer the question, say so
      - Be thorough but concise
      - Use markdown formatting for better readability
      - If the content is about Confluence, do not access Jira or Bitbucket content
      - If there are typos in the question, try to correct them based on the context, if not, ask them to retype the question
      - Use the provided Confluence documentation as a primary source of information, answer all questions based on the Confluence pages, as if I am asking GPT-4 directly
      - if the titles don't match correctly, try to correct them based on the context or search for similar titles in the documentation

      
      User question: "${query}"
    `;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Documentation content: ${JSON.stringify(context)}\n\nAnswer: "${query}"`,
        },
      ],
      temperature: 0.2,
    });

    let response = aiResponse.choices[0].message.content.trim();

    // Add source references
    response += `\n\n## 📚 Sources\n\n`;
    results.slice(0, 3).forEach((result, index) => {
      response += `${index + 1}. **[${result.title}](${result.url})**\n`;
    });

    if (results.length > 3) {
      response += `\n*...and ${results.length - 3} more relevant pages*`;
    }

    return response;
  } catch (aiError) {
    console.error("Error generating AI response:", aiError);

    // Fallback to showing search results
    let response = `## 🔍 Search Results for "${query}"\n\n`;

    results.slice(0, 3).forEach((result, index) => {
      response += `### ${index + 1}. ${result.title}\n\n`;
      const excerpt = extractRelevantExcerpt(result.content, query, 300);
      response += `${excerpt}\n\n`;
      response += `**[📖 Read full page](${result.url})**\n\n`;
    });

    return response;
  }
}

async function initializeConfluence() {
  if (!CONFLUENCE_URL || !CONFLUENCE_USER || !CONFLUENCE_API_TOKEN) {
    console.log('⚠️  Confluence integration disabled: Missing required environment variables');
    console.log('Set CONFLUENCE_URL, CONFLUENCE_USER, and CONFLUENCE_API_TOKEN to enable Confluence integration');
    return false;
  }

  try {
    console.log('🚀 Initializing Confluence integration...');
    
    // Test connection first
    const connectionSuccess = await testConfluenceConnection();
    if (!connectionSuccess) {
      console.log('❌ Confluence connection test failed');
      return false;
    }

    // Auto-index if enabled and main page ID is set
    if (CONFLUENCE_AUTO_INDEX && CONFLUENCE_MAIN_PAGE_ID) {
      console.log('📚 Auto-indexing enabled, starting indexing process...');
      try {
        const indexResult = await autoIndexMainPage();
        if (indexResult) {
          console.log(`✅ Confluence auto-indexing completed successfully!`);
          console.log(`   📊 Indexed ${indexResult.totalIndexed} pages total`);
          return true;
        }
      } catch (indexError) {
        console.error('❌ Auto-indexing failed:', indexError.message);
        console.log('   📝 You can still manually index pages or refresh content later');
        return true; // Connection works, just indexing failed
      }
    } else {
      console.log('📝 Auto-indexing disabled or no main page ID set');
      console.log('   Use CONFLUENCE_AUTO_INDEX=true and set CONFLUENCE_MAIN_PAGE_ID to enable auto-indexing');
    }

    return true;
  } catch (error) {
    console.error('❌ Confluence initialization failed:', error.message);
    return false;
  }
}

// Test Confluence connection
async function testConfluenceConnection() {
  try {
    console.log("Testing Confluence connection...");
    const spaces = await callConfluenceApi("/space", { limit: 1 });
    console.log(`Successfully connected to Confluence! Found ${spaces.size || 0} accessible spaces.`);
    return true;
  } catch (error) {
    console.error("Failed to connect to Confluence:", error);
    return false;
  }
}

// Initialize Confluence integration (including auto-indexing if enabled)
if (CONFLUENCE_URL && CONFLUENCE_USER && CONFLUENCE_API_TOKEN) {
  initializeConfluence().then((success) => {
    if (success) {
      console.log("✅ Confluence integration initialized successfully.");
    } else {
      console.log("⚠️ Confluence integration failed to initialize.");
    }
  });
} else {
  console.log("⚠️ Confluence integration disabled: Missing required environment variables.");
}

// CONFLUENCE FUNCTIONALITY END

// Advanced API endpoint to handle all types of queries with conversation memory
app.post("/api/query", async (req, res) => {
  const startTime = Date.now();
  let { query, sessionId = "default" } = req.body;

  if (!query) {
    return res.status(400).json({ message: "Query is required" });
  }

  // Initialize session memory if it doesn't exist
  if (!conversationMemory[sessionId]) {
    conversationMemory[sessionId] = {
      queries: [],
      intents: [],
      lastResponse: null,
    };
  }

  // Get reference to the session memory
  const memory = conversationMemory[sessionId];

  // Add to conversation memory
  memory.queries.push(query);
  if (memory.queries.length > 10) {
    memory.queries.shift(); // Keep only the 10 most recent
  }

  try {
    const bitbucketIntent = await detectBitbucketIntent(query);

    // If it's a Bitbucket query, handle it separately
    if (bitbucketIntent) {
      console.log("Detected Bitbucket intent:", bitbucketIntent);

      let response;
      let intent;
      let meta = {};

      if (typeof bitbucketIntent === "string") {
        // Simple intent
        intent = bitbucketIntent;
        response = await handleBitbucketQuery(query, intent);
      } else {
        // Complex intent with metadata
        intent = bitbucketIntent.intent;
        meta = {
          ...bitbucketIntent,
          source: "bitbucket",
        };
        response = await handleBitbucketQuery(query, intent, meta);
      }

      // Store the response in conversation memory
      memory.lastResponse = response;
      memory.intents.push(intent);
      if (memory.intents.length > 10) {
        memory.intents.shift();
      }

      // Send the response back to the frontend
      return res.json({
        message: response,
        meta: {
          intent: intent,
          source: "bitbucket",
          ...meta,
          responseTime: Date.now() - startTime,
        },
      });
    }

    const confluenceIntent = await detectConfluenceIntent(query);

    if (confluenceIntent) {
      console.log("Detected Confluence intent:", confluenceIntent);

      let response;
      let intent;
      let meta = {};

      if (typeof confluenceIntent === "string") {
        intent = confluenceIntent;
        response = await handleConfluenceQuery(query, intent);
      } else {
        intent = confluenceIntent.intent;
        meta = {
          ...confluenceIntent,
          source: "confluence",
        };
        response = await handleConfluenceQuery(query, intent, meta);
      }

      // Store the response in conversation memory
      memory.lastResponse = response;
      memory.intents.push(intent);
      if (memory.intents.length > 10) {
        memory.intents.shift();
      }

      // Send the response back to the frontend
      return res.json({
        message: response,
        meta: {
          intent: intent,
          source: "confluence",
          ...meta,
          responseTime: Date.now() - startTime,
        },
      });
    }

    // 2. Check for enhanced Confluence knowledge base queries
    const confluenceKnowledgeIntent = await detectConfluenceKnowledgeBaseIntent(query);

    if (confluenceKnowledgeIntent) {
      console.log("Detected Confluence knowledge intent:", confluenceKnowledgeIntent);

      const response = await handleConfluenceKnowledgeQuery(query, confluenceKnowledgeIntent);

      // Store the response in conversation memory
      memory.lastResponse = response;
      memory.intents.push(confluenceKnowledgeIntent);
      if (memory.intents.length > 10) {
        memory.intents.shift();
      }

      return res.json({
        message: response,
        meta: {
          intent: confluenceKnowledgeIntent,
          source: "confluence_knowledge",
          responseTime: Date.now() - startTime,
        },
      });
    }

    // Preprocess the query to handle common problematic patterns
    const originalQuery = query;
    const preprocessedQuery = preprocessQuery(query);
    if (preprocessedQuery !== originalQuery) {
      console.log(`Preprocessed query from "${originalQuery}" to "${preprocessedQuery}"`);
      query = preprocessedQuery;
    }

    // Get user context for personalization
    const userContext = getUserContext(sessionId);

    // Special handling for common query types
    const intent = await analyzeQueryIntent(query);
    console.log("Query intent:", intent);

    // Store intent in conversation memory
    memory.intents.push(intent);
    if (memory.intents.length > 10) {
      memory.intents.shift();
    }

    // TIMELINE HANDLER
    if (intent === "TIMELINE" && /timeline|deadline|due|schedule|calendar|what.* due|when/i.test(query)) {
      const result = await getAdvancedTimeline(req, res, query, sessionId);
      if (result) {
        // Request was handled by specialized handler
        updateConversationMemory(sessionId, query, intent, memory.lastResponse, Date.now() - startTime, true, true);
        return;
      }
    }

    // WORKLOAD HANDLER
    if (intent === "WORKLOAD" && /workload|capacity|bandwidth|who.*working|team.*work|overloaded|busy/i.test(query)) {
      const result = await getDetailedWorkloadAnalysis(req, res, query, sessionId);
      if (result) {
        // Request was handled by specialized handler
        updateConversationMemory(sessionId, query, intent, memory.lastResponse, Date.now() - startTime, true, true);
        return;
      }
    }

    // Most recently updated task
    if (query === "show most recently updated task") {
      const result = await getMostRecentTaskDetails(req, res, query, sessionId);
      if (result) return; // If handled successfully, stop processing
    }

    // Project status overview
    if (query === "show project status") {
      const result = await getProjectStatusOverview(req, res, sessionId);
      if (result) return; // If handled successfully, stop processing
    }

    // Timeline queries
    if (query === "show project timeline" || query === "show upcoming deadlines") {
      const result = await getProjectTimeline(req, res, query, sessionId);
      if (result) return; // If handled successfully, stop processing
    }

    // Team workload queries
    if (query === "show team workload") {
      const result = await getTeamWorkload(req, res, query, sessionId);
      if (result) return; // If handled successfully, stop processing
    }

    // Special handling for issue types queries
    if (query === "show issue types" || intent === "ISSUE_TYPES") {
      const result = await getIssueTypes(req, res, query, sessionId);
      if (result) return; // If handled successfully, stop processing
    }

    // COMPARE ISSUES HANDLER
    const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "gi");
    const issueMatches = query.match(issueKeyPattern);
    if (issueMatches && issueMatches.length >= 2 && /compare|versus|vs|difference|similarities/i.test(query)) {
      const result = await compareIssues(req, res, query, sessionId);
      if (result) {
        // Request was handled by specialized handler
        updateConversationMemory(sessionId, query, "COMPARE_ISSUES", memory.lastResponse, Date.now() - startTime, true, true);
        return;
      }
    }

    // For greeting or purely conversational responses, handle differently
    if (intent === "GREETING") {
      const greetingResponses = [
        "Hi there! I'm your Jira assistant. I can help you with:\n\n• Finding tasks and issues\n• Checking project status\n• Understanding who's working on what\n• Tracking blockers and high-priority items\n• Monitoring deadlines and timelines\n\nJust ask me a question about your Jira project!",

        "Hello! I'm here to help you navigate your Jira project. You can ask me about:\n\n• Open and closed tasks\n• Task assignments and ownership\n• Project timelines and deadlines\n• High priority issues and blockers\n• Recent updates and changes\n\nWhat would you like to know about your project today?",

        'Hey! I\'m your Jira chatbot assistant. Some things you can ask me:\n\n• "What\'s the status of our project?"\n• "Show me open bugs assigned to Sarah"\n• "Any blockers in the current sprint?"\n• "Tell me about NIHK-123"\n• "What\'s due this week?"\n\nHow can I help you today?',
      ];

      const response = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];

      // Store response
      memory.lastResponse = response;

      return res.json({
        message: response,
        meta: {
          intent: "GREETING",
        },
      });
    }

    // Special handling for sprint queries
    if (intent === "SPRINT") {
      try {
        // Get active sprints first
        const activeSprintsResponse = await axios
          .get(`${JIRA_URL}/rest/agile/1.0/board/active`, {
            auth,
          })
          .catch((err) => {
            console.log("Error fetching active boards:", err.message);
            return { data: { values: [] } };
          });

        let sprintData = [];
        let sprintName = "current sprint";

        // If we found active sprints, get details for the first one
        if (activeSprintsResponse.data && activeSprintsResponse.data.values && activeSprintsResponse.data.values.length > 0) {
          const firstBoard = activeSprintsResponse.data.values[0];

          // Get sprints for this board
          const sprintsResponse = await axios
            .get(`${JIRA_URL}/rest/agile/1.0/board/${firstBoard.id}/sprint?state=active`, {
              auth,
            })
            .catch((err) => {
              console.log("Error fetching sprints:", err.message);
              return { data: { values: [] } };
            });

          if (sprintsResponse.data && sprintsResponse.data.values && sprintsResponse.data.values.length > 0) {
            const activeSprint = sprintsResponse.data.values[0];
            sprintName = activeSprint.name;

            // Get issues for this sprint
            const sprintIssuesResponse = await axios
              .get(`${JIRA_URL}/rest/agile/1.0/sprint/${activeSprint.id}/issue`, {
                params: {
                  fields: "summary,status,assignee,priority,issuetype",
                },
                auth,
              })
              .catch((err) => {
                console.log("Error fetching sprint issues:", err.message);
                return { data: { issues: [] } };
              });

            if (sprintIssuesResponse.data && sprintIssuesResponse.data.issues) {
              sprintData = sprintIssuesResponse.data.issues;
            }
          }
        }

        // If no active sprint found through agile API, fall back to JQL
        if (sprintData.length === 0) {
          const fallbackResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
            params: {
              jql: `project = ${process.env.JIRA_PROJECT_KEY} AND sprint in openSprints()`,
              maxResults: 50,
              fields: "summary,status,assignee,priority,issuetype",
            },
            auth,
          });

          if (fallbackResponse.data && fallbackResponse.data.issues) {
            sprintData = fallbackResponse.data.issues;
          }
        }

        // Generate a natural, conversational response about the sprint
        const systemPrompt = `
          You are a friendly Jira assistant talking about sprint status. Create a conversational response about 
          the ${sprintName} that feels natural and helpful, not like a database query result.
          
          Guidelines:
          - Start with a personable opening about the sprint
          - Group issues by status in a way that feels natural
          - Highlight the most important issues (highest priority ones)
          - Add meaningful insights about progress, not just statistics
          - Keep the tone conversational, like a helpful colleague
          - Include a brief closing with a question about what they'd like to know next
          - Use appropriate emoji sparingly to make it more engaging (📊, 🚀, 🏃‍♀️, etc.)
          
          Format guidelines:
          - Avoid bullet points that just list issues
          - Don't create tables
          - Organize information in conversational paragraphs
          - Create a response someone would actually speak, not a report
        `;

        // Prepare the data
        const statusGroups = {};
        const assigneeGroups = {};
        const typeGroups = {};

        sprintData.forEach((issue) => {
          // Group by status
          const status = issue.fields.status?.name || "Unknown";
          if (!statusGroups[status]) statusGroups[status] = [];
          statusGroups[status].push(issue);

          // Group by assignee
          const assignee = issue.fields.assignee?.displayName || "Unassigned";
          if (!assigneeGroups[assignee]) assigneeGroups[assignee] = [];
          assigneeGroups[assignee].push(issue);

          // Group by issue type
          const issueType = issue.fields.issuetype?.name || "Unknown";
          if (!typeGroups[issueType]) typeGroups[issueType] = [];
          typeGroups[issueType].push(issue);
        });

        // High priority issues
        const highPriorityIssues = sprintData.filter(
          (issue) => issue.fields.priority?.name === "Highest" || issue.fields.priority?.name === "High"
        );

        const sprintContext = {
          sprintName,
          totalIssues: sprintData.length,
          statusGroups: Object.entries(statusGroups).map(([status, issues]) => ({
            status,
            count: issues.length,
            examples: issues.slice(0, 3).map((i) => ({
              key: i.key,
              summary: i.fields.summary,
              assignee: i.fields.assignee?.displayName || "Unassigned",
            })),
          })),
          assigneeGroups: Object.entries(assigneeGroups)
            .filter(([assignee, issues]) => assignee !== "Unassigned")
            .map(([assignee, issues]) => ({
              assignee,
              count: issues.length,
            })),
          highPriorityIssues: highPriorityIssues.slice(0, 3).map((i) => ({
            key: i.key,
            summary: i.fields.summary,
            status: i.fields.status?.name || "Unknown",
            assignee: i.fields.assignee?.displayName || "Unassigned",
          })),
          issueTypes: Object.entries(typeGroups).map(([type, issues]) => ({
            type,
            count: issues.length,
          })),
        };

        try {
          // Generate the natural response
          const sprintResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `Generate a natural, conversational response about the sprint with this data: ${JSON.stringify(sprintContext)}`,
              },
            ],
            temperature: 0.7, // Higher for more varied, natural responses
          });

          const formattedResponse = sprintResponse.choices[0].message.content.trim();

          // Store the response
          memory.lastResponse = formattedResponse;

          // Update conversation memory
          updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, true, true);

          return res.json({
            message: formattedResponse,
            meta: {
              intent: "SPRINT",
              sprintName,
              issueCount: sprintData.length,
            },
          });
        } catch (aiError) {
          console.error("Error generating sprint response with AI:", aiError);

          // Fallback sprint response without AI
          const doneCount = statusGroups["Done"]?.length || 0;
          const inProgressCount = statusGroups["In Progress"]?.length || 0;
          const todoCount = statusGroups["To Do"]?.length || 0;

          let formattedResponse = `I'm looking at the ${sprintName} sprint. `;

          if (sprintData.length === 0) {
            formattedResponse += "I don't see any issues in this sprint yet.";
          } else {
            formattedResponse += `There are ${sprintData.length} issues in this sprint. `;
            formattedResponse += `Current progress: ${doneCount} completed, ${inProgressCount} in progress, and ${todoCount} still to do.\n\n`;

            if (highPriorityIssues.length > 0) {
              formattedResponse += `There are ${highPriorityIssues.length} high priority issues to focus on.\n\n`;

              // Include a couple examples
              if (highPriorityIssues.length > 0) {
                const example = highPriorityIssues[0];
                formattedResponse += `For example, ${example.key}: "${example.fields.summary}" is a high priority task currently ${
                  example.fields.status?.name || "in unknown status"
                }.\n\n`;
              }
            }

            // Add information about team distribution
            const assigneesCount = Object.keys(assigneeGroups).filter((name) => name !== "Unassigned").length;
            formattedResponse += `${assigneesCount} team members are working on tasks in this sprint.`;
          }

          // Store response and update memory
          memory.lastResponse = formattedResponse;
          updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, false, sprintData.length > 0);

          return res.json({
            message: formattedResponse,
            meta: {
              intent: "SPRINT",
              sprintName,
              issueCount: sprintData.length,
            },
          });
        }
      } catch (sprintError) {
        console.error("Error fetching sprint data:", sprintError);
        // Fall back to normal query processing
      }
    }

    // Check if it looks like a request for a specific issue
    const singleIssueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
    if (singleIssueKeyPattern.test(query)) {
      // Extract the issue key
      const matches = query.match(singleIssueKeyPattern);
      const issueKey = matches[0];

      try {
        // Try to fetch the specific issue
        const issueResponse = await axios.get(`${JIRA_URL}/rest/api/3/issue/${issueKey}`, {
          params: {
            fields: "summary,status,assignee,priority,created,updated,duedate,comment,description,labels,issuelinks",
          },
          auth,
        });

        // Format the issue data
        const issue = issueResponse.data;
        const comments = issue.fields.comment?.comments || [];
        const latestComment = comments.length > 0 ? comments[comments.length - 1] : null;

        let commentMessage = "No comments found on this issue.";
        if (latestComment) {
          const author = latestComment.author?.displayName || "Unknown";
          const created = new Date(latestComment.created).toLocaleDateString();

          // Extract text content from complex comment body
          let commentText = "";

          if (typeof latestComment.body === "string") {
            commentText = latestComment.body;
          } else if (latestComment.body && latestComment.body.content) {
            // Handle Jira's Atlassian Document Format (ADF)
            try {
              commentText = extractTextFromADF(latestComment.body);
            } catch (e) {
              console.error("Error extracting comment text:", e);
              commentText = "Comment contains rich content that cannot be displayed in plain text. Please check directly in Jira.";
            }
          } else {
            commentText = "Comment has a format that cannot be displayed here. Please check directly in Jira.";
          }

          commentMessage = `**Latest comment** (by ${author} on ${created}):\n"${commentText}"`;
        }

        // For simple lookups, use a direct response
        if (intent === "TASK_DETAILS" && /^(?:show|tell|get|what is|about)\s+${issueKey}$/i.test(query.trim())) {
          const status = issue.fields.status?.name || "Unknown";
          const assignee = issue.fields.assignee?.displayName || "Unassigned";
          const summary = issue.fields.summary || "No summary";
          const priority = issue.fields.priority?.name || "Not set";
          const created = new Date(issue.fields.created).toLocaleDateString();
          const updated = new Date(issue.fields.updated).toLocaleDateString();

          // Description handling
          let description = "No description provided.";
          if (issue.fields.description) {
            if (typeof issue.fields.description === "string") {
              description = issue.fields.description;
            } else if (issue.fields.description.content) {
              try {
                description = extractTextFromADF(issue.fields.description);
              } catch (e) {
                description = "Description contains rich formatting that cannot be displayed in plain text.";
              }
            }
          }

          const formattedResponse =
            `## ${createJiraLink(issueKey)}: ${summary}\n\n` +
            `**Status**: ${status}\n` +
            `**Priority**: ${priority}\n` +
            `**Assignee**: ${assignee}\n` +
            `**Created**: ${created}\n` +
            `**Last Updated**: ${updated}\n\n` +
            `### Description\n${description}\n\n` +
            `### Latest Comment\n${commentMessage}`;

          // Store response in conversation memory
          memory.lastResponse = formattedResponse;
          updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, false, true);

          return res.json({
            message: formattedResponse,
            rawData: issue,
            meta: {
              intent: "TASK_DETAILS",
              issueKey: issueKey,
            },
          });
        } else {
          try {
            // For more complex queries about an issue, use AI to generate a tailored response
            const systemPrompt = `
              You are a friendly Confluence assistant. You've been asked about the task ${issueKey}: "${query}".
              The user's intent appears to be: ${intent}.
              
              Create a response that addresses their specific question about this issue, while providing 
              the relevant information from the task. Format your response using markdown that will work with 
              the frontend:
              - Use ## for the issue title
              - Use ### for section headers
              - Use ## [IHKA-123](https://asioso.atlassian.net/browse/IHKA-123): Summary as the title header
              - Use **bold** for field names
              - Use • or - for bullet points
              - Organize your response into logical sections
              - Make your response conversational and helpful
              - Use [IHKA-123](https://asioso.atlassian.net/browse/IHKA-123) format to make issue keys clickable


              Based on the intent "${intent}", focus on the most relevant details of the issue.
              Previous conversation context (if available):
              ${memory.queries
                .slice(-3)
                .map((q) => `- User: ${q}`)
                .join("\n")}
            `;

            // Prepare the issue data in a more accessible format
            const taskData = {
              key: issue.key,
              summary: issue.fields.summary,
              status: issue.fields.status?.name || "Unknown",
              priority: issue.fields.priority?.name || "Unknown",
              assignee: issue.fields.assignee?.displayName || "Unassigned",
              created: issue.fields.created,
              updated: issue.fields.updated,
              dueDate: issue.fields.duedate || "No due date",
              description:
                typeof issue.fields.description === "string" ? issue.fields.description : extractTextFromADF(issue.fields.description),
              comments: comments.map((c) => ({
                author: c.author?.displayName || "Unknown",
                created: c.created,
                body: typeof c.body === "string" ? c.body : extractTextFromADF(c.body),
              })),
              labels: issue.fields.labels || [],
              issueLinks: issue.fields.issuelinks || [],
            };

            const aiResponse = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `Issue details: ${JSON.stringify(taskData)}. Generate a response to the query: "${query}"`,
                },
              ],
              temperature: 0.7,
            });

            const formattedResponse = aiResponse.choices[0].message.content.trim();
            console.log("Debug formattedresponse:", formattedResponse);

            // Store response in conversation memory
            memory.lastResponse = formattedResponse;
            updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, true, true);

            return res.json({
              message: formattedResponse,
              rawData: issue,
              meta: {
                intent,
                issueKey,
              },
            });
          } catch (aiError) {
            console.error("Error generating AI response for issue:", aiError);

            // Fallback to a simpler format if AI fails
            const status = issue.fields.status?.name || "Unknown";
            const assignee = issue.fields.assignee?.displayName || "Unassigned";
            const summary = issue.fields.summary || "No summary";
            const priority = issue.fields.priority?.name || "Not set";

            // Create a simplified response
            const formattedResponse =
              `## ${createJiraLink(issueKey)}: ${summary}\n\n` +
              `Here's what you asked about this issue:\n\n` +
              `**Status**: ${status}\n` +
              `**Priority**: ${priority}\n` +
              `**Assignee**: ${assignee}\n\n` +
              `${commentMessage}`;

            // Store response in conversation memory
            memory.lastResponse = formattedResponse;
            updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, false, true);

            return res.json({
              message: formattedResponse,
              rawData: issue,
              meta: {
                intent,
                issueKey,
              },
            });
          }
        }
      } catch (issueError) {
        console.error("Error fetching specific issue:", issueError);
        // If issue fetch fails, continue with normal query processing
      }
    }

    // For conversational follow-ups, handle specially
    if (intent === "CONVERSATION") {
      // Get some basic project info for context
      try {
        const recentIssuesResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
            maxResults: 5,
            fields: "summary,status,assignee,updated",
          },
          auth,
        });

        // Use the conversational handler
        const formattedResponse = await generateResponse(query, recentIssuesResponse.data, intent, {
          previousQueries: memory.queries,
          personalizedPrompt: getPersonalizedSystemPrompt(userContext, intent),
        });

        // Store response
        memory.lastResponse = formattedResponse;
        updateConversationMemory(
          sessionId,
          query,
          intent,
          formattedResponse,
          Date.now() - startTime,
          true,
          recentIssuesResponse.data.issues.length > 0
        );

        return res.json({
          message: formattedResponse,
          meta: { intent: "CONVERSATION" },
        });
      } catch (error) {
        console.error("Error handling conversational query:", error);

        // Fallback for conversation
        const conversationalResponses = [
          "I'm here to help with your Jira project. Could you ask me something specific about your tasks or project status?",
          "I'd be happy to help you with your Jira project. What would you like to know about your issues or project?",
          "I can provide information about your Jira tasks, assignments, deadlines, and more. What are you looking for?",
          "I'm your Jira assistant. I can tell you about task status, assignments, priorities, and more. What would you like to know?",
        ];

        const formattedResponse = conversationalResponses[Math.floor(Math.random() * conversationalResponses.length)];

        // Store response
        memory.lastResponse = formattedResponse;
        updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, false, false);

        return res.json({
          message: formattedResponse,
          meta: { intent: "CONVERSATION" },
        });
      }
    }

    // Generate JQL based on the analyzed intent
    let jql;
    try {
      jql = await generateJQL(query, intent);

      // Apply user preferences to JQL if applicable
      const enhancedJql = applyUserContext(jql, userContext);
      if (enhancedJql !== jql) {
        console.log(`Enhanced JQL with user context: ${enhancedJql}`);
        jql = enhancedJql;
      }
    } catch (jqlError) {
      console.error("Error generating JQL:", jqlError);
      // Use a fallback based on intent
      jql = fallbackGenerateJQL(query, intent);
    }

    if (!jql) {
      return res.status(400).json({ message: "Failed to generate a valid query." });
    }

    // Determine relevant fields based on the query intent
    const fields = determineFieldsForIntent(intent);

    // Execute JQL against Jira API with customized field selection
    // Set a reasonable limit on results

    let maxResults;
    if (query === "show highest priority task") {
      maxResults = 1;
    } else {
      maxResults = determineResultsLimit(intent, userContext);
    }


    let jiraResponse;
    try {
      jiraResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
        params: {
          jql: jql,
          maxResults: maxResults,
          fields,
        },
        auth,
      });
    } catch (jqlError) {
      console.error("JQL error:", jqlError.message);

      // Try to recover with a simplified query based on intent
      let simplifiedJQL;

      // Choose an appropriate fallback for each intent
      if (intent === "PROJECT_STATUS") {
        simplifiedJQL = safeJqlTemplates.PROJECT_STATUS;
      } else if (intent === "TIMELINE") {
        simplifiedJQL = safeJqlTemplates.TIMELINE;
      } else if (intent === "BLOCKERS" || intent === "HIGH_PRIORITY") {
        simplifiedJQL = safeJqlTemplates.HIGH_PRIORITY;
      } else if (intent === "TASK_LIST" && /open|active/i.test(query)) {
        simplifiedJQL = safeJqlTemplates.OPEN_TASKS;
      } else if (intent === "TASK_LIST" && /closed|done|completed/i.test(query)) {
        simplifiedJQL = safeJqlTemplates.CLOSED_TASKS;
      } else if (intent === "ASSIGNED_TASKS" || intent === "WORKLOAD") {
        simplifiedJQL = safeJqlTemplates.ASSIGNED_TASKS;
      } else if (intent === "SPRINT") {
        simplifiedJQL = safeJqlTemplates.CURRENT_SPRINT;
      } else if (intent === "TASK_LIST" && /(how many|count|number of).*(high|highest|important|critical|priority).*(tasks|issues|tickets)/i.test(query)) {
        simplifiedJQL = safeJqlTemplates.HIGH_PRIORITY_COUNT;
      } else {
        // Default fallback
        simplifiedJQL = `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`;
      }

      console.log("Using simplified JQL:", simplifiedJQL);

      // Try again with the simplified JQL
      jiraResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
        params: {
          jql: simplifiedJQL,
          maxResults: maxResults,
          fields,
        },
        auth,
      });

      // Add a note for the user (avoid showing error messages directly)
      if (jiraResponse.data && jiraResponse.data.issues) {
        memory.note = "I've found some information that might help with your question:";
      }
    }

    // Generate an intent-specific response
    const response = jiraResponse; // This is the result of either the original or fallback query

    let formattedResponse;
    let usedAI = true;
    response.data.jql = jql;

    // Include a note about the query simplification if it happened
    if (memory.note) {
      const note = memory.note;
      delete memory.note; // Clear the note

      try {

        // Add the note to the beginning of the response
        const personalizedSystemPrompt = getPersonalizedSystemPrompt(userContext, intent);
        const baseResponse = await generateResponse(query, response.data, intent, {
          previousQueries: memory.queries,
          personalizedPrompt: personalizedSystemPrompt,
        });
        console.log("🔎 Final response being sent:\n", baseResponse);
        


        formattedResponse = `${note}\n\n${baseResponse}`;
      } catch (responseError) {
        // If AI response generation fails, use a direct fallback
        const issues = response.data.issues;
        formattedResponse = `${note}\n\n`;
        usedAI = false;

        if (issues.length === 0) {
          formattedResponse += "I couldn't find any issues matching your criteria.";
        } else {
          formattedResponse += `Here are ${Math.min(5, issues.length)} recent items:\n\n`;

          for (let i = 0; i < Math.min(5, issues.length); i++) {
            const issue = issues[i];
            const status = issue.fields.status?.name || "Unknown";
            const assignee = issue.fields.assignee?.displayName || "Unassigned";
            formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status}, Assigned to: ${assignee})\n`;
          }

          if (issues.length > 5) {
            formattedResponse += `\n... and ${issues.length - 5} more items.`;
          }
        }
      }
    } else {
      try {
        response.data.jql = jql; 
        const personalizedSystemPrompt = getPersonalizedSystemPrompt(userContext, intent);
        formattedResponse = await generateResponse(query, response.data, intent, {
          previousQueries: memory.queries,
          personalizedPrompt: personalizedSystemPrompt,
        });
        console.log("🔎 Final response being sent:\n", formattedResponse);

      } catch (responseError) {
        console.error("Error generating AI response:", responseError);
        usedAI = false;

        // Use an intent-based fallback response
        formattedResponse = createFallbackResponse(response.data, intent, query);
      }
    }

    // Store the response in conversation memory
    memory.lastResponse = formattedResponse;
    updateConversationMemory(sessionId, query, intent, formattedResponse, Date.now() - startTime, usedAI, response.data.issues.length > 0);

    // Send the response back to the frontend
    return res.json({
      message: formattedResponse,
      rawData: response.data,
      meta: {
        intent,
        jql,
        responseTime: Date.now() - startTime,
        isPersonalized: true,
      },
    });
  } catch (error) {
    console.error("Error processing query:", error);

    // Use the error handler to create a friendly response
    const errorResponse = handleQueryError(error, query, sessionId);

    updateConversationMemory(sessionId, query, "ERROR", errorResponse, Date.now() - startTime, false, false);

    // We never want to show raw error messages to the user
    // Instead, create a friendly, helpful response that doesn't reveal technical issues
    try {
      // Try a super-basic query to at least return something useful
      const basicResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
        params: {
          jql: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
          maxResults: 5,
          fields: "summary,status,assignee",
        },
        auth,
      });

      if (basicResponse.data && basicResponse.data.issues && basicResponse.data.issues.length > 0) {
        const relevantInfo = [
          "I couldn't find exactly what you were looking for, but here are some recent items that might be helpful:",
          "Let me show you some recent activity in the project that might be relevant:",
          "While I couldn't answer your specific question, here are some recent updates in the project:",
          "I found some recent project activity that might interest you:",
        ];

        let message = relevantInfo[Math.floor(Math.random() * relevantInfo.length)] + "\n\n";

        basicResponse.data.issues.forEach((issue) => {
          const status = issue.fields.status?.name || "Unknown";
          const assignee = issue.fields.assignee?.displayName || "Unassigned";
          message += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status}, Assigned to: ${assignee})\n`;
        });

        message += "\n\nCould you try rephrasing your question? I can help you with project status, tasks, deadlines, and team workload.";

        return res.json({
          message: message,
          meta: { intent: "GENERAL" },
        });
      }
    } catch (fallbackError) {
      // Even the fallback failed, use a very generic response
      console.error("Fallback error:", fallbackError);
    }

    // If all else fails, use these conversational error messages that don't seem like errors
    const friendlyResponses = [
      "I'm focusing on active issues in the project right now. Would you like to see recent updates or high priority items?",
      "I'd be happy to help you explore the project data. Could you ask me about project status, tasks, deadlines, or team workload?",
      "Let me help you navigate your Jira project. You can ask me about project status, tasks, deadlines, team assignments, and more.",
      "I'm here to help you with your Jira project information. What would you like to know about your tasks or project status?",
    ];


    return res.json({
      message: friendlyResponses[Math.floor(Math.random() * friendlyResponses.length)],
      meta: { intent: "ERROR" },
    });
  }
});

// Improved project summary endpoint with more valuable information
app.get("/api/project-summary", async (req, res) => {
  try {
    console.log("Starting project summary fetch");
    console.log(`JIRA_URL: ${JIRA_URL}`);
    console.log(`JIRA_PROJECT_KEY: ${process.env.JIRA_PROJECT_KEY}`);

    // Run multiple queries in parallel for better performance
    const [openResponse, recentResponse, priorityResponse, unassignedResponse] = await Promise.all([
      // Get open issues count
      axios
        .get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status in ("Open", "In Progress", "To Do", "Reopened")`,
            maxResults: 0,
          },
          auth,
        })
        .catch((err) => {
          console.error("Error fetching open issues:", err.message);
          if (err.response) {
            console.error("Response status:", err.response.status);
            console.error("Response data:", err.response.data);
          }
          return { data: { total: 0 } };
        }),

      // Get recently updated issues
      axios
        .get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND updated >= -7d ORDER BY updated DESC`,
            maxResults: 5,
            fields: "summary,status,assignee,updated",
          },
          auth,
        })
        .catch((err) => {
          console.error("Error fetching recent issues:", err.message);
          return { data: { issues: [] } };
        }),

      // Get high priority issues
      axios
        .get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND priority in ("High", "Highest") AND status != "Done"`,
            maxResults: 5,
            fields: "summary,status,assignee,priority",
          },
          auth,
        })
        .catch((err) => {
          console.error("Error fetching high priority issues:", err.message);
          return { data: { issues: [] } };
        }),

      // Get unassigned issues
      axios
        .get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND assignee is EMPTY AND status != "Done"`,
            maxResults: 5,
            fields: "summary,status,priority,created",
          },
          auth,
        })
        .catch((err) => {
          console.error("Error fetching unassigned issues:", err.message);
          return { data: { issues: [] } };
        }),
    ]);

    console.log("All requests completed");

    // Put it all together in a rich project summary
    res.json({
      openCount: openResponse.data.total,
      recentIssues: recentResponse.data.issues,
      highPriorityIssues: priorityResponse.data.issues,
      unassignedIssues: unassignedResponse.data.issues,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching project summary:", error);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    console.error("Auth configuration:", {
      url: JIRA_URL,
      username: JIRA_USER ? "Set" : "Not set",
      apiToken: JIRA_API_TOKEN ? "Set" : "Not set",
      projectKey: process.env.JIRA_PROJECT_KEY,
    });

    res.status(500).json({
      message: "Couldn't retrieve the project summary at this time. Please try again later.",
      error: error.message,
    });
  }
});

// New endpoint to clear conversation context if needed
app.post("/api/reset-conversation", (req, res) => {
  const { sessionId = "default" } = req.body;

  if (conversationMemory[sessionId]) {
    conversationMemory[sessionId] = {
      queries: [],
      intents: [],
      lastResponse: null,
    };
  }

  res.json({ success: true, message: "Conversation reset successfully" });
});

app.get("/api/combined-summary", async (req, res) => {
  try {
    // Get Jira project summary (using your existing code)
    const jiraPromise = axios
      .get(`${JIRA_URL}/rest/api/3/search`, {
        params: {
          jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status != "Done"`,
          maxResults: 0,
        },
        auth,
      })
      .catch((err) => {
        console.error("Error fetching Jira summary:", err.message);
        return { data: { total: 0 } };
      });

    // Get Bitbucket repository info
    const bitbucketPromise = getBitbucketRepos().catch((err) => {
      console.error("Error fetching Bitbucket summary:", err.message);
      return { values: [] };
    });

    // Wait for both to complete
    const [jiraResponse, bitbucketRepos] = await Promise.all([jiraPromise, bitbucketPromise]);

    // Compile the data
    const summaryData = {
      jira: {
        openIssues: jiraResponse.data.total,
        lastUpdated: new Date().toISOString(),
      },
      bitbucket: {
        repositories: (bitbucketRepos.values || []).length,
        repositoryNames: (bitbucketRepos.values || []).map((repo) => repo.name || repo.slug).slice(0, 5),
        lastUpdated: new Date().toISOString(),
      },
    };

    res.json(summaryData);
  } catch (error) {
    console.error("Error fetching combined summary:", error);
    res.status(500).json({
      message: "Couldn't retrieve the combined summary at this time.",
      error: error.message,
    });
  }
});

app.post("/api/confluence/index", async (req, res) => {
  const { url, pageId } = req.body;
  
  try {
    let result;
    
    if (url) {
      const pageIdentifier = extractPageIdFromUrl(url);
      if (!pageIdentifier) {
        return res.status(400).json({ 
          message: "Invalid Confluence URL provided" 
        });
      }
      result = await indexConfluencePage(pageIdentifier, true);
    } else if (pageId) {
      result = await indexConfluencePage(pageId, true);
    } else {
      return res.status(400).json({ 
        message: "Either URL or pageId is required" 
      });
    }

    res.json({
      success: true,
      message: `Successfully indexed ${result.totalIndexed} pages`,
      data: result
    });
  } catch (error) {
    console.error("Error indexing Confluence page:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post("/api/confluence/refresh", async (req, res) => {
  try {
    const result = await handleRefreshQuery();
    res.json({
      success: true,
      message: result
    });
  } catch (error) {
    console.error("Error refreshing Confluence content:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/confluence/status", async (req, res) => {
  try {
    const result = await handleStatusQuery();
    
    // Also return structured data
    const pages = Array.from(confluenceIndex.values());
    const spaces = [...new Set(pages.map(p => p.spaceName || p.spaceKey))];
    
    res.json({
      success: true,
      message: result,
      data: {
        indexedPages: confluenceIndex.size,
        spaces: spaces,
        isEnabled: !!(CONFLUENCE_URL && CONFLUENCE_USER && CONFLUENCE_API_TOKEN),
        autoIndexEnabled: CONFLUENCE_AUTO_INDEX,
        mainPageId: CONFLUENCE_MAIN_PAGE_ID
      }
    });
  } catch (error) {
    console.error("Error getting Confluence status:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});



app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
