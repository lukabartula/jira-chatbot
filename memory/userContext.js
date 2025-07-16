import { conversationMemory, getConversationMemory, updateConversationMemory } from "./conversationMemory.js";

export function updateUserPreferences(memory, query, intent, response) {
  // Make sure userPreferences exists
  if (!memory.userPreferences) {
    memory.userPreferences = {
      verbosityLevel: "medium",
      favoriteAssignees: {},
      favoriteStatuses: {},
      frequentIssueTypes: {},
      preferredSortOrder: null,
      avgQueryLength: 0,
      queryCount: 0,
      lastActive: Date.now(),
      sessionDuration: 0,
      sessionStartTime: Date.now(),
    };
  }

  // Check verbosity preference based on query
  if (/brief|short|quick|summary|summarize/i.test(query)) {
    memory.userPreferences.verbosityLevel = "concise";
  } else if (/detail|detailed|in depth|elaborate|full|comprehensive/i.test(query)) {
    memory.userPreferences.verbosityLevel = "detailed";
  }

  // Track mentioned assignees
  const assigneeMatch = query.match(/assigned to (\w+)|(\w+)'s tasks/i);
  if (assigneeMatch) {
    const assignee = assigneeMatch[1] || assigneeMatch[2];
    if (!memory.userPreferences.favoriteAssignees) memory.userPreferences.favoriteAssignees = {};
    memory.userPreferences.favoriteAssignees[assignee] = (memory.userPreferences.favoriteAssignees[assignee] || 0) + 1;
  }

  // Track mentioned statuses
  const statusMatch = query.match(/status (?:is |=)?\s*"?(open|in progress|done|closed|to do)"?/i);
  if (statusMatch) {
    const status = statusMatch[1].toLowerCase();
    if (!memory.userPreferences.favoriteStatuses) memory.userPreferences.favoriteStatuses = {};
    memory.userPreferences.favoriteStatuses[status] = (memory.userPreferences.favoriteStatuses[status] || 0) + 1;
  }

  // Track issue types they're interested in
  const typeMatch = query.match(/type (?:is |=)?\s*"?(bug|story|task|epic)"?/i);
  if (typeMatch) {
    const issueType = typeMatch[1].toLowerCase();
    if (!memory.userPreferences.frequentIssueTypes) memory.userPreferences.frequentIssueTypes = {};
    memory.userPreferences.frequentIssueTypes[issueType] = (memory.userPreferences.frequentIssueTypes[issueType] || 0) + 1;
  }

  // Track sort order preference
  if (/sort by|order by/i.test(query)) {
    if (/recent|latest|newest|updated/i.test(query)) {
      memory.userPreferences.preferredSortOrder = "updated DESC";
    } else if (/oldest|first|created/i.test(query)) {
      memory.userPreferences.preferredSortOrder = "created ASC";
    } else if (/priority/i.test(query)) {
      memory.userPreferences.preferredSortOrder = "priority DESC";
    } else if (/due date|deadline/i.test(query)) {
      memory.userPreferences.preferredSortOrder = "duedate ASC";
    }
  }
}

export function getUserContext(sessionId = "default") {
  // Make sure we have a valid memory object with all required fields
  const memory = getConversationMemory(sessionId);

  // Ensure all required properties exist
  if (!memory.userPreferences) {
    memory.userPreferences = {
      verbosityLevel: "medium",
      favoriteAssignees: {},
      favoriteStatuses: {},
      frequentIssueTypes: {},
      preferredSortOrder: null,
      avgQueryLength: 0,
      queryCount: 0,
      lastActive: null,
      sessionDuration: 0,
      sessionStartTime: Date.now(),
    };
  }

  if (!memory.responseMetrics) {
    memory.responseMetrics = {
      totalResponses: 0,
      aiGeneratedResponses: 0,
      fallbackResponses: 0,
      emptyResultsResponses: 0,
      averageResponseTime: 0,
      totalResponseTime: 0,
    };
  }

  // Calculate top preferences (safely)
  const topAssignee =
    Object.entries(memory.userPreferences.favoriteAssignees || {})
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)[0] || null;

  const topIssueType =
    Object.entries(memory.userPreferences.frequentIssueTypes || {})
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type)[0] || null;

  // Calculate recency metrics
  const isReturningUser = (memory.userPreferences.sessionCount || 0) > 1;
  const hasRecentActivity = memory.queries.length > 0;

  // Get conversation flow information
  const recentIntents = memory.intents.slice(-3);
  const isFollowUp = detectFollowUpQuery(memory.queries);

  return {
    preferences: {
      verbosityLevel: memory.userPreferences.verbosityLevel || "medium",
      preferredSortOrder: memory.userPreferences.preferredSortOrder || null,
      topAssignee,
      topIssueType,
    },
    conversation: {
      previousQueries: memory.queries.slice(-3),
      previousIntents: recentIntents,
      lastResponse: memory.lastResponse,
      lastIssueKey: memory.lastIssueKey || null,
      isFollowUp,
      hasRecentActivity,
    },
    metrics: {
      queryCount: memory.userPreferences.queryCount || 0,
      avgQueryLength: memory.userPreferences.avgQueryLength || 0,
      isReturningUser,
      sessionDuration: memory.userPreferences.sessionDuration || 0,
    },
  };
}

