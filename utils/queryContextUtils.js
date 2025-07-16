import { openai } from "../config/openaiConfig.js";
import { createJiraLink } from "../utils/jiraUtils.js";
import { extractRecentIssues, extractRecentAssignees } from "./extractors";


export async function generateResponse(query, jiraData, intent, context = {}) {
  // Basic data checks
  if (!jiraData || !jiraData.issues) {
    return "I couldn't find any relevant information for your query.";
  }

  const issueCount = jiraData.issues.length;
  const totalCount = jiraData.total;

  // Handle empty results case specifically
  if (issueCount === 0) {
    const noResultsResponses = [
      "I couldn't find any issues matching your criteria. Would you like to try a different search?",
      "I looked, but didn't find any matching issues in Jira. Could you try rephrasing your question?",
      "No results found for that query. Maybe we could try a broader search?",
      "I don't see any issues that match what you're looking for. Let me know if you'd like to try a different approach.",
    ];
    return noResultsResponses[Math.floor(Math.random() * noResultsResponses.length)];
  }

  // Handle greeting and conversational intents specially
  if (intent === "GREETING") {
    const greetingResponses = [
      "Hi there! I'm your Jira assistant. I can help you with:\n\n• Finding tasks and issues\n• Checking project status\n• Understanding who's working on what\n• Tracking blockers and high-priority items\n• Monitoring deadlines and timelines\n\nJust ask me a question about your Jira project!",
      "Hello! I'm here to help you navigate your Jira project. You can ask me about:\n\n• Open and closed tasks\n• Task assignments and ownership\n• Project timelines and deadlines\n• High priority issues and blockers\n• Recent updates and changes\n\nWhat would you like to know about your project today?",
      'Hey! I\'m your Jira chatbot assistant. Some things you can ask me:\n\n• "What\'s the status of our project?"\n• "Show me open bugs assigned to Sarah"\n• "Any blockers in the current sprint?"\n• "Tell me about NIHK-123"\n• "What\'s due this week?"\n\nHow can I help you today?',
    ];
    return greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
  }

  if (intent === "CONVERSATION") {
    // Pull out recent project activity for conversational context
    const recentActivity = jiraData.issues.slice(0, 3).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || "Unknown",
    }));

    const conversationPrompt = `
      You are a friendly Jira assistant chatting with a user. The user has said: "${query}"
      
      This appears to be a conversational follow-up rather than a direct query about Jira data.
      
      Some recent activity in the project includes:
      ${recentActivity.map((i) => `- ${i.key}: ${i.summary} (${i.status})`).join("\n")}
      
      Respond in a friendly, helpful way. If they're asking for more information or clarification,
      offer to help them by suggesting specific types of queries they could ask. If they're
      expressing appreciation, acknowledge it warmly and ask if they need anything else.
      
      Don't fabricate Jira data that wasn't provided. Make your response conversational and natural.
    `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: conversationPrompt },
          { role: "user", content: query },
        ],
        temperature: 0.7,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error("Error generating conversational response:", error);
      return "I'm here to help with your Jira queries. What would you like to know about your project?";
    }
  }

  try {
    // Create a more varied and context-aware system prompt based on intent
    let systemPrompt = `
      You are a helpful, friendly Jira project assistant providing information in a conversational, natural tone.
      
      Format requirements for the frontend:
      - Use markdown formatting that works with the frontend:
        - ## for main headers (issue keys)
        - ### for section headers
        - **bold** for field names and important information
        - • or - for bullet points
        - Line breaks to separate sections
    `;

    // Add intent-specific guidance
    if (intent === "PROJECT_STATUS") {
      systemPrompt += `
        For PROJECT_STATUS intent:
        - Begin with a conversational summary of the project's current state
        - Highlight key metrics (open issues, in progress, completed)
        - Mention any critical or high priority items
        - Add insights about progress and bottlenecks
        - Organize information in a clear, scannable way
        - ALWAYS include specific numbers and counts
      `;
    } else if (intent === "TASK_LIST") {
      systemPrompt += `
        For TASK_LIST intent:
        - Start with a brief overview of the results ("I found X tasks...")
        - Group tasks logically (by status, priority, etc.)
        - For each task, include the key, summary, status and assignee
        - Limit to showing 5-7 tasks with a note about the rest
        - Add a brief insight about the tasks if possible
        - ALWAYS include the total count, group them by status or priority if applicable
        - If user asks for more details, suggest they ask about a specific task key
        - If user asks for a count of tasks (specific or overall), provide that count clearly
      `;
    } else if (intent === "ASSIGNED_TASKS") {
      systemPrompt += `
        For ASSIGNED_TASKS intent:
        - Group tasks by assignee in a clear structure
        - For each person, list 2-3 of their most important tasks
        - Include task key, summary and status
        - Add a brief comment about each person's workload
        - Highlight any potential overloading or imbalances
        - Be specific about counts and distribution
      `;
    } else if (intent === "TASK_DETAILS") {
      systemPrompt += `
        For TASK_DETAILS intent:
        - Use a clear header with the issue key and summary
        - In the header, format the issue key as a clickable markdown link like [IHKA-123](https://asioso.atlassian.net/browse/IHKA-123)
        - Organize details into logical sections
        - Include all important fields (status, priority, assignee, dates)
        - Format description and comments for readability
        - Highlight the most recent or important information
        - NEVER omit important information
        - Use [IHKA-123](https://asioso.atlassian.net/browse/IHKA-123) format to make Jira issue keys clickable
      `;
    } else if (intent === "BLOCKERS") {
      systemPrompt += `
        For BLOCKERS intent:
        - Use slightly urgent language appropriate for blockers
        - Clearly identify the most critical issues first
        - For each blocker, include who it's assigned to and its status
        - Group by priority if there are multiple blockers
        - Suggest possible next steps if appropriate
        - Be precise about what's blocking and why
      `;
    } else if (intent === "TIMELINE") {
      systemPrompt += `
        For TIMELINE intent:
        - Organize items chronologically
        - Group by timeframe (this week, next week, this month)
        - Highlight upcoming deadlines
        - Include due dates, current status, and assignees
        - Add context about timing and priorities
        - If tasks are overdue, clearly mark them as such
      `;
    } else if (intent === "COMMENTS") {
      systemPrompt += `
        For COMMENTS intent:
        - Show the most recent comments first
        - Include the author and date for each comment
        - Format the comment text for readability
        - Provide context around what the comment is referring to
        - Highlight important points from the comments
      `;
    } else if (intent === "WORKLOAD") {
      systemPrompt += `
        For WORKLOAD intent:
        - Compare team members' workloads
        - Show who has the most and least tasks
        - Highlight who has high priority items
        - Note any potential overloading
        - Suggest workload balancing if needed
      `;
    } else if (intent === "SPRINT") {
      systemPrompt += `
        For SPRINT intent:
        - Provide an overview of the current sprint status
        - Group issues by status (to do, in progress, done)
        - Highlight progress (% complete, days remaining)
        - Note any blockers or at-risk items
        - Keep the tone conversational and insightful
      `;
    } else if (intent === "ISSUE_TYPES") {
      systemPrompt += `
        For ISSUE_TYPES intent:
        - Begin with a clear statement about the work types (issue types) in the project
        - List each type with its count and percentage of total issues
        - Keep explanations concise and focused on the official types
        - Mention that these are the official work/issue types defined in the project
        - Always include counts and percentages
      `;
    }

    systemPrompt += `
      General guidelines:
      - Maintain a conversational, helpful tone throughout
      - Begin with a direct response to their query, then provide supporting details
      - Keep lists concise - show 5 items max and summarize the rest if there are more
      - Show Jira issue keys in their original format (${process.env.JIRA_PROJECT_KEY}-123) 
      - Vary your language patterns and openings to sound natural
      - Add relevant insights beyond just listing data
      - Include specific counts and metrics when available
      - Adjust your tone based on the urgency/priority of the issues
      - Never mention JQL or technical implementation details
      - End with a brief, helpful question or suggestion if appropriate

      The query intent is: ${intent}
      The user asked: "${query}"
    `;

    // Prepare a condensed version of the Jira data
    const condensedIssues = jiraData.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || "Unknown",
      priority: issue.fields.priority?.name || "Unknown",
      assignee: issue.fields.assignee?.displayName || "Unassigned",
      created: issue.fields.created,
      updated: issue.fields.updated,
      dueDate: issue.fields.duedate || "No due date",
      comments:
        issue.fields.comment?.comments?.length > 0
          ? {
              count: issue.fields.comment.comments.length,
              latest: {
                author: issue.fields.comment.comments[issue.fields.comment.comments.length - 1].author?.displayName || "Unknown",
                created: issue.fields.comment.comments[issue.fields.comment.comments.length - 1].created,
                body:
                  typeof issue.fields.comment.comments[issue.fields.comment.comments.length - 1].body === "string"
                    ? issue.fields.comment.comments[issue.fields.comment.comments.length - 1].body.substring(0, 150) + "..."
                    : "Complex formatted comment",
              },
            }
          : null,
      description: issue.fields.description ? "Has description" : "No description",
      issuetype: issue.fields.issuetype?.name || "Unknown",
    }));

    // Add analysis of the query and data to provide context
    const queryAnalysis = {
      seemsUrgent: /urgent|asap|immediately|critical|blocker/i.test(query),
      mentionsTime: /due date|deadline|when|timeline|schedule|milestone/i.test(query),
      mentionsPerson: /assigned to|working on|responsible for/i.test(query),
      isSpecific: /specific|exactly|precisely|only/i.test(query),
      requestsCount: /how many|count|number of/i.test(query),
    };

    // Calculate basic statistics to enrich the response
    const statistics = {
      statusBreakdown: condensedIssues.reduce((acc, issue) => {
        acc[issue.status] = (acc[issue.status] || 0) + 1;
        return acc;
      }, {}),
      priorityBreakdown: condensedIssues.reduce((acc, issue) => {
        acc[issue.priority] = (acc[issue.priority] || 0) + 1;
        return acc;
      }, {}),
      assigneeBreakdown: condensedIssues.reduce((acc, issue) => {
        const assignee = issue.assignee || "Unassigned";
        acc[assignee] = (acc[assignee] || 0) + 1;
        return acc;
      }, {}),
    };

    // Add conversation context if available
    const conversationContext = context.previousQueries
      ? {
          previousQueries: context.previousQueries.slice(-3),
          previousIntents: context.previousIntents?.slice(-3),
          lastResponse: context.lastResponse,
          // Track the specific issues, assignees, or topics from previous messages
          recentMentionedIssues: extractRecentIssues(context.previousQueries),
          recentMentionedAssignees: extractRecentAssignees(context.previousQueries),
        }
      : {};

    const contextData = {
      query,
      total: jiraData.total,
      shownCount: condensedIssues.length,
      issues: condensedIssues,
      queryAnalysis,
      statistics,
      ...conversationContext,
    };

    // Adjust temperature based on intent
    let temperature = 0.7; // Default
    if (intent === "TASK_DETAILS" || intent === "PROJECT_STATUS") {
      temperature = 0.4; // Lower for factual responses
    } else if (intent === "CONVERSATION" || intent === "GREETING") {
      temperature = 0.8; // Higher for conversational responses
    }

    // Use a higher temperature for more varied responses
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Query: "${query}"\nJira data: ${JSON.stringify(contextData)}\n\nGenerate a helpful, conversational response.`,
        },
      ],
      temperature: temperature,
      max_tokens: 800, // Ensure we get a full, detailed response
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error generating response:", error);

    // Intent-specific fallback responses
    // This ensures that even if AI fails, we provide a relevant, helpful response

    if (intent === "PROJECT_STATUS") {
      let response = `## Project Status Overview\n\n`;

      // Calculate basic statistics
      const statusCounts = {};
      jiraData.issues.forEach((issue) => {
        const status = issue.fields.status?.name || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      // Add status breakdown
      response += `Here's the current status of the project:\n\n`;
      for (const [status, count] of Object.entries(statusCounts)) {
        response += `• **${status}**: ${count} issues\n`;
      }

      // Add recent activity
      response += `\n### Recent Activity\n`;
      for (let i = 0; i < Math.min(3, issueCount); i++) {
        const issue = jiraData.issues[i];
        const status = issue.fields.status?.name || "Unknown";
        response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status})\n`;
      }

      return response;
    }

    if (intent === "TIMELINE") {
      let response = `## Project Timeline\n\n`;

      // Group by due date (month)
      const issuesByMonth = {};
      jiraData.issues.forEach((issue) => {
        if (!issue.fields.duedate) return;

        const dueDate = new Date(issue.fields.duedate);
        const month = dueDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

        if (!issuesByMonth[month]) {
          issuesByMonth[month] = [];
        }

        issuesByMonth[month].push(issue);
      });

      // Format timeline
      if (Object.keys(issuesByMonth).length === 0) {
        response += "I didn't find any issues with due dates in the timeline.";
      } else {
        for (const [month, issues] of Object.entries(issuesByMonth)) {
          response += `### ${month}\n`;

          issues.forEach((issue) => {
            const status = issue.fields.status?.name || "Unknown";
            const dueDate = new Date(issue.fields.duedate).toLocaleDateString();
            response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (Due: ${dueDate}, ${status})\n`;
          });

          response += "\n";
        }
      }

      

      return response;
    }

    if (intent === "BLOCKERS" || intent === "HIGH_PRIORITY") {
      let response = `## Key Issues Requiring Attention\n\n`;

      const priorityCounts = {};
      jiraData.issues.forEach((issue) => {
        const priority = issue.fields.priority?.name || "Unknown";
        priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
      });

      response += `I found ${issueCount} issues that need attention:\n\n`;

      // Group by priority
      jiraData.issues.forEach((issue) => {
        const priority = issue.fields.priority?.name || "Unknown";
        const status = issue.fields.status?.name || "Unknown";
        const assignee = issue.fields.assignee?.displayName || "Unassigned";

        response += `• **${createJiraLink(issue.key)}**: ${issue.fields.summary} (${priority}, ${status}, Assigned to: ${assignee})\n`;
      });

      return response;
    }

    if (intent === "ASSIGNED_TASKS" || intent === "WORKLOAD") {
      let response = `## Team Workload\n\n`;

      if (jiraData.jql) {
        const jiraFilterLink = createJiraFilterLink(jiraData.jql);
        response += `\n\n[🡕 View these tasks in Jira](${jiraFilterLink})`;
      }

      // Group by assignee
      const issuesByAssignee = {};
      jiraData.issues.forEach((issue) => {
        const assignee = issue.fields.assignee?.displayName || "Unassigned";

        if (!issuesByAssignee[assignee]) {
          issuesByAssignee[assignee] = [];
        }

        issuesByAssignee[assignee].push(issue);
      });

      // Format by assignee
      for (const [assignee, issues] of Object.entries(issuesByAssignee)) {
        response += `### ${assignee} (${issues.length} issues)\n`;

        issues.slice(0, 3).forEach((issue) => {
          const status = issue.fields.status?.name || "Unknown";
          response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (${status})\n`;
        });

        if (issues.length > 3) {
          response += `... and ${issues.length - 3} more issues.\n`;
        }

        response += "\n";
      }



      return response;
    }

    if (intent === "TASK_DETAILS" && jiraData.issues.length > 0) {
      const issue = jiraData.issues[0];
      const status = issue.fields.status?.name || "Unknown";
      const assignee = issue.fields.assignee?.displayName || "Unassigned";
      const summary = issue.fields.summary || "No summary";
      const priority = issue.fields.priority?.name || "Not set";
      const created = new Date(issue.fields.created).toLocaleDateString();
      const updated = new Date(issue.fields.updated).toLocaleDateString();

      const response =
        `## ${createJiraLink(issue.key)}: ${summary}\n\n` +
        `**Status**: ${status}\n` +
        `**Priority**: ${priority}\n` +
        `**Assignee**: ${assignee}\n` +
        `**Created**: ${created}\n` +
        `**Last Updated**: ${updated}\n\n`;

      return response;
    }

    // Default fallback for other intents
    // Group by status for better organization
    const issuesByStatus = {};
    jiraData.issues.forEach((issue) => {
      const status = issue.fields.status?.name || "Unknown";
      if (!issuesByStatus[status]) {
        issuesByStatus[status] = [];
      }
      issuesByStatus[status].push(issue);
    });

    // Choose a varied opening phrase
    const openingPhrases = [
      `I found ${issueCount} issues related to your query.`,
      `There are ${issueCount} issues that match what you're looking for.`,
      `Your search returned ${issueCount} issues.`,
      `I've located ${issueCount} relevant issues in the project.`,
      `Looking at your query, I found ${issueCount} matching issues.`,
    ];

    let response = openingPhrases[Math.floor(Math.random() * openingPhrases.length)];
    if (totalCount > issueCount) {
      response += ` (Out of ${totalCount} total in the project)`;
    }
    response += `\n\n`;

    // Format in a more readable way
    for (const [status, issues] of Object.entries(issuesByStatus)) {
      response += `**${status}**:\n`;
      issues.forEach((issue) => {
        const assignee = issue.fields.assignee?.displayName || "Unassigned";
        response += `• ${createJiraLink(issue.key)}: ${issue.fields.summary} (Assigned to: ${assignee})\n`;
      });
      response += "\n";
    }

    // Varied closing prompts
    const closingPrompts = [
      "Is there a specific issue you'd like to know more about?",
      "Would you like details about any of these issues?",
      "Let me know if you need more information on any particular issue.",
      "I can tell you more about any of these issues if you're interested.",
      "Would you like to dive deeper into any of these?",
    ];

    response += closingPrompts[Math.floor(Math.random() * closingPrompts.length)];

    return response;
  }
}