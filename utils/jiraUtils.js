import dotenv from 'dotenv';
dotenv.config();

export function createJiraLink(key) {
  return `[${key}](${process.env.JIRA_URL}/browse/${key})`;
}

export function createJiraFilterLink(jql) {
  const encoded = encodeURIComponent(jql);
  return `${process.env.JIRA_URL}/issues/?jql=${encoded}`;
}

export function sanitizeJql(jql) {
    if (!jql) return `project = ${process.env.JIRA_PROJECT_KEY}`;

    // Replace common syntax errors
    let sanitized = jql;

    // Make sure it starts with project specification
    if (!sanitized.includes(`project = `) && !sanitized.includes(`project=`)) {
    sanitized = `project = "${process.env.JIRA_PROJECT_KEY}" AND (${sanitized})`;
    }

    // If it's just a project specification, make sure it's correctly formatted
    if (sanitized.match(/^project\s*=\s*"?[^"]*"?\s*$/)) {
    sanitized = `project = "${process.env.JIRA_PROJECT_KEY}"`;
    }

    // Fix incorrect comma usage - replace commas not inside parentheses with AND
    sanitized = sanitized.replace(/,(?![^(]*\))/g, " AND ");

    // Fix common operator issues
    sanitized = sanitized.replace(/\s+is\s+empty\b/gi, " is EMPTY");
    sanitized = sanitized.replace(/\s+is\s+not\s+empty\b/gi, " is not EMPTY");

    // Make sure any text values containing spaces are in quotes
    sanitized = sanitized.replace(/(\w+)\s*=\s*([^"'\s][^\s]*\s+[^\s"']*[^"'\s])/g, '$1 = "$2"');

    // Add quotes around project key if missing
    sanitized = sanitized.replace(/project\s*=\s*([^"'][^,\s)]*)/g, 'project = "$1"');

    // Ensure reserved words are properly quoted
    const reservedWords = ["limit", "and", "or", "not", "empty", "null", "order", "by", "asc", "desc"];
    for (const word of reservedWords) {
    const regex = new RegExp(`\\b${word}\\b(?<!["'])`, "gi");
    sanitized = sanitized.replace(regex, `"${word}"`);
    }

    // Fix missing quotes in field values
    const commonFields = ["status", "priority", "assignee", "reporter", "creator", "issuetype"];
    for (const field of commonFields) {
    const regex = new RegExp(`${field}\\s*=\\s*([^"'][^\\s)]*(?:[^"']|$))`, "g");
    sanitized = sanitized.replace(regex, `${field} = "$1"`);
    }

    // Fix IN clauses - ensure proper format
    sanitized = sanitized.replace(/(\w+)\s+in\s+\(([^)]+)\)/gi, (match, field, values) => {
    const fixedValues = values
        .split(",")
        .map((v) => v.trim())
        .map((v) => (v.startsWith('"') && v.endsWith('"') ? v : `"${v}"`))
        .join(", ");
    return `${field} IN (${fixedValues})`;
    });

    // Fix space-sensitive formats
    sanitized = sanitized.replace(/\bORDER BY\b/gi, "ORDER BY");

    // Make sure != is properly spaced
    sanitized = sanitized.replace(/(\w+)!=([^=])/g, "$1 != $2");

    // Final safety check - if query becomes too mangled, return a safe default
    if (sanitized.includes("=") && !sanitized.match(/project\s*=/) && !sanitized.match(/key\s*=/)) {
    sanitized = `project = "${process.env.JIRA_PROJECT_KEY}" AND ${sanitized}`;
    }

    console.log("Sanitized JQL:", sanitized);
    return sanitized;
}

export function extractTextFromADF(adf) {
    if (!adf || !adf.content || !Array.isArray(adf.content)) {
        return ""; // Return empty string if no valid content
    }

    let result = "";

    // Recursively extract text from content nodes
    function processNode(node) {
        if (node.text) {
            return node.text;
        }

        if (node.content && Array.isArray(node.content)) {
            return node.content.map(processNode).join("");
        }

        return "";
    }

    // Process each top-level paragraph or other content block
    for (const block of adf.content) {
        if (block.type === "paragraph" || block.type === "text") {
            result += processNode(block) + "\n";
        } else if (block.type === "bulletList" || block.type === "orderedList") {
            // Handle lists
            if (block.content) {
            block.content.forEach((item) => {
                if (item.type === "listItem" && item.content) {
                result += "• " + item.content.map(processNode).join("") + "\n";
                }
            });
            }
        } else if (block.content) {
            // Other block types with content
            result += block.content.map(processNode).join("") + "\n";
        }
    }
    return result.trim();
}

export function preprocessQuery(query) {
      // Trim whitespace and normalize
  query = query.trim().toLowerCase();

  // Map of common query patterns to standardized forms
  const queryMappings = [
    // Project overview and health
    {
      regex: /^(?:how is|how's|what's|what is) (?:the )?project(?:'s)? (?:status|progress|going|health)/i,
      standardized: "show project status",
    },
    {
      regex: /^(?:give me|show|display) (?:the |a )?(?:project|overall) (?:status|overview|summary|health)/i,
      standardized: "show project status",
    },
    { regex: /^(?:project|status) (?:overview|health|summary)/i, standardized: "show project status" },

    // NEW: Issue Types queries
    {
      regex: /(?:what|which|show|list|tell me|get) (?:are |is |the )?(?:work|issue|task) types/i,
      standardized: "show issue types",
    },
    {
      regex: /types? of (?:work|issue|task)/i,
      standardized: "show issue types",
    },
    {
      regex: /(?:work|issue|task) categories/i,
      standardized: "show issue types",
    },

    // Timeline and deadlines
    { regex: /(?:timeline|schedule|roadmap|plan|calendar|deadlines)/i, standardized: "show project timeline" },
    { regex: /what(?:'s| is)? (?:coming up|planned|scheduled|due)/i, standardized: "show upcoming deadlines" },
    { regex: /what(?:'s| is)? due (?:this|next) (?:week|month)/i, standardized: "show upcoming deadlines" },
    { regex: /when (?:will|is|are) .* (?:due|finish|complete|done)/i, standardized: "show project timeline" },
    { regex: /what(?:'s| is) (?:the |our )?schedule/i, standardized: "show project timeline" },

    // Blockers and impediments
    { regex: /(?:blocker|blocking issue|impediment|what's blocking|what is blocking)/i, standardized: "show project blockers" },
    { regex: /what(?:'s| is)? (?:preventing|stopping|holding up)/i, standardized: "show project blockers" },
    { regex: /(?:risk|risks|at risk|critical issue)/i, standardized: "show high risk items" },

    // Workloads and assignments
    { regex: /who(?:'s| is) (?:working on|assigned to|responsible for)/i, standardized: "show team workload" },
    { regex: /what(?:'s| is) (?:everyone|everybody|the team) working on/i, standardized: "show team workload" },
    { regex: /(?:workload|bandwidth|capacity|allocation)/i, standardized: "show team workload" },
    { regex: /who(?:'s| is) (?:overloaded|busy|free|available)/i, standardized: "show team workload" },

    // Tasks and issues
    { regex: /(?:show|list|find|get) (?:all |the | me |)?(?:open|active|current) (?:tasks|issues|tickets)/i, standardized: "show open tasks" },
    {
      regex: /(?:show|list|find|get) (?:all |the | me |)?(?:closed|completed|done|resolved) (?:tasks|issues|tickets)/i,
      standardized: "show closed tasks",
    },
    {
      regex: /(?:show|list|find|get) (?:all |the |me |)?(?:high priority|important|highest priority|critical) (?:tasks|issues|tickets)/i,
      standardized: "show high priority tasks",
    },
    {
      regex: /(?:show|list|find|get|what is|which is|what are|which are) (?:the |all |a | me)?(?:highest priority|high priority|important|critical) (?:tasks|issues|tickets)/i,
      standardized: "show high priority tasks",
    },
    {
      regex: /(?:show|list|find|get|what is|which is) (?:the |a |me )?(?:highest priority|high priority|important|critical) (?:task|issue|ticket)/i,
      standardized: "show highest priority task",
    },
  
    {
      regex: /(?:show|list|find|get) (?:all |the |)?(?:unassigned|without assignee) (?:tasks|issues|tickets)/i,
      standardized: "show unassigned tasks",
    },

    // Recent activity
    { regex: /(?:recent|latest|last|newest|what's new|what is new)/i, standardized: "show recent updates" },
    { regex: /what(?:'s| has) changed/i, standardized: "show recent updates" },
    { regex: /what(?:'s| has) happened/i, standardized: "show recent updates" },

    // Sprint related
    { regex: /(?:current|active|ongoing) sprint/i, standardized: "show current sprint" },
    { regex: /sprint status/i, standardized: "show current sprint" },
    { regex: /(?:sprint|iteration) progress/i, standardized: "show current sprint" },

    // Most recent task specifically
    {
      regex: /(?:latest|most recent|last) (?:edited|updated|modified|changed) (?:task|issue|ticket)/i,
      standardized: "show most recently updated task",
    },
    {
      regex: /(?:what|show me|tell me about) (?:the )?(?:dependencies|related issues|linked tasks|blockers) (?:for|of) (NIHK-\d+)/i,
      standardized: "show dependencies for $1",
    },
    {
      regex: /(?:what|show|list|tell me) (?:the|are|all|my) (?:team'?s?|team member'?s?) (?:current )?(?:workload|assignments|tasks)/i,
      standardized: "show team workload",
    },
    {
      regex: /(?:compare|how does|what's the difference between) (NIHK-\d+) (?:and|vs|versus) (NIHK-\d+)/i,
      standardized: "compare issues $1 $2",
    },
    {
      regex: /(?:what|how many|count) comments (?:are there |have been |were added |exist )?(?:on|for|in) (NIHK-\d+)/i,
      standardized: "show comments for $1",
    },
    {
      regex: /(?:who|which team member|which person) (?:has|is assigned|is working on) (?:the )?most (?:tasks|issues|work)/i,
      standardized: "show busiest team member",
    },

    // Specific task by ID
    {
      regex: new RegExp(`(?:show|tell me about|what is|details for|info on)\\s+${process.env.JIRA_PROJECT_KEY}-\\d+`, "i"),
      standardized: query,
    },
  ];

  // Find a match and return the standardized form
  for (const mapping of queryMappings) {
    if (mapping.regex.test(query)) {
      console.log(`Standardized query from "${query}" to "${mapping.standardized}"`);
      return mapping.standardized;
    }
  }

  // If no mapping found, clean up the query a bit
  const cleanQuery = query.replace(/[.,!?;]/g, "").trim();

  return cleanQuery;

}

export function determineFieldsForIntent(intent) {
    // Set default fields for all queries
    let fields = "summary,status,assignee,priority";

    // Add intent-specific fields
    if (intent === "PROJECT_STATUS") {
        fields += ",updated,created,issuetype";
    } else if (intent === "TIMELINE") {
        fields += ",duedate,created,updated";
    } else if (intent === "BLOCKERS" || intent === "HIGH_PRIORITY") {
        fields += ",labels,issuetype";
    } else if (intent === "TASK_LIST") {
        fields += ",issuetype,created";
    } else if (intent === "ASSIGNED_TASKS" || intent === "WORKLOAD") {
        fields += ",duedate,issuetype";
    } else if (intent === "TASK_DETAILS") {
        fields += ",description,comment,created,updated,duedate,issuelinks,labels,components";
    } else if (intent === "COMMENTS") {
        fields += ",comment,updated";
    } else if (intent === "SPRINT") {
        fields += ",sprint,created,updated";
    }

    return fields;

}

// Helper function to compare two issues and find similarities and differences
export function compareIssueData(issue1, issue2) {
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

export async function compareIssues(req, res, query, sessionId) {
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

export function analyzeComparisonFocus(query) {
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

export function handleQueryError(error, query, sessionId) {
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

export function createFallbackResponse(data, intent, query) {
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