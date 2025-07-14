import { sanitizeJql } from '../utils/jiraUtils.js';
import { extractEntitiesFromQuery } from '../utils/extractors.js';
import { openai } from '../config/openaiConfig.js';
import { safeJqlTemplates } from '../config/jiraConfig.js';


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

