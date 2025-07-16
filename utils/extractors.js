export function extractEntitiesFromQuery(query) {
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

export function extractTimeParameters(query) {
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

export function organizeTimelineByDate(issues, timeParams) {
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

export function getTimeframeDescription(timeParams) {
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

export function extractIssueData(issue) {
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

// Helper functions for extracting context from conversation
export function extractRecentIssues(queries) {
  const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "gi");
  const issues = [];

  queries?.forEach((query) => {
    const matches = query.match(issueKeyPattern);
    if (matches) issues.push(...matches);
  });

  return [...new Set(issues)].slice(-3); // Only keep most recent 3 unique issues
}

export function extractRecentAssignees(queries) {
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