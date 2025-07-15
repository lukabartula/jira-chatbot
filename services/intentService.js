import { openai } from "../config/openaiConfig";

export async function analyzeQueryIntent(query) {
  // Store original query for logging
  const originalQuery = query;

  // Preprocess the query
  query = query.trim().toLowerCase();

  // First check for exact pattern matches we can directly classify with high confidence
  if (/sprint|current sprint|active sprint|sprint status|sprint board/i.test(query)) {
    console.log(`Direct match: "${originalQuery}" -> SPRINT`);
    return "SPRINT";
  }

  if (/^(?:hi|hello|hey|hi there|greetings|how are you|what can you do|what do you do|help me|how do you work)/i.test(query.trim())) {
    console.log(`Direct match: "${originalQuery}" -> GREETING`);
    return "GREETING";
  }

  // Check for issue type related queries
  if (/(?:work|issue|task)\s+types?|types? of (?:work|issue|task)|(?:what|which) (?:work|issue|task) types?/i.test(query)) {
    console.log(`Direct match: "${originalQuery}" -> ISSUE_TYPES`);
    return "ISSUE_TYPES";
  }

  const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
  if (issueKeyPattern.test(query) && /^(?:show|tell|get|what is|about) ${process.env.JIRA_PROJECT_KEY}-\d+$/i.test(query.trim())) {
    console.log(`Direct match: "${originalQuery}" -> TASK_DETAILS`);
    return "TASK_DETAILS";
  }

  // Common pattern sets with confidence ranking for precise intent detection
  const intentPatterns = [
    {
      intent: "PROJECT_STATUS",
      highConfidencePatterns: [
        /^(?:what|how) is (?:the |our )?project(?:'s)? (?:status|health|progress)/i,
        /^(?:give|show) me (?:the |a )?project (?:status|overview|summary|health)/i,
        /^project (?:status|health|overview|summary)$/i,
      ],
      mediumConfidencePatterns: [/status|progress|overview|health|how is the project/i],
    },
    {
      intent: "TIMELINE",
      highConfidencePatterns: [
        /^(?:what|show) is (?:the |our )?(?:timeline|roadmap|schedule|calendar)/i,
        /^(?:when|what) is (?:due|upcoming|planned|scheduled)/i,
        /^(?:show|display) (?:the |our )?(?:timeline|roadmap|schedule|deadlines)/i,
      ],
      mediumConfidencePatterns: [/timeline|roadmap|schedule|deadline|due date|when|calendar/i],
    },
    {
      intent: "BLOCKERS",
      highConfidencePatterns: [
        /^(?:what|any|show) (?:is|are) (?:blocking|blockers|impediments|obstacles)/i,
        /^(?:show|list|find|get) (?:all |the |)?blockers/i,
        /^(?:what|anything) (?:preventing|stopping|holding up) (?:the |our )?(?:progress|project|work)/i,
      ],
      mediumConfidencePatterns: [/block|blocker|blocking|stuck|impediment|obstacle|risk|critical|prevent/i],
    },
    {
      intent: "WORKLOAD",
      highConfidencePatterns: [
        /^(?:what|how) is (?:the |our )?(?:team'?s?|team member'?s?) (?:workload|capacity|bandwidth)/i,
        /^(?:who|which team member) (?:has|is) (?:too much|overloaded|busy|free|available)/i,
        /^(?:show|display) (?:the |team |)?workload/i,
      ],
      mediumConfidencePatterns: [/workload|capacity|bandwidth|overloaded|busy|who.*working|team.* work/i],
    },
    {
      intent: "ASSIGNED_TASKS",
      highConfidencePatterns: [
        /^(?:what|which|show) (?:tasks?|issues?|tickets?) (?:is|are) (?:assigned to|owned by) ([a-z]+)/i,
        /^(?:what|show me) (?:is|are) ([a-z]+) working on/i,
        /^(?:who|show) (?:is|are) (?:responsible for|assigned to|working on)/i,
      ],
      mediumConfidencePatterns: [/assign|working on|responsible|owner|who is|who's/i],
    },
    {
      intent: "TASK_LIST",
      highConfidencePatterns: [
        /^(?:show|list|find|get) (?:all |the |)?(?:open|active|current|closed|completed|done|high priority) (?:tasks|issues|tickets)/i,
        /^(?:what|which|list|get|show) (?:tasks|issues|tickets) (?:are|have)/i,
        /^(?:show|list|find|get|what is|which is|what are|which are) (?:the |all |a )?(?:open|active|current|closed|completed|done|high priority|highest priority) (?:tasks|issues|tickets)/i,
        /^(?:show|list|find|get|what is|which is) (?:the |a )?(?:open|active|current|closed|completed|done|high priority) (?:task|issue|ticket)/i,
      ],
      mediumConfidencePatterns: [/list|show|find|search|get|all|open|closed|high|task|issue|ticket/i],
    },
    {
      intent: "TASK_DETAILS",
      highConfidencePatterns: [
        /^(?:tell|show|describe|what) (?:me |is |)?(?:about |details (?:for|about) )?${process.env.JIRA_PROJECT_KEY}-\d+/i,
        /^${process.env.JIRA_PROJECT_KEY}-\d+/i,
      ],
      mediumConfidencePatterns: [new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i")],
    },
    {
      intent: "COMMENTS",
      highConfidencePatterns: [
        /^(?:show|get|what|any) (?:comments|updates|activity) (?:on|for|about) ${process.env.JIRA_PROJECT_KEY}-\d+/i,
        /^(?:what|who) (?:did|has) (?:someone|anyone|people|team) (?:say|comment|mention|note) (?:about|on|regarding)/i,
      ],
      mediumConfidencePatterns: [/comment|said|mentioned|update|notes/i],
    },
    {
      intent: "SPRINT",
      highConfidencePatterns: [
        /^(?:how|what) is (?:the |our |current )?sprint/i,
        /^(?:show|display|current) sprint/i,
        /^sprint (?:status|progress|overview|details)/i,
      ],
      mediumConfidencePatterns: [/sprint/i],
    },
  ];

  // Try to match against high confidence patterns first
  for (const patternSet of intentPatterns) {
    for (const pattern of patternSet.highConfidencePatterns) {
      if (pattern.test(query)) {
        console.log(`High confidence match: "${originalQuery}" -> ${patternSet.intent}`);
        return patternSet.intent;
      }
    }
  }

  // Then try medium confidence patterns
  let matchedIntents = [];
  for (const patternSet of intentPatterns) {
    for (const pattern of patternSet.mediumConfidencePatterns) {
      if (pattern.test(query)) {
        matchedIntents.push(patternSet.intent);
        break; // Only add each intent once
      }
    }
  }

  // If we have one match, return it
  if (matchedIntents.length === 1) {
    console.log(`Medium confidence match: "${originalQuery}" -> ${matchedIntents[0]}`);
    return matchedIntents[0];
  }

  // If we have multiple matches, try using AI to disambiguate
  if (matchedIntents.length > 1) {
    try {
      console.log(`Multiple possible intents for "${originalQuery}": ${matchedIntents.join(", ")}. Using AI to disambiguate.`);

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `
              You classify Jira-related questions into specific intent categories. 
              Analyze the query carefully and return ONLY ONE of these categories:
              
              - PROJECT_STATUS: Questions about overall project health, progress, metrics
                Examples: "How's the project going?", "What's our current status?", "Give me a project overview"
                
              - TASK_LIST: Requests for lists of tasks matching certain criteria
                Examples: "Show me all open bugs", "List the high priority tasks", "What tasks are due this week?"
                
              - ASSIGNED_TASKS: Questions about who is working on what
                Examples: "What is John working on?", "Show me Sarah's tasks", "Who's responsible for the login feature?"
                
              - TASK_DETAILS: Questions about specific tickets or issues
                Examples: "Tell me about PROJ-123", "What's the status of the payment feature?", "Who's working on the homepage redesign?"
                
              - BLOCKERS: Questions about impediments or high-priority issues
                Examples: "What's blocking us?", "Are there any critical issues?", "What should we focus on fixing first?"
                
              - TIMELINE: Questions about deadlines, due dates, or project schedule
                Examples: "What's due this week?", "When will feature X be done?", "Show me upcoming deadlines"
                
              - COMMENTS: Questions looking for updates, comments, or recent activity
                Examples: "Any updates on PROJ-123?", "What did John say about the login issue?", "Latest comments on the API task?"
                
              - WORKLOAD: Questions about team capacity and individual workloads
                Examples: "Who has the most tasks?", "Is anyone overloaded?", "How's the team's capacity looking?"
                
              - SPRINT: Questions about sprint status and activity
                Examples: "How's the current sprint?", "What's in this sprint?", "Sprint progress"

              - ISSUE_TYPES: Questions about the types of work items in the project
                Examples: "What work types exist in the project?", "Show me the issue types", "What kind of tasks do we have?"
                
              - GENERAL: General questions that don't fit other categories
                Examples: "Help me with Jira", "What can you do?", "How does this work?"
                
              - CONVERSATION: Follow-up questions, clarifications, or conversational exchanges
                Examples: "Can you explain more?", "Thanks for that info", "That's not what I meant"
              
              The system has already identified these as potential intents: ${matchedIntents.join(", ")}
              Please select the MOST APPROPRIATE intent from these options only. Return ONLY the intent name.
            `,
          },
          { role: "user", content: query },
        ],
        temperature: 0.1,
      });

      const selectedIntent = response.choices[0].message.content.trim();

      // Make sure the AI returned one of our valid intents
      if (matchedIntents.includes(selectedIntent)) {
        console.log(`AI disambiguated: "${originalQuery}" -> ${selectedIntent}`);
        return selectedIntent;
      } else {
        console.log(`AI returned invalid intent: ${selectedIntent}. Falling back to first matched intent.`);
        return matchedIntents[0];
      }
    } catch (error) {
      console.error("Error using AI to disambiguate intent:", error);
      // In case of error, return the first matched intent
      console.log(`Falling back to first matched intent: "${originalQuery}" -> ${matchedIntents[0]}`);
      return matchedIntents[0];
    }
  }

  // If we still don't have a match, try AI for the full query
  try {
    console.log(`No pattern matches for "${originalQuery}". Using AI for full intent analysis.`);

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `
            You classify Jira-related questions into specific intent categories. 
            Analyze the query carefully and return ONLY ONE of these categories:
            
            - PROJECT_STATUS: Questions about overall project health, progress, metrics
              Examples: "How's the project going?", "What's our current status?", "Give me a project overview"
              
            - TASK_LIST: Requests for lists of tasks matching certain criteria
              Examples: "Show me all open bugs", "List the high priority tasks", "What tasks are due this week?"
              
            - ASSIGNED_TASKS: Questions about who is working on what
              Examples: "What is John working on?", "Show me Sarah's tasks", "Who's responsible for the login feature?"
              
            - TASK_DETAILS: Questions about specific tickets or issues
              Examples: "Tell me about PROJ-123", "What's the status of the payment feature?", "Who's working on the homepage redesign?"
              
            - BLOCKERS: Questions about impediments or high-priority issues
              Examples: "What's blocking us?", "Are there any critical issues?", "What should we focus on fixing first?"
              
            - TIMELINE: Questions about deadlines, due dates, or project schedule
              Examples: "What's due this week?", "When will feature X be done?", "Show me upcoming deadlines"
              
            - COMMENTS: Questions looking for updates, comments, or recent activity
              Examples: "Any updates on PROJ-123?", "What did John say about the login issue?", "Latest comments on the API task?"
              
            - WORKLOAD: Questions about team capacity and individual workloads
              Examples: "Who has the most tasks?", "Is anyone overloaded?", "How's the team's capacity looking?"
              
            - SPRINT: Questions about sprint status and activity
              Examples: "How's the current sprint?", "What's in this sprint?", "Sprint progress"

            - ISSUE_TYPES: Questions about the types of work items in the project
              Examples: "What work types exist in the project?", "Show me the issue types", "What kind of tasks do we have?"
              
            - GENERAL: General questions that don't fit other categories
              Examples: "Help me with Jira", "What can you do?", "How does this work?"
              
            - CONVERSATION: Follow-up questions, clarifications, or conversational exchanges
              Examples: "Can you explain more?", "Thanks for that info", "That's not what I meant"
          `,
        },
        { role: "user", content: query },
      ],
      temperature: 0.1,
    });

    const aiIntent = response.choices[0].message.content.trim();
    console.log(`AI intent analysis: "${originalQuery}" -> ${aiIntent}`);
    return aiIntent;
  } catch (error) {
    console.error("Error analyzing query intent with AI:", error);

    // Ultimate fallback: keyword-based detection
    console.log(`Falling back to keyword-based detection for "${originalQuery}"`);

    // NEW: Check for issue type related queries in fallback
    if (/(?:work|issue|task)\s+types?|types? of (?:work|issue|task)/i.test(query)) {
      return "ISSUE_TYPES";
    } else if (/timeline|roadmap|schedule|deadline|due date|what.* due|calendar|when/i.test(query)) {
      return "TIMELINE";
    } else if (/block|blocker|blocking|stuck|impediment|obstacle|risk|critical/i.test(query)) {
      return "BLOCKERS";
    } else if (/assign|working on|responsible|owner|who is|who's/i.test(query)) {
      return "ASSIGNED_TASKS";
    } else if (/status|progress|update|how is|how's|overview/i.test(query)) {
      return "PROJECT_STATUS";
    } else if (/list|show|find|search|get|all/i.test(query)) {
      return "TASK_LIST";
    } else if (/comment|said|mentioned|update|notes/i.test(query)) {
      return "COMMENTS";
    } else if (/workload|capacity|bandwidth|overloaded|busy/i.test(query)) {
      return "WORKLOAD";
    } else if (/sprint/i.test(query)) {
      return "SPRINT";
    } else if (issueKeyPattern.test(query)) {
      return "TASK_DETAILS";
    } else {
      return "GENERAL";
    }
  }

}