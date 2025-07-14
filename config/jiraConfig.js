// Safe JQL templates for Jira queries
export const safeJqlTemplates = {
  PROJECT_STATUS: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
  TIMELINE: `project = ${process.env.JIRA_PROJECT_KEY} AND duedate IS NOT EMPTY ORDER BY duedate ASC`,
  TIMELINE_UPCOMING: `project = ${process.env.JIRA_PROJECT_KEY} AND duedate >= now() ORDER BY duedate ASC`,
  TIMELINE_OVERDUE: `project = ${process.env.JIRA_PROJECT_KEY} AND duedate < now() AND status != "Done" ORDER BY duedate ASC`,
  BLOCKERS: `project = ${process.env.JIRA_PROJECT_KEY} AND (priority in ("High", "Highest") OR status = "Blocked" OR labels = "blocker") AND status not in ("Done", "Closed", "Resolved")`,
  HIGHEST_PRIORITY_SINGLE: `project = ${process.env.JIRA_PROJECT_KEY} AND priority in ("High", "Highest") AND status not in ("Done", "Closed", "Resolved") ORDER BY priority DESC, updated DESC`,
  HIGH_PRIORITY: `project = ${process.env.JIRA_PROJECT_KEY} AND priority in ("High", "Highest") AND status not in ("Done", "Closed", "Resolved")`,
  OPEN_TASKS: `project = ${process.env.JIRA_PROJECT_KEY} AND status in ("Open", "In Progress", "To Do", "Reopened")`,
  HIGH_PRIORITY_COUNT: `project = ${process.env.JIRA_PROJECT_KEY} AND priority in ("High", "Highest") AND status not in ("Done", "Closed", "Resolved")`,
  CLOSED_TASKS: `project = ${process.env.JIRA_PROJECT_KEY} AND status in ("Done", "Closed", "Resolved")`,
  ASSIGNED_TASKS: `project = ${process.env.JIRA_PROJECT_KEY} AND assignee IS NOT EMPTY AND status not in ("Done", "Closed", "Resolved")`,
  UNASSIGNED_TASKS: `project = ${process.env.JIRA_PROJECT_KEY} AND assignee IS EMPTY AND status not in ("Done", "Closed", "Resolved")`,
  RECENT_UPDATES: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
  CURRENT_SPRINT: `project = ${process.env.JIRA_PROJECT_KEY} AND sprint in openSprints()`,
  MOST_RECENT_TASK: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY updated DESC`,
  ISSUE_TYPES: `project = ${process.env.JIRA_PROJECT_KEY} ORDER BY issuetype ASC`,
};
