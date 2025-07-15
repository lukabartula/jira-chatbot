import { updateUserPreferences } from "./userContext.js";

export const conversationMemory = {};

export function getConversationMemory(sessionId = "default") {
    if (!conversationMemory[sessionId]) {
    // Create a fully initialized memory object
    conversationMemory[sessionId] = {
      queries: [],
      intents: [],
      lastResponse: null,
      lastIssueKey: null,
      userPreferences: {
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
      },
      responseMetrics: {
        totalResponses: 0,
        aiGeneratedResponses: 0,
        fallbackResponses: 0,
        emptyResultsResponses: 0,
        averageResponseTime: 0,
        totalResponseTime: 0,
      },
    };
  } else {
    // Ensure all required fields exist (defensive programming)
    const memory = conversationMemory[sessionId];

    if (!memory.queries) memory.queries = [];
    if (!memory.intents) memory.intents = [];

    // Initialize userPreferences if it doesn't exist
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

    // Initialize responseMetrics if it doesn't exist
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
  }

  return conversationMemory[sessionId];

}

// Update conversation memory with new query and response
export function updateConversationMemory(sessionId, query, intent, response, responseTime, usedAI = true, hadResults = true) {
  const memory = getConversationMemory(sessionId);

  // Update query history
  memory.queries.push(query);
  if (memory.queries.length > 10) {
    memory.queries.shift(); // Keep only the 10 most recent
  }

  // Update intent history
  memory.intents.push(intent);
  if (memory.intents.length > 10) {
    memory.intents.shift();
  }

  // Store last response
  memory.lastResponse = response;

  // Track last viewed issue if applicable
  const issueKeyMatch = query.match(new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i"));
  if (issueKeyMatch && intent === "TASK_DETAILS") {
    memory.lastIssueKey = issueKeyMatch[0];
  }

  // Ensure userPreferences exists
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

  // Ensure responseMetrics exists
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

  // Update user preferences based on this interaction
  updateUserPreferences(memory, query, intent, response);

  // Update response metrics
  memory.responseMetrics.totalResponses++;
  memory.responseMetrics.totalResponseTime += responseTime;
  memory.responseMetrics.averageResponseTime = memory.responseMetrics.totalResponseTime / memory.responseMetrics.totalResponses;

  if (usedAI) {
    memory.responseMetrics.aiGeneratedResponses++;
  } else {
    memory.responseMetrics.fallbackResponses++;
  }

  if (!hadResults) {
    memory.responseMetrics.emptyResultsResponses++;
  }

  // Update session metrics
  memory.userPreferences.lastActive = Date.now();
  memory.userPreferences.sessionDuration = memory.userPreferences.lastActive - memory.userPreferences.sessionStartTime;
  memory.userPreferences.queryCount = (memory.userPreferences.queryCount || 0) + 1;

  // Update average query length
  const prevQueryCount = memory.userPreferences.queryCount - 1;
  const totalQueryLength = memory.userPreferences.avgQueryLength * prevQueryCount + query.length;
  memory.userPreferences.avgQueryLength = totalQueryLength / memory.userPreferences.queryCount;

  return memory;
}
