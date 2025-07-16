import axios from 'axios';
import { openai } from '../config/openaiConfig.js';
import { getConversationMemory, conversationMemory } from '../memory/conversationMemory.js';
import { createJiraLink } from '../utils/jiraUtils.js';


export async function getDetailedWorkloadAnalysis(req, res, query, sessionId) {
  try {
    // Extract parameters from query
    const workloadParams = {
      showUnassigned: /unassigned|not assigned/i.test(query),
      focusPerson: null,
      includeCompleted: /include (done|completed|finished)/i.test(query),
      showPriority: /by priority|priority breakdown/i.test(query),
      showStatus: /by status|status breakdown/i.test(query),
    };

    // Check if query focuses on a specific person
    const personMatch = query.match(/(?:about|for|on) (\w+)['s]? workload/i);
    if (personMatch) {
      workloadParams.focusPerson = personMatch[1];
    }

    // Build appropriate JQL
    let jql = `project = ${process.env.JIRA_PROJECT_KEY}`;

    if (!workloadParams.includeCompleted) {
      jql += ` AND status != "Done"`;
    }

    if (workloadParams.focusPerson) {
      jql += ` AND assignee ~ "${workloadParams.focusPerson}"`;
    } else if (!workloadParams.showUnassigned) {
      jql += ` AND assignee IS NOT EMPTY`;
    }

    jql += ` ORDER BY assignee ASC, priority DESC`;

    // Fetch all assignments
    const workloadResponse = await axios.get(`${JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: jql,
        maxResults: 100,
        fields: "summary,status,assignee,priority,duedate,issuetype,created,updated",
      },
      auth,
    });

    if (workloadResponse.data && workloadResponse.data.issues && workloadResponse.data.issues.length > 0) {
      // Analyze workload distribution
      const workloadAnalysis = analyzeWorkloadDistribution(workloadResponse.data.issues, workloadParams);

      // Get user preferences for response style
      const memory = getConversationMemory(sessionId);
      const verbosityLevel = memory.userPreferences?.verbosityLevel || "medium";

      try {
        // Generate AI response
        const systemPrompt = `
          You are a helpful Jira assistant analyzing team workload distribution.
          
          Create a ${
            verbosityLevel === "concise"
              ? "brief and focused"
              : verbosityLevel === "detailed"
              ? "comprehensive and detailed"
              : "balanced and informative"
          } response about the team's current workload.
          
          ${
            verbosityLevel === "concise"
              ? "Focus only on the key metrics and most significant workload imbalances."
              : verbosityLevel === "detailed"
              ? "Provide detailed breakdowns of workload by person, with analysis of distribution and potential issues."
              : "Balance detail with clarity, highlighting important workload patterns."
          }
          
          ${
            workloadParams.focusPerson
              ? `Focus specifically on ${workloadParams.focusPerson}'s workload and tasks.`
              : "Highlight who has the most work, who has high priority items, and any imbalances."
          }
          
          Be helpful and insightful, not just listing raw data.
          Use markdown formatting, especially for organizing by team member.
          Highlight any concerning workload imbalances or overloaded team members.
        `;

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Team workload data: ${JSON.stringify(workloadAnalysis)}` },
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
            intent: "WORKLOAD",
            focusPerson: workloadParams.focusPerson,
            workloadDistribution: workloadAnalysis.distributionSummary,
          },
        });
      } catch (aiError) {
        console.error("Error generating AI workload analysis:", aiError);

        // Fallback to a structured format
        let formattedResponse = `## Team Workload Analysis\n\n`;

        if (workloadParams.focusPerson) {
          const personData = workloadAnalysis.assignees.find((a) => a.name.toLowerCase() === workloadParams.focusPerson.toLowerCase());

          if (personData) {
            formattedResponse += `### ${personData.name}'s Workload\n`;
            formattedResponse += `**Total tasks**: ${personData.taskCount}\n`;
            formattedResponse += `**High priority**: ${personData.highPriorityCount}\n`;

            if (personData.dueSoon > 0) {
              formattedResponse += `**Due soon**: ${personData.dueSoon} items due in the next 7 days\n`;
            }

            if (personData.overdue > 0) {
              formattedResponse += `**Overdue**: ${personData.overdue} items past due\n`;
            }

            formattedResponse += `\n**Current tasks**:\n`;
            personData.tasks.slice(0, 5).forEach((task) => {
              formattedResponse += `• ${task.key}: ${task.summary} (${task.status}, ${task.priority}${
                task.dueDate ? `, Due: ${task.dueDate}` : ""
              })\n`;
            });

            if (personData.tasks.length > 5) {
              formattedResponse += `... and ${personData.tasks.length - 5} more tasks\n`;
            }
          } else {
            formattedResponse += `No tasks found for ${workloadParams.focusPerson}.\n`;
          }
        } else {
          // Compare workloads
          formattedResponse += `**Total team workload**: ${workloadAnalysis.totalTasks} active tasks across ${workloadAnalysis.assignees.length} team members\n\n`;

          if (workloadAnalysis.unassignedCount > 0) {
            formattedResponse += `⚠️ There are ${workloadAnalysis.unassignedCount} unassigned tasks that need attention.\n\n`;
          }

          // Sort by workload (highest first)
          workloadAnalysis.assignees
            .sort((a, b) => b.taskCount - a.taskCount)
            .forEach((assignee) => {
              const workloadLevel =
                assignee.taskCount > 8 ? "**Heavily loaded**" : assignee.taskCount > 4 ? "Moderately loaded" : "Lightly loaded";

              formattedResponse += `### ${assignee.name} (${assignee.taskCount} tasks) - ${workloadLevel}\n`;

              if (assignee.highPriorityCount > 0) {
                formattedResponse += `${assignee.highPriorityCount} high priority tasks`;
                if (assignee.overdue > 0) {
                  formattedResponse += `, ${assignee.overdue} overdue`;
                }
                formattedResponse += `\n`;
              }

              // List a few example tasks
              formattedResponse += `\n**Example tasks**:\n`;
              assignee.tasks.slice(0, 3).forEach((task) => {
                formattedResponse += `• ${task.key}: ${task.summary} (${task.status}, ${task.priority})\n`;
              });

              if (assignee.tasks.length > 3) {
                formattedResponse += `... and ${assignee.tasks.length - 3} more tasks\n`;
              }

              formattedResponse += `\n`;
            });
        }

        // Store in conversation memory
        if (memory) {
          memory.lastResponse = formattedResponse;
        }

        return res.json({
          message: formattedResponse,
          meta: {
            intent: "WORKLOAD",
            focusPerson: workloadParams.focusPerson,
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

// Helper function to analyze workload distribution
export function analyzeWorkloadDistribution(issues, params) {
  // Group issues by assignee
  const issuesByAssignee = {};
  const now = new Date();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  issues.forEach((issue) => {
    const assignee = issue.fields.assignee?.displayName || "Unassigned";

    if (!issuesByAssignee[assignee]) {
      issuesByAssignee[assignee] = [];
    }

    issuesByAssignee[assignee].push(issue);
  });

  // Calculate workload metrics for each assignee
  const assigneeData = Object.entries(issuesByAssignee).map(([name, tasks]) => {
    const highPriorityCount = tasks.filter(
      (task) => task.fields.priority?.name === "Highest" || task.fields.priority?.name === "High"
    ).length;

    const dueSoon = tasks.filter(
      (task) => task.fields.duedate && new Date(task.fields.duedate) > now && new Date(task.fields.duedate) - now < oneWeek
    ).length;

    const overdue = tasks.filter(
      (task) => task.fields.duedate && new Date(task.fields.duedate) < now && task.fields.status.name !== "Done"
    ).length;

    // Get status breakdown
    const statusBreakdown = {};
    tasks.forEach((task) => {
      const status = task.fields.status?.name || "Unknown";
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });

    // Get type breakdown
    const typeBreakdown = {};
    tasks.forEach((task) => {
      const type = task.fields.issuetype?.name || "Unknown";
      typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
    });

    return {
      name,
      taskCount: tasks.length,
      highPriorityCount,
      dueSoon,
      overdue,
      statusBreakdown,
      typeBreakdown,
      tasks: tasks.map((task) => ({
        key: task.key,
        summary: task.fields.summary,
        status: task.fields.status?.name || "Unknown",
        priority: task.fields.priority?.name || "Unknown",
        dueDate: task.fields.duedate ? new Date(task.fields.duedate).toLocaleDateString() : null,
        isOverdue: task.fields.duedate && new Date(task.fields.duedate) < now && task.fields.status.name !== "Done",
        isDueSoon: task.fields.duedate && new Date(task.fields.duedate) > now && new Date(task.fields.duedate) - now < oneWeek,
      })),
    };
  });

  // Find team members with unusually high or low workloads
  const totalAssignees = assigneeData.filter((a) => a.name !== "Unassigned").length;
  const totalAssignedTasks = assigneeData.filter((a) => a.name !== "Unassigned").reduce((sum, a) => sum + a.taskCount, 0);

  const avgTasksPerPerson = totalAssignees > 0 ? totalAssignedTasks / totalAssignees : 0;

  // Identify overloaded and underloaded team members
  const overloadedMembers = assigneeData.filter((a) => a.name !== "Unassigned" && a.taskCount > avgTasksPerPerson * 1.5).map((a) => a.name);

  const underloadedMembers = assigneeData
    .filter((a) => a.name !== "Unassigned" && a.taskCount < avgTasksPerPerson * 0.5)
    .map((a) => a.name);

  // Get count of unassigned tasks
  const unassignedCount = issuesByAssignee["Unassigned"]?.length || 0;

  // Calculate overall workload distribution
  const maxWorkload = Math.max(...assigneeData.filter((a) => a.name !== "Unassigned").map((a) => a.taskCount));
  const minWorkload = Math.min(...assigneeData.filter((a) => a.name !== "Unassigned").map((a) => a.taskCount));
  const workloadGap = maxWorkload - minWorkload;

  // Evaluate workload distribution
  let distributionSummary = "balanced";
  if (workloadGap > avgTasksPerPerson) {
    distributionSummary = "highly unbalanced";
  } else if (workloadGap > avgTasksPerPerson / 2) {
    distributionSummary = "somewhat unbalanced";
  }

  return {
    totalTasks: issues.length,
    unassignedCount,
    assignees: assigneeData,
    overloadedMembers,
    underloadedMembers,
    avgTasksPerPerson,
    distributionSummary,
    maxWorkload,
    minWorkload,
    workloadGap,
  };
}