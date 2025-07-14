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