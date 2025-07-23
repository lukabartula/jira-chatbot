import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import { OpenAI } from "openai";
import { openai } from "./config/openaiConfig.js";
import * as cheerio from "cheerio";
import { safeJqlTemplates } from "./config/jiraConfig.js";
import {
  fallbackGenerateJQL,
  generateJQL,
  getProjectStatusOverview,
  getMostRecentTaskDetails,
  getProjectTimeline,
  getTeamWorkload,
  getAdvancedTimeline,
  getIssueTypes
} from "./services/jiraService.js";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";
import { analyzeQueryIntent } from "./services/intentService.js";
import { getConversationMemory, updateConversationMemory, conversationMemory } from "./memory/conversationMemory.js";
import { getUserContext, detectFollowUpQuery, applyUserContext, getPersonalizedSystemPrompt, determineResultsLimit } from "./memory/userContext.js";
import {
  createJiraLink,
  createJiraFilterLink,
  sanitizeJql,
  extractTextFromADF,
  preprocessQuery,
  determineFieldsForIntent,
  compareIssues
} from "./utils/jiraUtils.js";
import { getDetailedWorkloadAnalysis } from "./services/workloadService.js";
import { generateResponse } from "./utils/queryContextUtils.js";
import {
  getBitbucketRepos,
  detectBitbucketIntent,
  handleBitbucketQuery,
} from './services/bitbucketService.js';
import {
  callConfluenceApi,
  extractPageIdFromUrl,
  indexConfluencePage,
  detectConfluenceKnowledgeBaseIntent,
  handleConfluenceKnowledgeQuery,
  handleRefreshQuery,
  handleStatusQuery,
  detectConfluenceIntent,
  handleConfluenceQuery,
  initializeConfluence
} from "./services/confluenceService.js";


// Load environment variables
dotenv.config();

const app = express();
const port = 3000;
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "IHKA"; // Your project key

const CONFLUENCE_MAIN_PAGE_ID = process.env.CONFLUENCE_MAIN_PAGE_ID || "4624646162";
const CONFLUENCE_AUTO_INDEX = process.env.CONFLUENCE_AUTO_INDEX === "true";

const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const CONFLUENCE_USER = process.env.JIRA_USER;
const CONFLUENCE_API_TOKEN = process.env.JIRA_API_TOKEN;

export const confluenceAuth = {
  username: CONFLUENCE_USER,
  password: CONFLUENCE_API_TOKEN,
};

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


// // CONFLUENCE FUNCTIONALITY END

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

async function logCurrentUserEmail() {
  try {
    const response = await axios.get(`${JIRA_URL}/rest/api/3/myself`, { auth });
    const email = response.data.emailAddress;
    console.log("Current user's email:", email);
    return email;
  } catch (error) {
    console.error("Failed to fetch current user's email:", error.message);
    return null;
  }
}

// Example usage: call this function somewhere after server starts
logCurrentUserEmail();

async function logCurrentBitbucketUsername() {
  try {
    const response = await axios.get('https://api.bitbucket.org/2.0/user', {
      auth: {
        username: process.env.BITBUCKET_USER,
        password: process.env.BITBUCKET_API_TOKEN, // Use Bitbucket App Password
      },
    });
    const username = response.data.username;
    console.log("Current Bitbucket username:", username);
    return username;
  } catch (error) {
    console.error("Failed to fetch Bitbucket username:", error.message);
    return null;
  }
}

// Example usage: call this function somewhere after server starts
logCurrentBitbucketUsername();

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
