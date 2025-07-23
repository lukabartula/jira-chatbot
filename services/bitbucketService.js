import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
// BITBUCKET FUNCTIONALITY START
const BITBUCKET_URL = process.env.BITBUCKET_URL || "https://api.bitbucket.org/2.0";
const BITBUCKET_WORKSPACE = process.env.BITBUCKET_WORKSPACE;
const BITBUCKET_REPO = process.env.BITBUCKET_REPO;
const JIRA_URL = process.env.JIRA_URL || "https://asioso.atlassian.net";

const bitbucketAuth = {
  username: process.env.BITBUCKET_USER,
  password: process.env.BITBUCKET_APP_PASSWORD,
};
// Helper function to make Bitbucket API requests
export async function callBitbucketApi(endpoint, params = {}) {
  try {
    // Determine the full URL based on if endpoint is already a full URL
    const url = endpoint.startsWith("http") ? endpoint : `${BITBUCKET_URL}${endpoint}`;

    const response = await axios.get(url, {
      params,
      auth: BITBUCKET_API_TOKEN,
      headers: {
        Accept: "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Error calling Bitbucket API (${endpoint}):`, error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    }
    throw error;
  }
}

// Function to get repository information
export async function getBitbucketRepos() {
  try {
    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      return await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}`);
    }
    // For Bitbucket Server
    else {
      return await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos`);
    }
  } catch (error) {
    console.error("Error fetching Bitbucket repositories:", error);
    throw error;
  }
}

// Function to get commits for a repository
export async function getBitbucketCommits(repository, limit = 10) {
  try {
    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      return await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/commits`, {
        limit,
      });
    }
    // For Bitbucket Server
    else {
      return await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/commits`, {
        limit,
      });
    }
  } catch (error) {
    console.error(`Error fetching commits for ${repository}:`, error);
    throw error;
  }
}

// Function to get pull requests for a repository
export async function getBitbucketPullRequests(repository, state = "OPEN", limit = 10) {
  try {
    console.log(`Fetching ${state} pull requests for ${repository}...`);

    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      // Ensure lowercase state for Bitbucket Cloud API
      const cloudState = state.toLowerCase();

      // First try with state parameter (should work for Cloud)
      let response = await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/pullrequests`, {
        state: cloudState,
        limit: limit * 2, // Fetch more to allow for filtering
      });

      // Log the raw response for debugging
      console.log(`Received ${response.values?.length || 0} pull requests from API`);

      // Verify that returned PRs actually match the requested state by checking the state field directly
      if (response.values && response.values.length > 0) {
        // Filter PRs to ensure they really are in the requested state
        const filteredPRs = response.values.filter((pr) => {
          // For OPEN state, check if it's neither MERGED nor DECLINED/CLOSED
          if (state.toUpperCase() === "OPEN") {
            return pr.state && pr.state.toLowerCase() === "open";
          }
          // For MERGED state
          else if (state.toUpperCase() === "MERGED") {
            return pr.state && pr.state.toLowerCase() === "merged";
          }
          // For DECLINED state
          else if (state.toUpperCase() === "DECLINED") {
            return pr.state && pr.state.toLowerCase() === "declined";
          }
          // For any other state, match exactly
          return pr.state && pr.state.toLowerCase() === cloudState;
        });

        console.log(`Filtered to ${filteredPRs.length} pull requests that are truly in ${state} state`);

        // Return the filtered results
        return {
          ...response,
          values: filteredPRs.slice(0, limit), // Apply the original limit to filtered results
        };
      }

      return response;
    }
    // For Bitbucket Server
    else {
      // Map states to Bitbucket Server state values
      let serverState = state.toUpperCase();
      if (serverState === "OPEN") {
        serverState = "OPEN";
      } else if (serverState === "MERGED") {
        serverState = "MERGED";
      } else if (serverState === "DECLINED") {
        serverState = "DECLINED";
      }

      let response = await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/pull-requests`, {
        state: serverState,
        limit: limit * 2,
      });

      // Log the raw response for debugging
      console.log(`Received ${response.values?.length || 0} pull requests from API`);

      // Verify pulled PRs actually match the requested state (if fields available)
      if (response.values && response.values.length > 0) {
        const filteredPRs = response.values.filter((pr) => {
          // For Bitbucket Server, the structure might be different
          // Look for status property that should indicate the PR state
          if (state.toUpperCase() === "OPEN") {
            return (!pr.closed && !pr.merged) || pr.state === "OPEN" || pr.status === "OPEN";
          } else if (state.toUpperCase() === "MERGED") {
            return pr.merged || pr.state === "MERGED" || pr.status === "MERGED";
          } else if (state.toUpperCase() === "DECLINED") {
            return pr.closed || pr.state === "DECLINED" || pr.status === "DECLINED";
          }
          return true; // If we can't determine state, include it
        });

        console.log(`Filtered to ${filteredPRs.length} pull requests that are truly in ${state} state`);

        // Return the filtered results
        return {
          ...response,
          values: filteredPRs.slice(0, limit),
        };
      }

      return response;
    }
  } catch (error) {
    console.error(`Error fetching pull requests for ${repository}:`, error);
    throw error;
  }
}

// Function to get branches for a repository
export async function getBitbucketBranches(repository, limit = 10) {
  try {
    // For Bitbucket Cloud
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      return await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/refs/branches`, {
        limit,
      });
    }
    // For Bitbucket Server
    else {
      return await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/branches`, {
        limit,
      });
    }
  } catch (error) {
    console.error(`Error fetching branches for ${repository}:`, error);
    throw error;
  }
}

