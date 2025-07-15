export function extractEntititesFromQuery(query) {
    const entities = {
    assignee: null,
    priority: null,
    status: null,
    type: null,
    timeframe: null,
  };

  // Extract assignee
  const assigneeMatch = query.match(/assigned to ([\w\s]+)|([\w\s]+)'s (tasks|issues|workload)|by ([\w\s]+)/i);
  if (assigneeMatch) {
    entities.assignee =
      (assigneeMatch[1] || assigneeMatch[2] || assigneeMatch[4])?.trim().replace(/\s{2,}/g, " ");
  }

  // Extract priority
  const priorityMatch = query.match(/priority (?:is |of |=)?\s*"?(high|highest|medium|low|lowest)"?/i);
  if (priorityMatch) {
    entities.priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
  }

  // Extract status
  const statusMatch = query.match(/status (?:is |of |=)?\s*"?(open|in progress|done|closed|to do)"?/i);
  if (statusMatch) {
    entities.status = statusMatch[1].charAt(0).toUpperCase() + statusMatch[1].slice(1).toLowerCase();

    // Special case for "In Progress" to get capitalization right
    if (entities.status.toLowerCase() === "in progress") {
      entities.status = "In Progress";
    }
  }

  // Extract issue type
  const typeMatch = query.match(/type (?:is |of |=)?\s*"?(bug|story|task|epic)"?/i);
  if (typeMatch) {
    entities.type = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase();
  }

  // Extract timeframe
  if (/this week|current week/i.test(query)) {
    entities.timeframe = "thisWeek";
  } else if (/next week/i.test(query)) {
    entities.timeframe = "nextWeek";
  } else if (/this month|current month/i.test(query)) {
    entities.timeframe = "thisMonth";
  } else if (/overdue|late|past due/i.test(query)) {
    entities.timeframe = "overdue";
  } else if (/recent|latest|last/i.test(query)) {
    entities.timeframe = "recent";
  }

  return entities;

}