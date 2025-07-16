import { sanitizeJql } from '../utils/jiraUtils.js';
import { extractEntitiesFromQuery, extractTimeParameters, organizeTimelineByDate, getTimeframeDescription } from '../utils/extractors.js';
import { openai } from '../config/openaiConfig.js';
import axios from 'axios';
import { createJiraLink, extractTextFromADF } from '../utils/jiraUtils.js';
import { safeJqlTemplates } from '../config/jiraConfig.js';
import { conversationMemory, getConversationMemory } from '../memory/conversationMemory.js';
import { createJiraFilterLink } from '../utils/jiraUtils.js';



export async function fallbackGenerateJQL(query, intent) {
    console.log("Using fallback JQL generation for query:", query, "with intent:", intent);

    // Look for keywords to determine the right fallback
    query = query.toLowerCase();

    // Try to match intent to a safe template first
    if (intent === "PROJECT_STATUS") return safeJqlTemplates.PROJECT_STATUS;
    if (intent === "TASK_LIST" && /(how many|count|number of).*(high|highest|important|critical|priority).*(tasks|issues|tickets)/i.test(query)) return safeJqlTemplates.HIGH_PRIORITY_COUNT;
    if (intent === "TIMELINE") return safeJqlTemplates.TIMELINE;
    if (intent === "BLOCKERS") return safeJqlTemplates.BLOCKERS;
    if (intent === "TASK_LIST" && /open|active|current/i.test(query)) return safeJqlTemplates.OPEN_TASKS;
    if (intent === "TASK_LIST" && /closed|completed|done|resolved/i.test(query)) return safeJqlTemplates.CLOSED_TASKS;
    if (intent === "TASK_LIST" && /high|highest|important|critical|priority/i.test(query)) return safeJqlTemplates.HIGH_PRIORITY;
    if (intent === "TASK_LIST" && /highest priority (task|issue|ticket)/i.test(query)) return safeJqlTemplates.HIGHEST_PRIORITY_SINGLE;
    if (intent === "TASK_LIST" && /unassigned|without assignee/i.test(query)) return safeJqlTemplates.UNASSIGNED_TASKS;
    if (intent === "ASSIGNED_TASKS") return safeJqlTemplates.ASSIGNED_TASKS;
    if (intent === "SPRINT") return safeJqlTemplates.CURRENT_SPRINT;
    if (intent === "WORKLOAD") return safeJqlTemplates.ASSIGNED_TASKS;
    if (intent === "ISSUE_TYPES") return safeJqlTemplates.ISSUE_TYPES;

    // Extract any issue key that might be in the query
    const issueKeyMatch = query.match(new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i"));
    if (issueKeyMatch) {
        return `key = "${issueKeyMatch[0]}"`;
    }

    // If no intent match or issue key, look for keywords in the query
    if (/(?:work|issue|task)\s+types?|types? of work|categories/i.test(query)) return safeJqlTemplates.ISSUE_TYPES;
    if (/timeline|deadline|due|schedule/i.test(query)) return safeJqlTemplates.TIMELINE;
    if (/blocker|blocking|impediment|risk/i.test(query)) return safeJqlTemplates.BLOCKERS;
    if (/high|priority|important|urgent|critical/i.test(query)) return safeJqlTemplates.HIGH_PRIORITY;
    if (/open|active|current/i.test(query) && /task|issue|ticket/i.test(query)) return safeJqlTemplates.OPEN_TASKS;
    if (/closed|completed|done|resolved/i.test(query)) return safeJqlTemplates.CLOSED_TASKS;
    if (/assign|work|responsible/i.test(query)) return safeJqlTemplates.ASSIGNED_TASKS;
    if (/recent|latest|new|update/i.test(query)) return safeJqlTemplates.RECENT_UPDATES;
    if (/sprint/i.test(query)) return safeJqlTemplates.CURRENT_SPRINT;

    // Extract assignee if present
    const assigneeMatch = query.match(/assigned to (\w+)|(\w+)'s tasks/i);
    if (assigneeMatch) {
        const assignee = assigneeMatch[1] || assigneeMatch[2];
        return `project = "${process.env.JIRA_PROJECT_KEY}" AND assignee ~ "${assignee}" ORDER BY updated DESC`;
    }

    // Default fallback - return open issues ordered by update date
    return safeJqlTemplates.PROJECT_STATUS;

}


export async function generateJQL(query, intent) {
    try {
        // Track start time for performance monitoring
        const startTime = Date.now();
    
        // First, check for pre-defined templates based on standardized queries
        if (query === "show project status") return safeJqlTemplates.PROJECT_STATUS;
        if (query === "show project timeline") return safeJqlTemplates.TIMELINE;
        if (query === "show upcoming deadlines") return safeJqlTemplates.TIMELINE_UPCOMING;
        if (query === "show project blockers") return safeJqlTemplates.BLOCKERS;
        if (query === "show high risk items") return safeJqlTemplates.HIGH_PRIORITY;
        if (query === "show team workload") return safeJqlTemplates.ASSIGNED_TASKS;
        if (query === "show open tasks") return safeJqlTemplates.OPEN_TASKS;
        if (query === "show closed tasks") return safeJqlTemplates.CLOSED_TASKS;
        if (query === "show high priority tasks") return safeJqlTemplates.HIGH_PRIORITY;
        if (query === "show highest priority task") return safeJqlTemplates.HIGHEST_PRIORITY_SINGLE;
        if (query === "show unassigned tasks") return safeJqlTemplates.UNASSIGNED_TASKS;
        if (query === "show recent updates") return safeJqlTemplates.RECENT_UPDATES;
        if (query === "show current sprint") return safeJqlTemplates.CURRENT_SPRINT;
        if (query === "show most recently updated task") return safeJqlTemplates.MOST_RECENT_TASK;
        if (query === "show issue types") return safeJqlTemplates.ISSUE_TYPES;
    
        // Check for specific issue key
        const issueKeyPattern = new RegExp(`^\\s*${process.env.JIRA_PROJECT_KEY}-\\d+\\s*$`, "i");
        if (issueKeyPattern.test(query)) {
          const cleanKey = query.trim();
          console.log("Direct issue key detected:", cleanKey);
          return `key = "${cleanKey}"`;
        }
    
        // Check if the query contains a JIRA issue key within it
        const containsIssueKey = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
        const matches = query.match(containsIssueKey);
        if (matches && matches.length > 0) {
          const issueKey = matches[0];
          console.log("Issue key found in query:", issueKey);
          return `key = "${issueKey}"`;
        }
    
        // For some intent categories, use predefined safe templates
        if (intent === "CONVERSATION" || intent === "GREETING") {
          return safeJqlTemplates.RECENT_UPDATES;
        }
    
        if (intent === "SPRINT") {
          return safeJqlTemplates.CURRENT_SPRINT;
        }
    
        if (intent === "PROJECT_STATUS") {
          return safeJqlTemplates.PROJECT_STATUS;
        }
    
        if (intent === "ISSUE_TYPES") {
          return safeJqlTemplates.ISSUE_TYPES;
        }
    
        // Special case for recent/latest task queries
        if (/recent|latest|most recent|last|newest/i.test(query) && /edited|updated|modified|changed|task/i.test(query)) {
          return safeJqlTemplates.MOST_RECENT_TASK;
        }
    
        // Extract specific entities from the query that might be useful for JQL
        const extractedEntities = extractEntitiesFromQuery(query);
        console.log("Extracted entities:", extractedEntities);
    
        // If we have assignee info, and it's an assigned tasks query
        if (extractedEntities.assignee && intent === "ASSIGNED_TASKS") {
          return `project = "${process.env.JIRA_PROJECT_KEY}" AND assignee ~ "${extractedEntities.assignee}" AND status not in ("Done", "Closed", "Resolved") ORDER BY updated DESC`;
        }
    
        // If we have priority info, and it's a task list query
        if (extractedEntities.priority && intent === "TASK_LIST") {
          return `project = "${process.env.JIRA_PROJECT_KEY}" AND priority = "${extractedEntities.priority}" AND status not in ("Done", "Closed", "Resolved") ORDER BY updated DESC`;
        }
    
        // If we have a status and it's a task list query
        if (extractedEntities.status && intent === "TASK_LIST") {
          return `project = "${process.env.JIRA_PROJECT_KEY}" AND status = "${extractedEntities.status}" ORDER BY updated DESC`;
        }
    
        // Enhanced system prompt for JQL generation with AI
        const systemPrompt = `
          You are a specialized AI that converts natural language into precise Jira Query Language (JQL).
          Your task is to generate ONLY valid JQL that will work correctly with Jira.
          
          VERY IMPORTANT RULES:
          1. Always add "project = ${process.env.JIRA_PROJECT_KEY}" to all JQL queries unless specifically told to search across all projects
          2. Return ONLY the JQL query, nothing else. No explanations or additional text.
          3. ALWAYS use double quotes for field values containing spaces
          4. NEVER use commas outside of parentheses except in IN clauses - use AND or OR instead
          5. NEVER use "LIMIT" in JQL - if quantity limiting is needed, use ORDER BY instead
          6. For queries about recent/latest items, use "ORDER BY updated DESC" or "ORDER BY created DESC"
          7. Ensure all special characters and reserved words are properly escaped
          8. For multiple values in an IN statement, format like: status IN ("Open", "In Progress")
          9. Avoid complex syntax with unclear operators
          10. Avoid any syntax that might cause this error: "Expecting operator but got ','"
          11. If the query asks about a specific person, include 'assignee ~ "PersonName"' in your JQL
          12. If the query mentions status, always include a status condition like 'status = "In Progress"'
          13. If any part of the query is unclear, prefer broader queries that return more results rather than potentially missing relevant issues
          
          Common valid JQL patterns:
          - status = "In Progress"
          - assignee = "John Doe"
          - project = "${process.env.JIRA_PROJECT_KEY}" AND status IN ("Open", "In Progress")
          - project = "${process.env.JIRA_PROJECT_KEY}" AND priority = "High" AND assignee IS NOT EMPTY
          - project = "${process.env.JIRA_PROJECT_KEY}" AND labels = "frontend" AND status != "Done"
          - project = "${process.env.JIRA_PROJECT_KEY}" AND created >= -7d
          
          FORBIDDEN PATTERNS:
          - AVOID: status = open, assignee = john  ← NO COMMAS between conditions, missing quotes
          - AVOID: status = "open", updated = "2023-01-01"  ← NO COMMAS between conditions
          - AVOID: project, status = open  ← Invalid syntax, missing operators
          - AVOID: LIMIT 5  ← Never use LIMIT keyword
          - AVOID: ORDER BY status DESC LIMIT 10  ← Never use LIMIT keyword
          
          CORRECT PATTERNS:
          - project = "${process.env.JIRA_PROJECT_KEY}" AND status = "Open" AND assignee = "John"
          - project = "${process.env.JIRA_PROJECT_KEY}" AND (status = "Open" OR status = "In Progress")
          - project = "${process.env.JIRA_PROJECT_KEY}" AND status IN ("Open", "In Progress")
          
          Generate a valid JQL query based on the user's intent: ${intent} and query: "${query}".
        `;
    
        // Use AI to generate the JQL
        const response = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Convert this to precise JQL: "${query}"` },
          ],
          temperature: 0.1, // Lower temperature for consistent results
        });
    
        let jqlQuery = response.choices[0].message.content.trim();
        console.log("AI-Generated JQL:", jqlQuery);
    
        // Apply safety checks and sanitization to the AI-generated JQL
        const sanitizedJQL = sanitizeJql(jqlQuery);
    
        const endTime = Date.now();
        console.log(`JQL generation took ${endTime - startTime}ms`);
    
        return sanitizedJQL;
      } catch (error) {
        console.error("Error in primary JQL generation:", error);
    
        try {
          // Try a simplified AI approach with more constraints
          console.log("Attempting simplified AI JQL generation...");
    
          const simplifiedPrompt = `
            Generate a simple, safe JQL query for Jira based on this query: "${query}"
            The query intent is: ${intent}
            
            REQUIREMENTS:
            - Must start with project = "${process.env.JIRA_PROJECT_KEY}"
            - Use only simple conditions with AND
            - Stick to basic fields: status, assignee, priority
            - ONLY output the JQL query, nothing else
            - Never use commas between conditions
            - Always use double quotes around values
          `;
    
          const simplifiedResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "system", content: simplifiedPrompt }],
            temperature: 0.1,
            max_tokens: 100,
          });
    
          const simplifiedJQL = simplifiedResponse.choices[0].message.content.trim();
          console.log("Simplified AI JQL generated:", simplifiedJQL);
    
          // Double-check with sanitization
          return sanitizeJql(simplifiedJQL);
        } catch (secondError) {
          console.error("Error in simplified JQL generation:", secondError);
    
          // Final fallback to template-based JQL
          console.log("Falling back to template-based JQL generation...");
          return fallbackGenerateJQL(query, intent);
        }
    }
}

export async function getMostRecentTaskDetails(req, res, query, sessionId) {
  try {
    // Get the most recently updated task
    const recentTaskResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
        maxResults: 1,
        fields: "summary,status,assignee,priority,created,updated,duedate,comment,description",
      },
      auth,
    });

    if (recentTaskResponse.data && recentTaskResponse.data.issues && recentTaskResponse.data.issues.length > 0) {
      const issue = recentTaskResponse.data.issues[0];
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

      // Comment handling
      const comments = issue.fields.comment?.comments || [];
      let commentMessage = "No comments found on this issue.";
      if (comments.length > 0) {
        const latestComment = comments[comments.length - 1];
        const author = latestComment.author?.displayName || "Unknown";
        const commentCreated = new Date(latestComment.created).toLocaleDateString();
        let commentText = "";

        if (typeof latestComment.body === "string") {
          commentText = latestComment.body;
        } else if (latestComment.body && latestComment.body.content) {
          try {
            commentText = extractTextFromADF(latestComment.body);
          } catch (e) {
            commentText = "Comment contains rich content that cannot be displayed in plain text.";
          }
        }

        commentMessage = `**Latest comment** (by ${author} on ${commentCreated}):\n"${commentText}"`;
      }

      const formattedResponse =
        `## ${createJiraLink(issue.key)}: ${summary} (Most Recently Updated)\n\n` +
        `**Status**: ${status}\n` +
        `**Priority**: ${priority}\n` +
        `**Assignee**: ${assignee}\n` +
        `**Created**: ${created}\n` +
        `**Last Updated**: ${updated}\n\n` +
        `### Description\n${description}\n\n` +
        `### Latest Comment\n${commentMessage}`;

      // Store response in conversation memory
      if (conversationMemory[sessionId]) {
        conversationMemory[sessionId].lastResponse = formattedResponse;
      }

      if (jql) {
        const jiraFilterLink = createJiraFilterLink(jql);
        formattedResponse += `\n\n[🡕 View these tasks in Jira](${jiraFilterLink})`;
      }

      return res.json({
        message: formattedResponse,
        rawData: issue,
        meta: {
          intent: "TASK_DETAILS",
          issueKey: issue.key,
        },
      });
    }
    return null; // Continue with normal processing if no issues found
  } catch (error) {
    console.error("Error fetching most recent task:", error);
    return null; // Continue with normal processing
  }
}

export async function getProjectStatusOverview(req, res, sessionId) {
  try {
    // Get key project metrics in parallel
    const [openResponse, inProgressResponse, doneResponse, highPriorityResponse, blockedResponse, unassignedResponse, recentResponse] =
      await Promise.all([
        // Open issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status = "Open"`,
            maxResults: 0,
          },
          auth,
        }),

        // In Progress issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status = "In Progress"`,
            maxResults: 0,
          },
          auth,
        }),

        // Done issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status = "Done"`,
            maxResults: 0,
          },
          auth,
        }),

        // High priority issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND priority in ("High", "Highest") AND status != "Done"`,
            maxResults: 5,
            fields: "summary,status,assignee,priority",
          },
          auth,
        }),

        // Blocked issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND (status = "Blocked" OR labels = "blocker")`,
            maxResults: 5,
            fields: "summary,status,assignee,priority",
          },
          auth,
        }),

        // Unassigned issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND assignee IS EMPTY AND status != "Done"`,
            maxResults: 5,
            fields: "summary,status,priority",
          },
          auth,
        }),

        // Recently updated issues
        axios.get(`${JIRA_URL}/rest/api/3/search`, {
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND updated >= -7d ORDER BY updated DESC`,
            maxResults: 5,
            fields: "summary,status,updated,assignee",
          },
          auth,
        }),
      ]);

    // Compile the data
    const statusData = {
      openCount: openResponse.data.total,
      inProgressCount: inProgressResponse.data.total,
      doneCount: doneResponse.data.total,
      totalCount: openResponse.data.total + inProgressResponse.data.total + doneResponse.data.total,
      highPriorityIssues: highPriorityResponse.data.issues,
      highPriorityCount: highPriorityResponse.data.total,
      blockedIssues: blockedResponse.data.issues,
      blockedCount: blockedResponse.data.total,
      unassignedIssues: unassignedResponse.data.issues,
      unassignedCount: unassignedResponse.data.total,
      recentIssues: recentResponse.data.issues,
      recentCount: recentResponse.data.total,
    };

    // Calculate percentages for better insights
    const completionPercentage = Math.round((statusData.doneCount / statusData.totalCount) * 100) || 0;

    try {
      // Generate a conversational response using AI
      const prompt = `
        You are a helpful project assistant providing a project status overview. 
        You should be conversational, insightful and friendly.
        
        Here is data about the current project:
        - Open tasks: ${statusData.openCount}
        - Tasks in progress: ${statusData.inProgressCount}
        - Completed tasks: ${statusData.doneCount}
        - Project completion: ${completionPercentage}%
        - High priority issues: ${statusData.highPriorityCount}
        - Blocked issues: ${statusData.blockedCount}
        - Unassigned issues: ${statusData.unassignedCount}
        - Recent updates: ${statusData.recentCount} in the last 7 days
        
        Craft a brief, conversational summary of the project status that gives the key highlights.
        Include relevant insights based on the numbers.
        Format important information in bold using markdown (**bold**).
        Use bullet points sparingly, and only when it helps readability.
      `;

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Give me a friendly project status overview" },
        ],
        temperature: 0.7,
      });

      // Start with the AI-generated project overview
      let formattedResponse = response.choices[0].message.content;

      // Add high priority issues if there are any
      if (statusData.highPriorityIssues.length > 0) {
        formattedResponse += "\n\n### High Priority Issues\n";
        for (const issue of statusData.highPriorityIssues.slice(0, 3)) {
          const priority = issue.fields.priority?.name || "High";
          const assignee = issue.fields.assignee?.displayName || "Unassigned";
          formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${priority}, assigned to ${assignee})\n`;
        }

        if (statusData.highPriorityCount > 3) {
          formattedResponse += `... and ${statusData.highPriorityCount - 3} more high priority issues.\n`;
        }
      }

      // Add blocked issues if there are any
      if (statusData.blockedIssues.length > 0) {
        formattedResponse += "\n\n### Blocked Issues\n";
        for (const issue of statusData.blockedIssues.slice(0, 3)) {
          const assignee = issue.fields.assignee?.displayName || "Unassigned";
          formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (assigned to ${assignee})\n`;
        }

        if (statusData.blockedCount > 3) {
          formattedResponse += `... and ${statusData.blockedCount - 3} more blocked issues.\n`;
        }
      }

      // Store in conversation memory
      if (conversationMemory[sessionId]) {
        conversationMemory[sessionId].lastResponse = formattedResponse;
      }

      return res.json({
        message: formattedResponse,
        rawData: statusData,
        meta: {
          intent: "PROJECT_STATUS",
        },
      });
    } catch (aiError) {
      console.error("Error generating AI project status:", aiError);

      // Fallback to a formatted response without AI
      let formattedResponse = `## Project Status Overview\n\n`;
      formattedResponse += `**Current progress**: ${completionPercentage}% complete\n`;
      formattedResponse += `**Open tasks**: ${statusData.openCount}\n`;
      formattedResponse += `**In progress**: ${statusData.inProgressCount}\n`;
      formattedResponse += `**Completed**: ${statusData.doneCount}\n\n`;

      if (statusData.highPriorityCount > 0) {
        formattedResponse += `**High priority issues**: ${statusData.highPriorityCount}\n`;
      }

      if (statusData.blockedCount > 0) {
        formattedResponse += `**Blocked issues**: ${statusData.blockedCount}\n`;
      }

      if (statusData.unassignedCount > 0) {
        formattedResponse += `**Unassigned tasks**: ${statusData.unassignedCount}\n`;
      }

      formattedResponse += `\n### Recent Activity\n`;
      for (const issue of statusData.recentIssues.slice(0, 3)) {
        const status = issue.fields.status?.name || "Unknown";
        const updated = new Date(issue.fields.updated).toLocaleDateString();
        formattedResponse += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status}, updated on ${updated})\n`;
      }

      // Store in conversation memory
      if (conversationMemory[sessionId]) {
        conversationMemory[sessionId].lastResponse = formattedResponse;
      }

      return res.json({
        message: formattedResponse,
        rawData: statusData,
        meta: {
          intent: "PROJECT_STATUS",
        },
      });
    }
  } catch (error) {
    console.error("Error fetching project status:", error);
    return null; // Continue with normal processing
  }
}

export async function getProjectTimeline(req, res, query, sessionId) {
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

export async function getTeamWorkload(req, res, query, sessionId) {
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

export async function getAdvancedTimeline(req, res, query, sessionId) {
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


export async function getIssueTypes(req, res, query, sessionId) {
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