// Function to get code changes related to a Jira issue
export async function getCodeChangesForJiraIssue(issueKey, limit = 10) {
  try {
    // This implementation will vary based on how your Jira and Bitbucket are integrated
    // Option 1: If using Bitbucket Cloud with Jira Cloud integration
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      // Use the Jira development information API
      const jiraDevelopmentInfo = await axios.get(`${JIRA_URL}/rest/dev-status/1.0/issue/detail`, {
        params: {
          issueId: issueKey,
          applicationType: "bitbucket",
          dataType: "repository",
        },
        auth,
      });

      return jiraDevelopmentInfo.data;
    }
    // Option 2: Using commit message search (fallback method)
    else {
      // For simplicity, we'll check all repositories in the workspace
      const repos = await getBitbucketRepos();
      const repoList = repos.values || [];

      const results = [];

      // For each repo, search for commits mentioning the issue key
      for (const repo of repoList.slice(0, 5)) {
        // Limit to 5 repos to avoid overloading
        const repoName = repo.name || repo.slug;
        try {
          // Note: This is a simple implementation - more sophisticated would use actual Bitbucket API search
          const commits = await getBitbucketCommits(repoName, 100);

          // Filter commits that mention the issue key
          const relatedCommits = (commits.values || []).filter((commit) => commit.message && commit.message.includes(issueKey));

          if (relatedCommits.length > 0) {
            results.push({
              repository: repoName,
              commits: relatedCommits.slice(0, limit),
            });
          }
        } catch (error) {
          console.error(`Error searching commits in ${repoName}:`, error);
          // Continue with other repos even if one fails
        }
      }

      return { repositories: results };
    }
  } catch (error) {
    console.error(`Error finding code changes for Jira issue ${issueKey}:`, error);
    throw error;
  }
}

// Test function to verify Bitbucket connectivity
export async function testBitbucketConnection() {
  try {
    console.log("Testing Bitbucket connection...");
    const repos = await getBitbucketRepos();
    console.log(`Successfully connected to Bitbucket! Found ${repos.size || repos.values?.length || 0} repositories.`);
    return true;
  } catch (error) {
    console.error("Failed to connect to Bitbucket:", error);
    return false;
  }
}

// Call the test function when server starts
testBitbucketConnection().then((success) => {
  if (success) {
    console.log("Bitbucket integration is ready.");
  } else {
    console.log("Bitbucket integration is not available. The chatbot will continue to work with Jira only.");
  }
});