export function detectFollowUpQuery(queries) {
  if (queries.length < 2) return false;

  const currentQuery = queries[queries.length - 1].toLowerCase();

  // Check for pronouns referring to previous results
  if (/\b(it|them|those|these|this|that|they)\b/i.test(currentQuery)) {
    return true;
  }

  // Check for queries that start with conjunctions
  if (/^(and|but|also|what about|how about)/i.test(currentQuery)) {
    return true;
  }

  // Check for very short queries that wouldn't make sense standalone
  if (currentQuery.split(" ").length <= 3 && !/^(show|list|find|what|who|how|when)/i.test(currentQuery)) {
    return true;
  }

  return false;
}

export function applyUserContext(jql, userContext) {
  // Don't modify specific issue queries
  if (jql.includes("key =")) {
    return jql;
  }

  let enhancedJql = jql;

  // Apply sort order preference if not already specified
  if (userContext.preferences.preferredSortOrder && !jql.includes("ORDER BY")) {
    enhancedJql += ` ORDER BY ${userContext.preferences.preferredSortOrder}`;
  }

  // For generic queries, consider prioritizing their favorite issue types
  if (userContext.preferences.topIssueType && !jql.includes("issuetype") && userContext.metrics.queryCount > 5) {
    // Only suggest their preferred issue type, don't force it
    console.log(`User prefers ${userContext.preferences.topIssueType} issues, but using original query`);
  }

  return enhancedJql;
}

export function getPersonalizedSystemPrompt(userContext, intent) {
  let personalization = "";

  // Adjust verbosity based on preference
  if (userContext.preferences.verbosityLevel === "concise") {
    personalization += `
      The user prefers concise, to-the-point responses. Keep your answer brief and focused.
      Limit examples and avoid unnecessary details. Prioritize facts, numbers, and key insights.
    `;
  } else if (userContext.preferences.verbosityLevel === "detailed") {
    personalization += `
      The user prefers detailed, comprehensive responses. Provide thorough explanations and context.
      Include relevant examples and supporting details. Offer additional insights where applicable.
    `;
  }

  // Add personalization for returning users
  if (userContext.metrics.queryCount > 5) {
    personalization += `
      This is a returning user who has asked ${userContext.metrics.queryCount} questions.
      They tend to ask about ${userContext.preferences.topIssueType || "various issues"} 
      ${userContext.preferences.topAssignee ? `assigned to ${userContext.preferences.topAssignee}` : ""}.
    `;
  }

  // Add context for follow-ups
  if (userContext.conversation.isFollowUp) {
    personalization += `
      This appears to be a follow-up to their previous question.
      Their last query was: "${userContext.conversation.previousQueries[userContext.conversation.previousQueries.length - 2]}"
      Your last response included information about ${summarizeLastResponse(userContext.conversation.lastResponse)}.
    `;
  }

  // Add context for recently viewed issues
  if (userContext.conversation.lastIssueKey) {
    personalization += `
      The user recently viewed issue ${userContext.conversation.lastIssueKey}.
      If this query seems related, you may want to reference this issue in your response.
    `;
  }

  return personalization;
}

function summarizeLastResponse(lastResponse) {
  if (!lastResponse) return "various project items";

  // Extract key information from the last response
  if (lastResponse.includes("status") && lastResponse.includes("project")) {
    return "project status";
  } else if (lastResponse.includes("timeline") || lastResponse.includes("due")) {
    return "project timeline";
  } else if (lastResponse.includes("blocker") || lastResponse.includes("impediment")) {
    return "project blockers";
  } else if (lastResponse.includes("workload") || lastResponse.includes("assigned")) {
    return "team workload";
  } else if (lastResponse.match(/NIHK-\d+/)) {
    const issueKey = lastResponse.match(/NIHK-\d+/)[0];
    return `issue ${issueKey}`;
  } else {
    return "various project items";
  }
}

export function determineResultsLimit(intent, userContext) {
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