// Intent detection for Bitbucket queries
export async function detectBitbucketIntent(query) {
  // Lowercase and normalize the query for easier matching
  const lowercaseQuery = query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/[.,;?!]/g, ""); // Remove punctuation

  console.log(`Processing query for Bitbucket intent: "${lowercaseQuery}"`);

  // List of Bitbucket-specific keywords to help identify Bitbucket queries
  const bitbucketKeywords = [
    "repo",
    "repository",
    "repositories",
    "bitbucket",
    "git",
    "commit",
    "commits",
    "branch",
    "branches",
    "pull request",
    "pr",
    "prs",
    "merge",
    "source",
    "code",
    "clone",
    "push",
    "main",
    "master",
    "develop",
    "dev",
  ];

  // Quick test - if the query contains Bitbucket keywords, it's more likely to be a Bitbucket query
  const containsBitbucketKeywords = bitbucketKeywords.some((keyword) => lowercaseQuery.includes(keyword));

  // If there are clearly no Bitbucket keywords, return null early
  if (!containsBitbucketKeywords && !/(code|changes|repository)/i.test(lowercaseQuery)) {
    // Early rejection for clearly Jira-focused queries
    if (/project status|status of (the )?project|how is the project|project health|project progress/i.test(lowercaseQuery)) {
      console.log("Clearly a project status query - not Bitbucket related");
      return null;
    }
    return null;
  }

  // LATEST COMMIT DETECTION
  if (
      /\b(commit)\b.*\b(last|latest|newest|recent)\b/i.test(lowercaseQuery) ||
      /\b(last|latest|newest|recent)\b.*\bcommit\b/i.test(lowercaseQuery)
    ) {
      // Extract branch and repo if specified, else use defaults
      const branchMatch =
        lowercaseQuery.match(/on ([\w/-]+)/i) ||
        lowercaseQuery.match(/for ([\w/-]+)/i) ||
        lowercaseQuery.match(/in ([\w/-]+)/i) ||
        lowercaseQuery.match(/to ([\w/-]+)/i);
      const branch = branchMatch ? branchMatch[1] : "master";
      const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
      const repoMatch = query.match(repoPattern);
      const repoName = repoMatch ? repoMatch[1] : BITBUCKET_REPO;

      return {
        intent: "BITBUCKET_LATEST_COMMIT",
        branch,
        repository: repoName,
      };
    }

  // BRANCH COMMITS DETECTION
  // Improved patterns for branch commit queries
  if (
    /(last|latest|recent|newest|what was|what is|what are|what were|show|list|get|find)\s+.*\s+(commit|commits)(\s+on|\s+to|\s+in|\s+for)?\s+(the\s+)?([\w\/-]+)(\s+branch)?/i.test(
      lowercaseQuery
    ) ||
    /(commit|commits)(\s+on|\s+to|\s+in|\s+for)\s+(the\s+)?([\w\/-]+)(\s+branch)?/i.test(lowercaseQuery) ||
    /(branch|on branch)\s+([\w\/-]+).*\s+(commit|commits)/i.test(lowercaseQuery)
  ) {
    // Extract the branch name using multiple patterns
    let branchMatch =
      lowercaseQuery.match(/(commit|commits)(?:\s+on|\s+to|\s+in|\s+for)\s+(?:the\s+)?([\w\/-]+)(?:\s+branch)?/i) ||
      lowercaseQuery.match(
        /(?:last|latest|recent|newest|what was|what is|what are|what were|show|list|get|find)\s+.*\s+(?:commit|commits)(?:\s+on|\s+to|\s+in|\s+for)?\s+(?:the\s+)?([\w\/-]+)(?:\s+branch)?/i
      ) ||
      lowercaseQuery.match(/(?:branch|on branch)\s+([\w\/-]+).*\s+(?:commit|commits)/i);

    let branchName = null;
    if (branchMatch) {
      branchName = branchMatch[branchMatch.length - 1]; // Take the last capture group which should be the branch name
    }

    // If we can't identify a clear branch name, default to "master" or "main"
    if (!branchName && /(last|latest|recent) commit/i.test(lowercaseQuery)) {
      branchName = "master"; // Default to master if just asking about latest commit
    }

    // Extract repository name if specified
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);
    const repoName = repoMatch ? repoMatch[1] : null;

    console.log(`Detected branch commit query - Branch: ${branchName}, Repository: ${repoName || "default"}`);

    return {
      intent: "BITBUCKET_BRANCH_COMMITS",
      branch: branchName,
      repository: repoName || BITBUCKET_REPO,
    };
  }

  // REPOSITORY LISTING DETECTION
  // Match various ways of asking about repositories
  if (
    /(?:list|show|display|get|find|what|which)(?:\s+me)?(?:\s+all|\s+the)?\s+(?:repos|repositories)/i.test(lowercaseQuery) ||
    /(?:repos|repositories)(?:\s+do we have|\s+are there|\s+exist|\s+available|\s+in bitbucket)/i.test(lowercaseQuery) ||
    /(?:how many|are there any|do we have any)(?:\s+repos|repositories)/i.test(lowercaseQuery) ||
    /(?:bitbucket|git)\s+(?:repos|repositories)/i.test(lowercaseQuery) ||
    (/(repos|repositories)/.test(lowercaseQuery) && !/(jira|comment|project status)/.test(lowercaseQuery))
  ) {
    return "BITBUCKET_REPOS";
  }

  // GENERAL COMMITS DETECTION
  // Enhanced patterns for commit queries
  if (
    /(?:recent|latest|last|newest|what was|what is|what were|latest)\s+(?:commits)/i.test(lowercaseQuery) ||
    /(?:show|list|find|get)(?:\s+me)?(?:\s+the)?(?:\s+recent|\s+latest|\s+last)?\s+commits/i.test(lowercaseQuery) ||
    /(?:commit history|history of commits|commit log|git log)/i.test(lowercaseQuery) ||
    /(?:what|when)(?:\s+commits|changes)(?:\s+were made|\s+happened|\s+occurred)/i.test(lowercaseQuery) ||
    (/commit/.test(lowercaseQuery) && !/jira|task|issue|project status/.test(lowercaseQuery))
  ) {
    // Check for repository specification
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);

    if (repoMatch) {
      return {
        intent: "BITBUCKET_COMMITS",
        repository: repoMatch[1],
      };
    }

    return "BITBUCKET_COMMITS";
  }

  // BRANCHES DETECTION
  // Enhanced patterns for branch queries
  if (
    /(?:list|show|display|get|find|what|which)(?:\s+me)?(?:\s+all|\s+the)?\s+branches/i.test(lowercaseQuery) ||
    /(?:branches)(?:\s+do we have|\s+are there|\s+exist|\s+available)/i.test(lowercaseQuery) ||
    /(?:how many|are there any|do we have any)(?:\s+branches)/i.test(lowercaseQuery) ||
    /(?:branch list|branch information|branch details|available branches)/i.test(lowercaseQuery) ||
    (/(branch|branches)/.test(lowercaseQuery) && !/(jira|issue|task|project status)/.test(lowercaseQuery))
  ) {
    // Check for repository specification
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);

    if (repoMatch) {
      return {
        intent: "BITBUCKET_BRANCHES",
        repository: repoMatch[1],
      };
    }

    return "BITBUCKET_BRANCHES";
  }

  // PULL REQUEST DETECTION - MORE PRECISE PATTERNS
  // Enhanced patterns for pull request queries with stricter matching
  if (
    // Must explicitly mention "pull request" or "PR" and have clear intent indicators
    // Specific phrases about pull requests
    (/(?:open|active|current|all|any|new|closed|merged|recent|latest)\s+(?:pull requests?|prs?)/i.test(lowercaseQuery) ||
      /(?:show|list|display|get|find)(?:\s+me)?(?:\s+the|\s+all)?(?:\s+open|\s+active|\s+current|\s+all|\s+any|\s+new|\s+closed|\s+merged|\s+recent|\s+latest)?\s+(?:pull requests?|prs?)/i.test(
        lowercaseQuery
      ) ||
      /(?:do we have|are there|exist|are there any|is there|have|has)(?:\s+any|\s+open|\s+active|\s+current|\s+all|\s+new|\s+closed|\s+merged|\s+recent|\s+latest)?\s+(?:pull requests?|prs?)/i.test(
        lowercaseQuery
      )) &&
    // Exclude ambiguous project status queries
    !/(?:project status|status of project|project health|project progress)/i.test(lowercaseQuery)
  ) {
    // Determine PR state if specified
    let prState = "OPEN"; // Default to open
    if (/closed|completed|done|finished|resolved|merged/i.test(lowercaseQuery)) {
      prState = "MERGED"; // Assuming closed typically means merged in Git context
    } else if (/declined|rejected|canceled/i.test(lowercaseQuery)) {
      prState = "DECLINED";
    }

    // Check for repository specification
    const repoPattern = new RegExp(`(?:in|for|from)\\s+(?:the\\s+)?(?:repo(?:sitory)?\\s+)?([\\w-]+)`, "i");
    const repoMatch = query.match(repoPattern);

    if (repoMatch) {
      return {
        intent: "BITBUCKET_PULL_REQUESTS",
        repository: repoMatch[1],
        state: prState,
      };
    }

    return {
      intent: "BITBUCKET_PULL_REQUESTS",
      state: prState,
    };
  }

  // REPOSITORY INFO DETECTION
  // Enhanced patterns for repository info queries
  if (
    /(?:tell|info|about|details|show|describe|what is|what's)(?:\s+me)?\s+(?:about|on)?\s+(?:repo(?:sitory)?|project)\s+([a-zA-Z0-9_-]+)/i.test(
      lowercaseQuery
    ) ||
    /(?:repo(?:sitory)?|project)\s+([a-zA-Z0-9_-]+)(?:\s+info|details|status|overview)/i.test(lowercaseQuery)
  ) {
    // Extract repository name
    const repoMatch = query.match(/(?:repo(?:sitory)?|project)\s+([a-zA-Z0-9_-]+)/i);
    const repoName = repoMatch ? repoMatch[1] : null;

    if (repoName) {
      return {
        intent: "BITBUCKET_REPO_INFO",
        repository: repoName,
      };
    }
  }

  // JIRA ISSUE CODE CHANGES DETECTION
  // Enhanced patterns for code changes related to Jira issues
  const issueKeyPattern = new RegExp(`${process.env.JIRA_PROJECT_KEY}-\\d+`, "i");
  const issueMatch = query.match(issueKeyPattern);

  if (issueMatch && /(?:code|commit|push|change|changes|modification|update|related to|associated with|linked to)/i.test(lowercaseQuery)) {
    return {
      intent: "BITBUCKET_ISSUE_CODE",
      issueKey: issueMatch[0],
    };
  }

  // REPOSITORY SEARCH
  // If query mentions a specific repository but intent is unclear
  const generalRepoPattern = new RegExp(`(?:in|for|from|about)\\s+(?:the\\s+)?repo(?:sitory)?\\s+([\\w-]+)`, "i");
  const generalRepoMatch = query.match(generalRepoPattern);

  if (generalRepoMatch && containsBitbucketKeywords) {
    return {
      intent: "BITBUCKET_REPO_INFO",
      repository: generalRepoMatch[1],
    };
  }

  // If no specific Bitbucket intent is detected, return null
  // This will allow the query to be processed by the Jira intent detection
  return null;
}

// Main handler for Bitbucket queries
export async function handleBitbucketQuery(query, intent, meta = {}) {
  try {
    console.log(`Handling Bitbucket query with intent: ${intent}`);
    console.log("Meta data:", meta);

    // If default repo is not set, but needed for the query
    const needsRepo = ["BITBUCKET_COMMITS", "BITBUCKET_BRANCHES", "BITBUCKET_PULL_REQUESTS", "BITBUCKET_BRANCH_COMMITS"].includes(intent);

    if (needsRepo && !meta.repository && !BITBUCKET_REPO) {
      // No repository specified and no default - ask user to specify
      return `I need to know which repository you're asking about. Please specify a repository name in your query, for example: "Show ${intent
        .toLowerCase()
        .replace("bitbucket_", "")} in my-repository"`;
    }

    // Handle different Bitbucket intents
    switch (intent) {
      case "BITBUCKET_REPOS":
        return await handleRepositoriesQuery();

      case "BITBUCKET_COMMITS":
        const repository = meta.repository || BITBUCKET_REPO;
        return await handleCommitsQuery(repository, meta.limit);

      case "BITBUCKET_BRANCH_COMMITS":
        const repo = meta.repository || BITBUCKET_REPO;
        const branch = meta.branch || "master";
        return await handleBranchCommitsQuery(repo, branch);

      case "BITBUCKET_LATEST_COMMIT":
      const repoLatest = meta.repository || BITBUCKET_REPO;
      const branchLatest = meta.branch || "master";
      return await handleBranchCommitsQuery(repoLatest, branchLatest, "latestOnly");

      case "BITBUCKET_BRANCHES":
        const branchRepo = meta.repository || BITBUCKET_REPO;
        return await handleBranchesQuery(branchRepo);

      case "BITBUCKET_PULL_REQUESTS":
        const prRepo = meta.repository || BITBUCKET_REPO;
        const state = meta.state || "OPEN";
        return await handlePullRequestsQuery(prRepo, state);

      case "BITBUCKET_REPO_INFO":
        if (!meta.repository && !BITBUCKET_REPO) {
          return "Please specify which repository you want information about.";
        }
        return await handleRepositoryInfoQuery(meta.repository || BITBUCKET_REPO);

      case "BITBUCKET_ISSUE_CODE":
        if (!meta.issueKey) {
          return "Please specify a valid Jira issue key to find related code changes.";
        }
        return await handleIssueCodeQuery(meta.issueKey);
      
        


      default:
        throw new Error(`Unknown Bitbucket intent: ${intent}`);
    }
  } catch (error) {
    console.error(`Error handling Bitbucket query: ${error.message}`);

    // Provide a more helpful error message based on the error type
    if (error.response) {
      if (error.response.status === 404) {
        // Not found errors
        if (meta.repository) {
          return `I couldn't find the repository "${meta.repository}". Please check if the repository name is correct.`;
        } else if (meta.branch) {
          return `I couldn't find the branch "${meta.branch}" in the repository. Please check if the branch name is correct.`;
        }
        return `I couldn't find the requested resource. Please check if the names are correct.`;
      } else if (error.response.status === 401 || error.response.status === 403) {
        // Authentication/authorization errors
        return `I don't have permission to access this information. This could be due to repository permissions or authentication issues.`;
      }
    }

    // Generic error
    return `I encountered an error while fetching information from Bitbucket: ${error.message}. Please check your query and try again.`;
  }
}

// Handler for listing repositories
export async function handleRepositoriesQuery() {
  try {
    console.log("Fetching all repositories...");
    const reposData = await getBitbucketRepos();
    const repos = reposData.values || [];

    if (repos.length === 0) {
      return "I couldn't find any repositories in the workspace. This could be because there are no repositories or you don't have access to view them.";
    }

    // Process repository data to extract useful information
    const processedRepos = repos.map((repo) => {
      return {
        name: repo.name || repo.slug,
        slug: repo.slug,
        description: repo.description || "No description available",
        updated: repo.updated_on ? new Date(repo.updated_on).toLocaleDateString() : "Unknown",
        language: repo.language || "Not specified",
        mainBranch: repo.mainbranch?.name || "master",
        url: repo.links?.html?.href || "",
        isPrivate: repo.is_private || false,
      };
    });

    // Sort repositories by name for consistent output
    processedRepos.sort((a, b) => a.name.localeCompare(b.name));

    // Generate response
    let response = `## Bitbucket Repositories\n\n`;
    response += `I found ${repos.length} repositories in the workspace:\n\n`;

    // Group repositories by language for better organization
    const reposByLanguage = {};
    processedRepos.forEach((repo) => {
      const lang = repo.language || "Other";
      if (!reposByLanguage[lang]) {
        reposByLanguage[lang] = [];
      }
      reposByLanguage[lang].push(repo);
    });

    // Check if we should group by language (only if there are multiple languages)
    const languages = Object.keys(reposByLanguage);

    if (languages.length > 1 && processedRepos.length > 5) {
      // Group by language
      languages.sort().forEach((language) => {
        const langRepos = reposByLanguage[language];
        response += `### ${language} Repositories (${langRepos.length})\n\n`;

        langRepos.forEach((repo) => {
          response += `**${repo.name}**${repo.isPrivate ? " (Private)" : ""}\n`;
          response += `• Description: ${repo.description}\n`;
          response += `• Last Updated: ${repo.updated}\n`;
          if (repo.mainBranch) {
            response += `• Main Branch: ${repo.mainBranch}\n`;
          }
          response += `\n`;
        });
      });
    } else {
      // Simple list without grouping
      processedRepos.forEach((repo, index) => {
        response += `### ${index + 1}. ${repo.name}${repo.isPrivate ? " (Private)" : ""}\n`;
        response += `• Description: ${repo.description}\n`;
        response += `• Last Updated: ${repo.updated}\n`;
        response += `• Language: ${repo.language || "Not specified"}\n`;
        if (repo.mainBranch) {
          response += `• Main Branch: ${repo.mainBranch}\n`;
        }
        response += `\n`;
      });
    }

    response += `\nYou can ask about a specific repository by saying "Tell me about [repository name]" or "Show commits in [repository name]".`;

    return response;
  } catch (error) {
    console.error("Error fetching repositories:", error);
    throw error;
  }
}

// Handler for commit history
export async function handleCommitsQuery(repository, limit = 10) {
  if (!repository) {
    return "Please specify a repository to view commits. For example: 'Show commits in my-repo'";
  }

  try {
    console.log(`Fetching commits for repository ${repository}...`);
    const commitsData = await getBitbucketCommits(repository, limit || 10);
    const commits = commitsData.values || [];

    if (commits.length === 0) {
      return `I couldn't find any commits in the repository '${repository}'. The repository might be empty or you might not have access to it.`;
    }

    let response = `## Recent Commits in ${repository}\n\n`;

    // Group commits by author for better organization if there are multiple authors
    const commitsByAuthor = {};
    commits.forEach((commit) => {
      const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

      if (!commitsByAuthor[author]) {
        commitsByAuthor[author] = [];
      }

      commitsByAuthor[author].push(commit);
    });

    const authors = Object.keys(commitsByAuthor);

    // Decide whether to group by author based on number of authors and commits
    if (authors.length > 1 && commits.length > 5) {
      // Group by author
      authors.forEach((author) => {
        const authorCommits = commitsByAuthor[author];
        response += `### Commits by ${author} (${authorCommits.length})\n\n`;

        authorCommits.forEach((commit, index) => {
          const date =
            commit.date || commit.authorTimestamp ? new Date(commit.date || commit.authorTimestamp).toLocaleString() : "Unknown date";

          const message = commit.message ? commit.message.split("\n")[0] : "No commit message";

          const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

          response += `**${index + 1}. ${hash}** (${date})\n`;
          response += `${message}\n\n`;
        });
      });
    } else {
      // Chronological list
      commits.forEach((commit, index) => {
        const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

        const date =
          commit.date || commit.authorTimestamp ? new Date(commit.date || commit.authorTimestamp).toLocaleString() : "Unknown date";

        const message = commit.message ? commit.message.split("\n")[0] : "No commit message";

        const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

        response += `### ${index + 1}. Commit ${hash}\n`;
        response += `**Author**: ${author}\n`;
        response += `**Date**: ${date}\n`;
        response += `**Message**: ${message}\n\n`;
      });
    }

    // Add navigation tips
    response += `\nYou can also ask about commits on a specific branch by saying "Show commits on [branch name] in ${repository}".`;

    return response;
  } catch (error) {
    console.error(`Error fetching commits for repository ${repository}:`, error);
    throw error;
  }
}

// Handler for branches
export async function handleBranchesQuery(repository) {
  if (!repository) {
    return "Please specify a repository to view branches. For example: 'Show branches in my-repo'";
  }

  try {
    console.log(`Fetching branches for repository ${repository}...`);
    const branchesData = await getBitbucketBranches(repository);
    const branches = branchesData.values || [];

    if (branches.length === 0) {
      return `I couldn't find any branches in the repository '${repository}'. The repository might be new or you might not have access to it.`;
    }

    let response = `## Branches in ${repository}\n\n`;
    response += `I found ${branches.length} branches:\n\n`;

    // Improved branch type detection with more patterns
    const groupedBranches = {
      main: [],
      develop: [],
      feature: [],
      bugfix: [],
      hotfix: [],
      release: [],
      other: [],
    };

    branches.forEach((branch) => {
      const name = branch.name;

      // Determine branch type based on name pattern
      let type = "other";
      if (name === "main" || name === "master") {
        type = "main";
      } else if (name === "develop" || name === "development" || name === "dev") {
        type = "develop";
      } else if (name.match(/^feature\/|^feat\/|^features\//i)) {
        type = "feature";
      } else if (name.match(/^bugfix\/|^fix\/|^bug\//i)) {
        type = "bugfix";
      } else if (name.match(/^hotfix\/|^urgent\//i)) {
        type = "hotfix";
      } else if (name.match(/^release\/|^rel\//i)) {
        type = "release";
      }

      groupedBranches[type].push(branch);
    });

    // Main/master branches first (most important)
    if (groupedBranches.main.length > 0) {
      response += `### Main Branches\n`;
      groupedBranches.main.forEach((branch) => {
        response += `• **${branch.name}**`;
        if (branch.isDefault) response += " (default)";
        response += "\n";
      });
      response += `\n`;
    }

    // Develop branches next
    if (groupedBranches.develop.length > 0) {
      response += `### Development Branches\n`;
      groupedBranches.develop.forEach((branch) => {
        response += `• ${branch.name}\n`;
      });
      response += `\n`;
    }

    // Release branches (important for versioning)
    if (groupedBranches.release.length > 0) {
      response += `### Release Branches\n`;
      groupedBranches.release.forEach((branch) => {
        response += `• ${branch.name}\n`;
      });
      response += `\n`;
    }

    // Feature branches
    if (groupedBranches.feature.length > 0) {
      response += `### Feature Branches (${groupedBranches.feature.length})\n`;

      // If there are many feature branches, group them
      if (groupedBranches.feature.length > 10) {
        // Show only 10 most recent ones
        const sorted = [...groupedBranches.feature].sort((a, b) => {
          const dateA = a.target?.date ? new Date(a.target.date) : new Date(0);
          const dateB = b.target?.date ? new Date(b.target.date) : new Date(0);
          return dateB - dateA; // Sort newest first
        });

        sorted.slice(0, 10).forEach((branch) => {
          response += `• ${branch.name}\n`;
        });

        response += `... and ${groupedBranches.feature.length - 10} more feature branches\n`;
      } else {
        // Show all feature branches
        groupedBranches.feature.forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
      }
      response += `\n`;
    }

    // Bugfix branches
    if (groupedBranches.bugfix.length > 0) {
      response += `### Bugfix Branches (${groupedBranches.bugfix.length})\n`;

      // Similar approach as feature branches for many bugfixes
      if (groupedBranches.bugfix.length > 10) {
        const sorted = [...groupedBranches.bugfix].sort((a, b) => {
          const dateA = a.target?.date ? new Date(a.target.date) : new Date(0);
          const dateB = b.target?.date ? new Date(b.target.date) : new Date(0);
          return dateB - dateA; // Sort newest first
        });

        sorted.slice(0, 10).forEach((branch) => {
          response += `• ${branch.name}\n`;
        });

        response += `... and ${groupedBranches.bugfix.length - 10} more bugfix branches\n`;
      } else {
        groupedBranches.bugfix.forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
      }
      response += `\n`;
    }

    // Hotfix branches
    if (groupedBranches.hotfix.length > 0) {
      response += `### Hotfix Branches\n`;
      groupedBranches.hotfix.forEach((branch) => {
        response += `• ${branch.name}\n`;
      });
      response += `\n`;
    }

    // Other branches
    if (groupedBranches.other.length > 0) {
      response += `### Other Branches (${groupedBranches.other.length})\n`;

      if (groupedBranches.other.length > 10) {
        // Only show 10 if there are many
        groupedBranches.other.slice(0, 10).forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
        response += `... and ${groupedBranches.other.length - 10} more branches\n`;
      } else {
        groupedBranches.other.forEach((branch) => {
          response += `• ${branch.name}\n`;
        });
      }
      response += `\n`;
    }

    // Add tips for related queries
    response += `\nYou can ask about commits on a specific branch by saying "Show commits on [branch name] in ${repository}".`;

    return response;
  } catch (error) {
    console.error(`Error fetching branches for repository ${repository}:`, error);
    throw error;
  }
}

export async function handleBranchCommitsQuery(repository, branch, mode = "") {
  try {
    if (!repository) {
      return "Please specify a repository to view commits. For example: 'Show last commit on master in my-repo'";
    }

    if (!branch) {
      return "Please specify which branch you want to see commits for. For example: 'Show last commit on master'";
    }



    console.log(`Fetching commits for branch ${branch} in repository ${repository}...`);

    // Get branch information first to verify it exists
    let branchesData;
    try {
      branchesData = await getBitbucketBranches(repository);
    } catch (error) {
      console.error(`Error fetching branches for repository ${repository}:`, error);
      return `I couldn't access the branches in repository '${repository}'. Please check if the repository name is correct.`;
    }

    const branches = branchesData.values || [];
    const branchExists = branches.some((b) => b.name.toLowerCase() === branch.toLowerCase());

    if (!branchExists) {
      // If exact branch not found, look for similar branches
      const similarBranches = branches.filter((b) => b.name.toLowerCase().includes(branch.toLowerCase())).map((b) => b.name);

      if (similarBranches.length > 0) {
        return (
          `I couldn't find a branch named "${branch}" in repository "${repository}". Did you mean one of these branches?\n\n` +
          similarBranches.map((b) => `• ${b}`).join("\n")
        );
      } else {
        return (
          `I couldn't find a branch named "${branch}" in repository "${repository}". Available branches are:\n\n` +
          branches
            .slice(0, 10)
            .map((b) => `• ${b.name}`)
            .join("\n") +
          (branches.length > 10 ? `\n... and ${branches.length - 10} more branches.` : "")
        );
      }
    }

    // Now fetch commits for this branch
    let commitsData;
    try {
        const commitLimit = mode === "latestOnly" ? 1 : 10;
      // For Bitbucket Cloud
      if (BITBUCKET_URL.includes("bitbucket.org")) {
        commitsData = await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}/commits/${branch}`, {
          limit: commitLimit,
        });
      }
      // For Bitbucket Server
      else {
        commitsData = await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}/commits`, {
          until: branch,
          limit: commitLimit,
        });
      }
    } catch (error) {
      console.error(`Error fetching commits for branch ${branch}:`, error);
      return `I encountered an error fetching commits for branch "${branch}" in repository "${repository}". The error was: ${error.message}`;
    }

    const commits = commitsData.values || [];

    if (commits.length === 0) {
      return `I couldn't find any commits on branch "${branch}" in repository "${repository}".`;
    }

    // Format the response based on whether they asked for the latest commit or all commits
    if (mode === "latestOnly") {
      // Just show the most recent commit
      const commit = commits[0];
      const author = commit.author?.user?.display_name || commit.author?.raw || "Unknown";
      const date = commit.date || commit.authorTimestamp
        ? new Date(commit.date || commit.authorTimestamp).toLocaleString()
        : "Unknown date";
      const message = commit.message || "No commit message";
      const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

      let response = `## Latest Commit on "${branch}" in ${repository}\n\n`;
      response += `**Commit**: ${hash}\n`;
      response += `**Author**: ${author}\n`;
      response += `**Date**: ${date}\n`;
      response += `**Message**: ${message}\n\n`;

      return response;
    } else {
      // Show multiple recent commits
      let response = `## Recent Commits on "${branch}" in ${repository}\n\n`;

      commits.forEach((commit, index) => {
        const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

        const date =
          commit.date || commit.authorTimestamp ? new Date(commit.date || commit.authorTimestamp).toLocaleString() : "Unknown date";

        const message = commit.message
          ? commit.message.split("\n")[0] // Get only the first line of the commit message
          : "No commit message";

        const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

        response += `### ${index + 1}. Commit ${hash}\n`;
        response += `**Author**: ${author}\n`;
        response += `**Date**: ${date}\n`;
        response += `**Message**: ${message}\n\n`;
      });

      return response;
    }
  } catch (error) {
    console.error(`Error handling branch commits query:`, error);
    throw error;
  }
}

// Handler for pull requests
export async function handlePullRequestsQuery(repository) {
  try {
    // If no repository specified, try to get pull requests from all repositories
    if (!repository) {
      // First get list of repositories
      const reposData = await getBitbucketRepos();
      const repos = reposData.values || [];

      if (repos.length === 0) {
        return "I couldn't find any repositories to check for pull requests.";
      }

      // Track total PRs across all repos
      let totalPRs = 0;
      let pullRequestsByRepo = [];

      // Check first 5 repositories (to avoid too many API calls)
      const reposToCheck = repos.slice(0, 5);

      // Add debugging info
      console.log(`Checking ${reposToCheck.length} repositories for pull requests...`);

      for (const repo of reposToCheck) {
        const repoName = repo.name || repo.slug;
        try {
          console.log(`Checking repository: ${repoName}`);
          const prData = await getBitbucketPullRequests(repoName, "OPEN");
          const repoPRs = prData.values || [];

          // Double-check the PR states for this repo (extra validation)
          const trulyOpenPRs = repoPRs.filter((pr) => {
            // Comprehensive check for what makes a PR truly "open"
            const isOpen =
              (pr.state && pr.state.toLowerCase() === "open") ||
              (pr.status && pr.status.toLowerCase() === "open") ||
              // Also check that it's not merged or closed
              (!pr.closed && !pr.merged);

            if (!isOpen) {
              console.log(
                `Filtering out PR "${pr.title}" because it appears to be not truly open: state=${pr.state}, merged=${pr.merged}, closed=${pr.closed}`
              );
            }

            return isOpen;
          });

          console.log(`Repository ${repoName}: Found ${repoPRs.length} PRs, ${trulyOpenPRs.length} are truly open`);

          if (trulyOpenPRs.length > 0) {
            pullRequestsByRepo.push({
              repository: repoName,
              pullRequests: trulyOpenPRs,
            });
            totalPRs += trulyOpenPRs.length;
          }
        } catch (error) {
          console.error(`Error fetching pull requests for ${repoName}:`, error);
          // Continue with other repos
        }
      }

      // Build the response
      if (totalPRs === 0) {
        if (repos.length > 5) {
          return `I checked 5 repositories and didn't find any open pull requests. There are ${
            repos.length - 5
          } more repositories I didn't check.`;
        } else {
          return "I didn't find any open pull requests in any of the repositories.";
        }
      }

      let response = `## Open Pull Requests\n\n`;
      response += `I found a total of ${totalPRs} open pull requests across ${pullRequestsByRepo.length} repositories:\n\n`;

      // List PRs by repository
      for (const repoPRs of pullRequestsByRepo) {
        response += `### ${repoPRs.repository} (${repoPRs.pullRequests.length} PRs)\n\n`;

        // Show details for each PR
        repoPRs.pullRequests.forEach((pr, index) => {
          const title = pr.title || "No title";
          const author = pr.author ? pr.author.display_name || pr.author.username : "Unknown";
          const created = pr.created_on ? new Date(pr.created_on).toLocaleDateString() : "Unknown";
          const sourceRef = pr.source ? pr.source.branch.name : "Unknown branch";
          const targetRef = pr.destination ? pr.destination.branch.name : "Unknown branch";

          response += `**${index + 1}. ${title}**\n`;
          response += `**Author**: ${author}\n`;
          response += `**Created**: ${created}\n`;
          response += `**From**: ${sourceRef} → **To**: ${targetRef}\n\n`;
        });
      }

      // If there are more repositories we didn't check
      if (repos.length > 5) {
        response += `Note: I only checked 5 out of ${repos.length} repositories. To see pull requests for a specific repository, ask "Show pull requests in [repository-name]".\n`;
      }

      return response;
    }

    // If a specific repository was provided, get PRs for just that repository
    console.log(`Fetching pull requests for specific repository: ${repository}`);
    const prData = await getBitbucketPullRequests(repository, "OPEN");
    let pullRequests = prData.values || [];

    // Extra validation step - filter to only truly open PRs
    pullRequests = pullRequests.filter((pr) => {
      const isOpen =
        (pr.state && pr.state.toLowerCase() === "open") || (pr.status && pr.status.toLowerCase() === "open") || (!pr.closed && !pr.merged);

      if (!isOpen) {
        console.log(`Filtering out PR "${pr.title}" because it appears to be not truly open`);
      }

      return isOpen;
    });

    console.log(`Found ${pullRequests.length} truly open pull requests in ${repository}`);

    if (pullRequests.length === 0) {
      return `I couldn't find any open pull requests in the repository '${repository}'.`;
    }

    let response = `## Open Pull Requests in ${repository}\n\n`;
    response += `I found ${pullRequests.length} open pull requests:\n\n`;

    pullRequests.forEach((pr, index) => {
      const title = pr.title || "No title";
      const author = pr.author ? pr.author.display_name || pr.author.username : "Unknown";
      const created = pr.created_on ? new Date(pr.created_on).toLocaleDateString() : "Unknown";
      const sourceRef = pr.source ? pr.source.branch.name : "Unknown branch";
      const targetRef = pr.destination ? pr.destination.branch.name : "Unknown branch";

      response += `### ${index + 1}. ${title}\n`;
      response += `**Author**: ${author}\n`;
      response += `**Created**: ${created}\n`;
      response += `**From**: ${sourceRef} → **To**: ${targetRef}\n`;

      // Add reviewers if available
      if (pr.reviewers && pr.reviewers.length > 0) {
        const reviewers = pr.reviewers.map((r) => r.display_name || r.username).join(", ");
        response += `**Reviewers**: ${reviewers}\n`;
      }

      // Add comment count if available
      if (pr.comment_count) {
        response += `**Comments**: ${pr.comment_count}\n`;
      }

      // Add description (first few lines)
      if (pr.description) {
        const shortDesc = pr.description.split("\n")[0];
        response += `**Description**: ${shortDesc}${pr.description.length > shortDesc.length ? "..." : ""}\n`;
      }

      // Add PR state explicitly for clarity
      response += `**State**: ${pr.state || "Open"}\n`;

      response += `\n`;
    });

    return response;
  } catch (error) {
    console.error(`Error handling pull requests query:`, error);
    throw error;
  }
}

// Handler for repository info
export async function handleRepositoryInfoQuery(repository) {
  if (!repository) {
    return "Please specify a repository. For example: 'Tell me about repo-name'";
  }

  try {
    // For Bitbucket Cloud
    let repoInfo;
    if (BITBUCKET_URL.includes("bitbucket.org")) {
      repoInfo = await callBitbucketApi(`/repositories/${BITBUCKET_WORKSPACE}/${repository}`);
    }
    // For Bitbucket Server
    else {
      repoInfo = await callBitbucketApi(`/projects/${BITBUCKET_WORKSPACE}/repos/${repository}`);
    }

    // Get additional info from other endpoints
    const [commitsData, branchesData, prData] = await Promise.all([
      getBitbucketCommits(repository, 5).catch(() => ({ values: [] })),
      getBitbucketBranches(repository).catch(() => ({ values: [] })),
      getBitbucketPullRequests(repository, "OPEN").catch(() => ({ values: [] })),
    ]);

    const commits = commitsData.values || [];
    const branches = branchesData.values || [];
    const pullRequests = prData.values || [];

    // Build the response
    let response = `## Repository: ${repoInfo.name || repository}\n\n`;

    // Basic info
    response += `**Description**: ${repoInfo.description || "No description"}\n`;
    if (repoInfo.language) {
      response += `**Main Language**: ${repoInfo.language}\n`;
    }
    if (repoInfo.created_on) {
      response += `**Created**: ${new Date(repoInfo.created_on).toLocaleDateString()}\n`;
    }
    if (repoInfo.updated_on) {
      response += `**Last Updated**: ${new Date(repoInfo.updated_on).toLocaleDateString()}\n`;
    }
    if (repoInfo.size) {
      response += `**Size**: ${(repoInfo.size / 1024).toFixed(2)} KB\n`;
    }

    // Stats
    response += `\n### Statistics\n`;
    response += `• ${branches.length} branches\n`;
    response += `• ${pullRequests.length} open pull requests\n`;

    // Recent activity
    if (commits.length > 0) {
      response += `\n### Recent Commits\n`;
      commits.forEach((commit, i) => {
        const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";
        const message = commit.message ? commit.message.split("\n")[0] : "No message";
        const date = commit.date ? new Date(commit.date).toLocaleDateString() : "Unknown";

        response += `• ${date} - ${author}: ${message}\n`;
      });
    }

    // Open PRs
    if (pullRequests.length > 0) {
      response += `\n### Open Pull Requests\n`;
      pullRequests.slice(0, 3).forEach((pr, i) => {
        const author = pr.author ? pr.author.display_name || pr.author.username : "Unknown";
        response += `• ${pr.title} (by ${author})\n`;
      });

      if (pullRequests.length > 3) {
        response += `• ... and ${pullRequests.length - 3} more pull requests\n`;
      }
    }

    return response;
  } catch (error) {
    console.error(`Error fetching repository info for ${repository}:`, error);
    throw error;
  }
}

// Handler for Jira issue code changes
export async function handleIssueCodeQuery(issueKey) {
  if (!issueKey) {
    return "Please specify a Jira issue key. For example: 'Show code changes for NIHK-123'";
  }

  try {
    const codeChanges = await getCodeChangesForJiraIssue(issueKey);

    // Check if we got any results
    if (!codeChanges.repositories || codeChanges.repositories.length === 0) {
      return `I couldn't find any code changes related to issue ${issueKey}.`;
    }

    let response = `## Code Changes Related to ${issueKey}\n\n`;

    codeChanges.repositories.forEach((repo) => {
      response += `### Repository: ${repo.repository}\n\n`;

      if (repo.commits && repo.commits.length > 0) {
        response += `Found ${repo.commits.length} related commits:\n\n`;

        repo.commits.forEach((commit, index) => {
          const author = commit.author ? (commit.author.user ? commit.author.user.display_name : commit.author.raw) : "Unknown";

          const date = commit.date ? new Date(commit.date).toLocaleString() : "Unknown date";

          const message = commit.message || "No commit message";
          const hash = commit.hash ? commit.hash.substring(0, 7) : "Unknown";

          response += `**${index + 1}. Commit ${hash}**\n`;
          response += `**Author**: ${author}\n`;
          response += `**Date**: ${date}\n`;
          response += `**Message**: ${message}\n\n`;
        });
      } else {
        response += "No specific commits found.\n\n";
      }
    });

    return response;
  } catch (error) {
    console.error(`Error fetching code changes for issue ${issueKey}:`, error);
    throw error;
  }
}
