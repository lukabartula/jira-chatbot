import axios from 'axios';
import dotenv from 'dotenv';
import cheerio from 'cheerio';
import { openai } from '../config/openaiConfig.js';
dotenv.config();



// CONFLUENCE FUNCTIONALITY START
const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const CONFLUENCE_USER = process.env.JIRA_USER;
const CONFLUENCE_API_TOKEN = process.env.JIRA_API_TOKEN;

const confluenceAuth = {
  username: CONFLUENCE_USER,
  password: CONFLUENCE_API_TOKEN,
};

// Store indexed pages for quick searching
const confluenceIndex = new Map();
const pageHierarchy = new Map();

// Helper function to make Confluence API requests
export async function callConfluenceApi(endpoint, params = {}) {
  try {
    const apiUrl = endpoint.startsWith("http") ? endpoint : `${CONFLUENCE_URL}/rest/api${endpoint}`;

    const response = await axios.get(apiUrl, {
      params,
      auth: confluenceAuth,
      headers: {
        Accept: "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Error calling Confluence API (${endpoint}):`, error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    }
    throw error;
  }
}

// Function to extract page ID from Confluence URL
export function extractPageIdFromUrl(confluenceUrl) {
  try {
    const parsedUrl = new URL(confluenceUrl);

    // Handle different Confluence URL formats
    // Format 1: /pages/viewpage.action?pageId=123456
    if (parsedUrl.pathname.includes("/pages/viewpage.action")) {
      const pageId = parsedUrl.searchParams.get("pageId");
      if (pageId) return pageId;
    }

    // Format 2: /display/SPACE/Page+Title
    if (parsedUrl.pathname.includes("/display/")) {
      const pathParts = parsedUrl.pathname.split("/");
      const spaceKey = pathParts[2];
      const pageTitle = decodeURIComponent(pathParts[3] || "").replace(/\+/g, " ");
      return { spaceKey, pageTitle };
    }

    // Format 3: /spaces/SPACE/pages/123456/Page+Title
    if (parsedUrl.pathname.includes("/spaces/") && parsedUrl.pathname.includes("/pages/")) {
      const pathParts = parsedUrl.pathname.split("/");
      const pageIdIndex = pathParts.indexOf("pages") + 1;
      if (pageIdIndex < pathParts.length) {
        return pathParts[pageIdIndex];
      }
    }

    return null;
  } catch (error) {
    console.error("Error parsing Confluence URL:", error);
    return null;
  }
}

// Function to get page content by ID
async function getConfluencePageById(pageId) {
  try {
    const page = await callConfluenceApi(`/content/${pageId}`, {
      expand: "body.storage,ancestors,children.page,space,version",
    });

    return page;
  } catch (error) {
    console.error(`Error fetching page ${pageId}:`, error);
    throw error;
  }
}

// Function to get page content by space and title
async function getConfluencePageByTitle(spaceKey, title) {
  try {
    const results = await callConfluenceApi("/content", {
      spaceKey: spaceKey,
      title: title,
      expand: "body.storage,ancestors,children.page,space,version",
    });

    if (results.results && results.results.length > 0) {
      return results.results[0];
    }

    return null;
  } catch (error) {
    console.error(`Error fetching page by title ${title} in space ${spaceKey}:`, error);
    throw error;
  }
}

// Function to get child pages
async function getChildPages(pageId, depth = 2) {
  try {
    const children = await callConfluenceApi(`/content/${pageId}/child/page`, {
      expand: "body.storage,ancestors,children.page,space,version",
      limit: 50,
    });

    let allChildren = children.results || [];

    // Recursively get children if depth > 1
    if (depth > 1) {
      for (const child of children.results || []) {
        try {
          const grandChildren = await getChildPages(child.id, depth - 1);
          allChildren = allChildren.concat(grandChildren);
        } catch (error) {
          console.error(`Error fetching children of page ${child.id}:`, error);
        }
      }
    }

    return allChildren;
  } catch (error) {
    console.error(`Error fetching child pages for ${pageId}:`, error);
    return [];
  }
}

async function getAllChildPagesRecursive(pageId, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    console.log(`Reached maximum depth ${maxDepth} for page ${pageId}`);
    return [];
  }

  try {
    console.log(`Fetching children for page ${pageId} at depth ${currentDepth}`);

    const children = await callConfluenceApi(`/content/${pageId}/child/page`, {
      expand: "body.storage,ancestors,children.page,space,version",
      limit: 100, // Increased limit
    });

    let allChildren = children.results || [];
    console.log(`Found ${allChildren.length} direct children for page ${pageId}`);

    // Recursively get children of children
    for (const child of children.results || []) {
      try {
        const grandChildren = await getAllChildPagesRecursive(child.id, maxDepth, currentDepth + 1);
        allChildren = allChildren.concat(grandChildren);

        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching children of page ${child.id}:`, error.message);
      }
    }

    return allChildren;
  } catch (error) {
    console.error(`Error fetching child pages for ${pageId} at depth ${currentDepth}:`, error);
    return [];
  }
}

async function autoIndexMainPage() {
  if (!CONFLUENCE_MAIN_PAGE_ID) {
    console.log("CONFLUENCE_MAIN_PAGE_ID not set. Skipping auto-indexing.");
    return null;
  }

  try {
    console.log(`🚀 Starting auto-indexing of main page: ${CONFLUENCE_MAIN_PAGE_ID}`);

    // Get the main page
    const mainPage = await getConfluencePageById(CONFLUENCE_MAIN_PAGE_ID);
    if (!mainPage) {
      throw new Error(`Main page ${CONFLUENCE_MAIN_PAGE_ID} not found`);
    }

    // Extract and store the main page
    const mainPageData = extractStructuredContent(mainPage);
    confluenceIndex.set(mainPage.id, mainPageData);
    console.log(`✅ Indexed main page: ${mainPage.title} (${mainPage.id})`);

    // Get ALL child pages recursively
    console.log("🔍 Fetching all child pages...");
    const allChildPages = await getAllChildPagesRecursive(mainPage.id);

    console.log(`📊 Found ${allChildPages.length} total child pages`);

    // Index all child pages
    let indexedCount = 0;
    for (const childPage of allChildPages) {
      try {
        const childData = extractStructuredContent(childPage);
        confluenceIndex.set(childPage.id, childData);

        // Store parent-child relationship
        if (!pageHierarchy.has(mainPage.id)) {
          pageHierarchy.set(mainPage.id, []);
        }
        pageHierarchy.get(mainPage.id).push(childPage.id);

        indexedCount++;
        console.log(`✅ Indexed child page ${indexedCount}/${allChildPages.length}: ${childPage.title} (${childPage.id})`);

        // Add small delay to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`❌ Error indexing child page ${childPage.id}:`, error.message);
      }
    }

    const summary = {
      mainPage: mainPageData,
      totalChildPages: allChildPages.length,
      indexedChildPages: indexedCount,
      totalIndexed: 1 + indexedCount,
      failedPages: allChildPages.length - indexedCount,
    };

    console.log(`🎉 Auto-indexing complete! Indexed ${summary.totalIndexed} pages total`);
    console.log(`📊 Main: 1, Children: ${summary.indexedChildPages}/${summary.totalChildPages}`);

    return summary;
  } catch (error) {
    console.error("❌ Error during auto-indexing:", error);
    throw error;
  }
}

// Function to extract text content from Confluence storage format
function extractTextFromConfluenceContent(storageBody) {
  if (!storageBody || !storageBody.value) {
    return "";
  }

  try {
    const $ = cheerio.load(storageBody.value);

    // Remove script and style elements
    $("script, style").remove();

// Detect Confluence-style task lists and format them as markdown
$("ac\\:task-list ac\\:task").each(function () {
  const status = $(this).find("ac\\:task-status").text().trim();
  const body = $(this).find("ac\\:task-body").text().trim();
  const checked = status === "checked" ? "x" : " ";
  $(this).replaceWith(`- [${checked}] ${body}\n`);
});

// Extract the full cleaned text
let text = $("body").text().trim();
text = text.replace(/\s+/g, " ");

    return text;
  } catch (error) {
    console.error("Error extracting text from Confluence content:", error);
    return storageBody.value || "";
  }
}

// Function to extract structured content from Confluence page
function extractStructuredContent(page) {
  const textContent = extractTextFromConfluenceContent(page.body?.storage);

  return {
    id: page.id,
    title: page.title,
    spaceKey: page.space?.key,
    spaceName: page.space?.name,
    content: textContent,
    url: `${CONFLUENCE_URL}/pages/viewpage.action?pageId=${page.id}`,
    lastModified: page.version?.when,
    author: page.version?.by?.displayName,
    ancestors: page.ancestors?.map((a) => ({ id: a.id, title: a.title })) || [],
  };
}

// Function to index a page and its children
export async function indexConfluencePage(pageIdentifier, includeChildren = true) {
  try {
    let page;

    // Get the main page
    if (typeof pageIdentifier === "string" && !isNaN(pageIdentifier)) {
      // It's a page ID
      page = await getConfluencePageById(pageIdentifier);
    } else if (typeof pageIdentifier === "object") {
      // It's a space key and title
      page = await getConfluencePageByTitle(pageIdentifier.spaceKey, pageIdentifier.pageTitle);
    } else {
      throw new Error("Invalid page identifier");
    }

    if (!page) {
      throw new Error("Page not found");
    }

    // Extract and store the main page
    const mainPageData = extractStructuredContent(page);
    confluenceIndex.set(page.id, mainPageData);

    console.log(`Indexed main page: ${page.title} (${page.id})`);

    // Get and index child pages if requested
    let childPages = [];
    if (includeChildren) {
      childPages = await getChildPages(page.id, 3); // Get 3 levels deep

      for (const childPage of childPages) {
        const childData = extractStructuredContent(childPage);
        confluenceIndex.set(childPage.id, childData);

        // Store parent-child relationship
        if (!pageHierarchy.has(page.id)) {
          pageHierarchy.set(page.id, []);
        }
        pageHierarchy.get(page.id).push(childPage.id);

        console.log(`Indexed child page: ${childPage.title} (${childPage.id})`);
      }
    }

    return {
      mainPage: mainPageData,
      childPages: childPages.map(extractStructuredContent),
      totalIndexed: 1 + childPages.length,
    };
  } catch (error) {
    console.error("Error indexing Confluence page:", error);
    throw error;
  }
}

// Enhanced Confluence intent detection for knowledge base queries
export async function detectConfluenceKnowledgeBaseIntent(query) {
  const lowercaseQuery = query.toLowerCase().trim();
  
  // Check for refresh/reindex commands
  if (/(?:refresh|reload|reindex|update).*(?:confluence|docs|documentation|knowledge|pages)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_REFRESH';
  }
  
  // Check for knowledge base status
  if (/(?:how many|status|info|information).*(?:pages|docs|indexed|confluence)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_STATUS';
  }
  
  // If we have indexed content, treat most questions as knowledge base queries
  if (confluenceIndex.size > 0) {
    // General question patterns that should search the knowledge base
    if (
      /(?:what|how|when|where|why|explain|tell me|describe|show me|find|search|latest updates?|recent updates?|meeting notes?|minutes?|protocol|notes?|documentation|docs?|guide|manual|process|procedure|summary|overview)/i
      .test(lowercaseQuery)) {
      // Exclude obvious Jira/Bitbucket queries
      if (!/(?:jira|task|issue|ticket|bug|story|epic|sprint|bitbucket|repo|repository|commit|branch|pull request)/i.test(lowercaseQuery)) {
        return 'CONFLUENCE_KNOWLEDGE_SEARCH';
      }
    }
  }
  
  return null;
}

// Enhanced handler for knowledge base queries
export async function handleConfluenceKnowledgeQuery(query, intent) {
  try {
    switch (intent) {
      case "CONFLUENCE_REFRESH":
        return await handleRefreshQuery();

      case "CONFLUENCE_STATUS":
        return await handleStatusQuery();

      case "CONFLUENCE_KNOWLEDGE_SEARCH":
        return await handleKnowledgeSearchQuery(query);

      default:
        throw new Error(`Unknown Confluence knowledge base intent: ${intent}`);
    }
  } catch (error) {
    console.error(`Error handling Confluence knowledge query: ${error.message}`);
    return `I encountered an error while searching the knowledge base: ${error.message}`;
  }
}

// Handler for refresh queries
export async function handleRefreshQuery() {
  try {
    console.log("🔄 Refreshing indexed content...");

    // Clear existing index
    confluenceIndex.clear();
    pageHierarchy.clear();

    // Re-index everything
    const result = await autoIndexMainPage();

    if (result) {
      return (
        `## 🔄 Knowledge Base Refreshed\n\n` +
        `Successfully refreshed ${result.totalIndexed} pages\n\n` +
        `**Details:**\n` +
        `• Main page: ${result.mainPage?.title || "Unknown"}\n` +
        `• Child pages: ${result.indexedChildPages || 0}\n` +
        `• Total indexed: ${result.totalIndexed || 0}\n\n` +
        `You can now ask questions about the updated content!`
      );
    }

    return `## ❌ Refresh Failed\n\nFailed to refresh content.`;
  } catch (error) {
    console.error("Error refreshing content:", error);
    return `## ❌ Refresh Failed\n\n${error.message}`;
  }
}

// Handler for status queries
export async function handleStatusQuery() {
  if (confluenceIndex.size === 0) {
    return (
      `## 📊 Knowledge Base Status\n\n` +
      `**Status:** Not initialized\n` +
      `**Indexed pages:** 0\n\n` +
      `The system should auto-index your main page on startup. Try restarting the server or ask me to refresh the knowledge base.`
    );
  }

  const pages = Array.from(confluenceIndex.values());
  const spaces = [...new Set(pages.map((p) => p.spaceName || p.spaceKey))];
  const lastModified = pages.reduce((latest, page) => {
    const pageDate = new Date(page.lastModified);
    return pageDate > latest ? pageDate : latest;
  }, new Date(0));

  return (
    `## 📊 Knowledge Base Status\n\n` +
    `**Status:** ✅ Active\n` +
    `**Indexed pages:** ${confluenceIndex.size}\n` +
    `**Spaces covered:** ${spaces.join(", ")}\n` +
    `**Last updated:** ${lastModified.toLocaleDateString()}\n\n` +
    `**Available commands:**\n` +
    `• Ask any question to search the knowledge base\n` +
    `• "Refresh confluence docs" to update content\n` +
    `• "Search for [topic]" to find specific information`
  );
}

// Function to search indexed pages
function searchIndexedPages(query, pageId = null) {
  const results = [];
  const searchTerms = query
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length > 2);

  // If pageId is specified, search only that page and its children
  let pagesToSearch;
  if (pageId) {
    pagesToSearch = [pageId];
    if (pageHierarchy.has(pageId)) {
      pagesToSearch = pagesToSearch.concat(pageHierarchy.get(pageId));
    }
  } else {
    pagesToSearch = Array.from(confluenceIndex.keys());
  }

  for (const id of pagesToSearch) {
    const pageData = confluenceIndex.get(id);
    if (!pageData) continue;

    const searchableText = `${pageData.title} ${pageData.content}`.toLowerCase();

    // Calculate relevance score
    let score = 0;
    for (const term of searchTerms) {
      const titleMatches = (pageData.title.toLowerCase().match(new RegExp(term, "g")) || []).length;
      const contentMatches = (pageData.content.toLowerCase().match(new RegExp(term, "g")) || []).length;

      score += titleMatches * 10 + contentMatches; // Title matches are weighted more
    }

    if (score > 0) {
      results.push({
        ...pageData,
        relevanceScore: score,
      });
    }
  }

  // Sort by relevance score
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results;
}

// Intent detection for Confluence queries
export async function detectConfluenceIntent(query) {
  const lowercaseQuery = query.toLowerCase().trim();

  // Check for Confluence URLs in the query
  const confluenceUrlPattern = /https?:\/\/[^\/\s]+\/(?:wiki\/|display\/|pages\/|spaces\/)/i;
  const urlMatch = query.match(confluenceUrlPattern);

  if (urlMatch) {
    return {
      intent: "CONFLUENCE_INDEX_URL",
      url: urlMatch[0],
    };
  }

  // Check for refresh/reindex commands
  if (/(?:refresh|reload|reindex|update).*(?:confluence|docs|documentation|knowledge|pages)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_REFRESH';
  }
  
  // Check for knowledge base status
  if (/(?:how many|status|info|information).*(?:pages|docs|indexed|confluence)/i.test(lowercaseQuery) ||
      /confluence.*(?:status|info|pages)/i.test(lowercaseQuery)) {
    return 'CONFLUENCE_STATUS';
  }

  // If we have indexed content, treat knowledge-seeking questions as Confluence queries
  if (confluenceIndex.size > 0) {
    // General question patterns that should search the knowledge base
    if (/(?:what|how|when|where|why|explain|tell me|describe|show me|find|search|documentation|docs|guide|process|procedure)/i.test(lowercaseQuery)) {
      // Exclude obvious Jira/Bitbucket queries
      if (!/(?:jira|task|issue|ticket|bug|story|epic|sprint|assignee|status.*project|project.*status|bitbucket|repo|repository|commit|branch|pull request|pr)/i.test(lowercaseQuery)) {
        return 'CONFLUENCE_KNOWLEDGE_SEARCH';
      }
    }
  }

  // Pattern for searching indexed content
  if (/(?:search|find|look for|tell me about).*(?:in|from|on)\s+(?:confluence|wiki|docs|documentation)/i.test(lowercaseQuery)) {
    return "CONFLUENCE_SEARCH";
  }

  // Pattern for questions about indexed content  
  if (/(?:confluence|wiki|documentation|docs|page|article|knowledge base|kb|guide|manual|procedure|process)/i.test(lowercaseQuery) && 
      /(?:what|how|when|where|why|tell me|explain|describe)/i.test(lowercaseQuery)) {
    return "CONFLUENCE_QUESTION";
  }

  // Index management
  if (/(?:index|add|include).*(?:confluence|wiki|page)/i.test(lowercaseQuery)) {
    return "CONFLUENCE_INDEX_REQUEST";
  }

  return null;
}

// Main handler for Confluence queries
export async function handleConfluenceQuery(query, intent, meta = {}) {
  try {
    console.log(`Handling Confluence query with intent: ${intent}`);

    switch (intent) {
      case "CONFLUENCE_INDEX_URL":
        return await handleIndexUrlQuery(meta.url);

      case "CONFLUENCE_SEARCH":
        return await handleSearchQuery(query);

      case "CONFLUENCE_QUESTION":
        return await handleQuestionQuery(query);

      case "CONFLUENCE_INDEX_REQUEST":
        return await handleIndexRequestQuery(query);

      case 'CONFLUENCE_REFRESH':
        return await handleRefreshQuery();
        
      case 'CONFLUENCE_STATUS':
        return await handleStatusQuery();
        
      case 'CONFLUENCE_KNOWLEDGE_SEARCH':
        return await handleKnowledgeSearchQuery(query);

      default:
        throw new Error(`Unknown Confluence intent: ${intent}`);
    }
  } catch (error) {
    console.error(`Error handling Confluence query: ${error.message}`);

    if (error.response) {
      if (error.response.status === 404) {
        return `I couldn't find the requested Confluence page. Please check if the URL is correct and you have access to it.`;
      } else if (error.response.status === 401 || error.response.status === 403) {
        return `I don't have permission to access this Confluence content. Please check the authentication settings.`;
      }
    }

    return `I encountered an error while accessing Confluence: ${error.message}. Please try again.`;
  }
}

// Handler for indexing a URL
async function handleIndexUrlQuery(confluenceUrl) {
  try {
    const pageIdentifier = extractPageIdFromUrl(confluenceUrl);

    if (!pageIdentifier) {
      return `I couldn't extract a valid page identifier from that URL. Please make sure it's a valid Confluence page URL.`;
    }

    const result = await indexConfluencePage(pageIdentifier, true);

    let response = `## Successfully Indexed Confluence Content\n\n`;
    response += `**Main Page**: ${result.mainPage.title}\n`;
    response += `**Space**: ${result.mainPage.spaceName || result.mainPage.spaceKey}\n`;
    response += `**Total Pages Indexed**: ${result.totalIndexed}\n\n`;

    if (result.childPages.length > 0) {
      response += `**Child Pages Indexed**:\n`;
      result.childPages.slice(0, 5).forEach((page, index) => {
        response += `• ${page.title}\n`;
      });

      if (result.childPages.length > 5) {
        response += `• ... and ${result.childPages.length - 5} more pages\n`;
      }
    }

    response += `\nYou can now ask questions about this content! Try asking:\n`;
    response += `• "What does the ${result.mainPage.title} page say about...?"\n`;
    response += `• "Search for information about [topic]"\n`;
    response += `• "Explain the process for..."\n`;

    return response;
  } catch (error) {
    console.error("Error indexing URL:", error);
    throw error;
  }
}

// Handler for search queries
async function handleSearchQuery(query) {
  try {
    // Extract search terms
    const searchMatch = query.match(/(?:search|find|look for)(?:\s+for)?\s+(.+?)(?:\s+in\s+|$)/i);
    const searchTerms = searchMatch ? searchMatch[1] : query.replace(/(?:search|find|look for|in confluence|in wiki|in docs)/gi, "").trim();

    if (!searchTerms) {
      return `Please specify what you'd like to search for. For example: "Search for user authentication process"`;
    }

    const results = searchIndexedPages(searchTerms);

    if (results.length === 0) {
      return `I couldn't find any information about "${searchTerms}" in the indexed Confluence pages. You might need to index more pages or try different search terms.`;
    }

    let response = `## Search Results for "${searchTerms}"\n\n`;
    response += `Found ${results.length} relevant page${results.length > 1 ? "s" : ""}:\n\n`;

    results.slice(0, 5).forEach((result, index) => {
      response += `### ${index + 1}. ${result.title}\n`;
      response += `**Space**: ${result.spaceName || result.spaceKey}\n`;

      // Show a relevant excerpt
      const excerpt = extractRelevantExcerpt(result.content, searchTerms);
      if (excerpt) {
        response += `**Excerpt**: ${excerpt}\n`;
      }

      response += `**URL**: [View Page](${result.url})\n\n`;
    });

    if (results.length > 5) {
      response += `... and ${results.length - 5} more results.\n\n`;
    }

    response += `You can ask follow-up questions about any of these pages!`;

    return response;
  } catch (error) {
    console.error("Error handling search query:", error);
    throw error;
  }
}

// Handler for question queries
async function handleQuestionQuery(query) {
  try {
    // Use the search function to find relevant pages
    const results = searchIndexedPages(query);

    if (results.length === 0) {
      return `I couldn't find information to answer your question in the indexed Confluence pages. Try indexing more pages or rephrasing your question.`;
    }

    // Use the top results to generate an answer
    const topResults = results.slice(0, 3);
    const context = topResults.map((result) => ({
      title: result.title,
      content: result.content.substring(0, 1000), // Limit content length
      url: result.url,
    }));

    try {
      // Generate AI response based on the Confluence content
      const systemPrompt = `
        You are a helpful assistant that answers questions based on Confluence documentation.
        Use the provided Confluence page content to answer the user's question accurately.
        
        Guidelines:
        - Base your answer primarily on the provided content
        - If the content doesn't fully answer the question, say so
        - Include references to the relevant pages
        - Format your response with markdown
        - Be concise but comprehensive
        - If the content is not sufficient, suggest the user to check the pages for more details
        - If there is no answer available, politely inform the user, like a fallback response
        - If the content is about Confluence, do not access Jira or Bitbucket content
        - If there are typos in the question, try to correct them based on the context, if not, ask them to retype the question
        - Use the provided Confluence documentation as a primary source of information, answer all questions based on the Confluence pages, as if I am asking GPT-4 directly
        - Regard the 'checkboxes' ([ ]) as a task list and TO DO list, and answer the question based on the context of the task list
        
        User question: "${query}"
      `;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Confluence content: ${JSON.stringify(context)}\n\nAnswer the question: "${query}"`,
          },
        ],
        temperature: 0.3, // Lower temperature for more factual responses
      });

      let response = aiResponse.choices[0].message.content.trim();

      // Add source references
      response += `\n\n**Sources**:\n`;
      topResults.forEach((result, index) => {
        response += `• [${result.title}](${result.url})\n`;
      });

      return response;
    } catch (aiError) {
      console.error("Error generating AI response:", aiError);

      // Fallback to showing relevant excerpts
      let response = `Based on the indexed Confluence pages, here's what I found:\n\n`;

      topResults.forEach((result, index) => {
        response += `### ${result.title}\n`;
        const excerpt = extractRelevantExcerpt(result.content, query);
        response += `${excerpt}\n\n`;
      });

      response += `**Sources**:\n`;
      topResults.forEach((result) => {
        response += `• [${result.title}](${result.url})\n`;
      });

      return response;
    }
  } catch (error) {
    console.error("Error handling question query:", error);
    throw error;
  }
}

// Handler for index requests
async function handleIndexRequestQuery(query) {
  return (
    `To index a Confluence page, please provide the full URL of the page you'd like me to index. For example:\n\n` +
    `"Index this page: https://your-company.atlassian.net/wiki/spaces/DOCS/pages/123456/Page+Title"\n\n` +
    `I'll automatically index the page and its child pages so you can ask questions about the content.`
  );
}

// Helper function to extract relevant excerpts
function extractRelevantExcerpt(content, searchTerms, maxLength = 200) {
  const terms = searchTerms
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length > 2);

  for (const term of terms) {
    const index = content.toLowerCase().indexOf(term);
    if (index !== -1) {
      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, start + maxLength);
      let excerpt = content.substring(start, end);

      // Clean up the excerpt
      if (start > 0) excerpt = "..." + excerpt;
      if (end < content.length) excerpt = excerpt + "...";

      return excerpt;
    }
  }

  // If no specific terms found, return the beginning
  return content.substring(0, maxLength) + (content.length > maxLength ? "..." : "");
}

// Handler for knowledge search queries
async function handleKnowledgeSearchQuery(query) {
  const results = searchIndexedPages(query, null); // Search all indexed pages

  if (results.length === 0) {
    return (
      `## 🔍 No Results Found\n\n` +
      `I couldn't find information about "${query}" in the ${confluenceIndex.size} indexed pages.\n\n` +
      `Try:\n` +
      `• Using different keywords\n` +
      `• Being more specific\n` +
      `• Asking about general topics covered in the documentation\n\n` +
      `Or ask me to "refresh confluence docs" to update the content.`
    );
  }

  try {
    // Generate AI answer based on search results
    const context = results.slice(0, 3).map((result) => ({
      title: result.title,
      content: result.content.substring(0, 1500),
      url: result.url,
      relevanceScore: result.relevanceScore,
    }));

    const systemPrompt = `
      You are a helpful documentation assistant answering questions about the IHK Akademie Relaunch External project.
      Answer the user's question based on the provided Confluence documentation.
      
      Guidelines:
      - Use the provided content to give a comprehensive answer
      - Structure your response with clear headings using ##
      - Include specific details and examples when available
      - If the content doesn't fully answer the question, say so
      - Be thorough but concise
      - Use markdown formatting for better readability
      - If the content is about Confluence, do not access Jira or Bitbucket content
      - If there are typos in the question, try to correct them based on the context, if not, ask them to retype the question
      - Use the provided Confluence documentation as a primary source of information, answer all questions based on the Confluence pages, as if I am asking GPT-4 directly
      - if the titles don't match correctly, try to correct them based on the context or search for similar titles in the documentation

      
      User question: "${query}"
    `;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Documentation content: ${JSON.stringify(context)}\n\nAnswer: "${query}"`,
        },
      ],
      temperature: 0.2,
    });

    let response = aiResponse.choices[0].message.content.trim();

    // Add source references
    response += `\n\n## 📚 Sources\n\n`;
    results.slice(0, 3).forEach((result, index) => {
      response += `${index + 1}. **[${result.title}](${result.url})**\n`;
    });

    if (results.length > 3) {
      response += `\n*...and ${results.length - 3} more relevant pages*`;
    }

    return response;
  } catch (aiError) {
    console.error("Error generating AI response:", aiError);

    // Fallback to showing search results
    let response = `## 🔍 Search Results for "${query}"\n\n`;

    results.slice(0, 3).forEach((result, index) => {
      response += `### ${index + 1}. ${result.title}\n\n`;
      const excerpt = extractRelevantExcerpt(result.content, query, 300);
      response += `${excerpt}\n\n`;
      response += `**[📖 Read full page](${result.url})**\n\n`;
    });

    return response;
  }
}

export async function initializeConfluence() {
  if (!CONFLUENCE_URL || !CONFLUENCE_USER || !CONFLUENCE_API_TOKEN) {
    console.log('⚠️  Confluence integration disabled: Missing required environment variables');
    console.log('Set CONFLUENCE_URL, CONFLUENCE_USER, and CONFLUENCE_API_TOKEN to enable Confluence integration');
    return false;
  }

  try {
    console.log('🚀 Initializing Confluence integration...');
    
    // Test connection first
    const connectionSuccess = await testConfluenceConnection();
    if (!connectionSuccess) {
      console.log('❌ Confluence connection test failed');
      return false;
    }

    // Auto-index if enabled and main page ID is set
    if (CONFLUENCE_AUTO_INDEX && CONFLUENCE_MAIN_PAGE_ID) {
      console.log('📚 Auto-indexing enabled, starting indexing process...');
      try {
        const indexResult = await autoIndexMainPage();
        if (indexResult) {
          console.log(`✅ Confluence auto-indexing completed successfully!`);
          console.log(`   📊 Indexed ${indexResult.totalIndexed} pages total`);
          return true;
        }
      } catch (indexError) {
        console.error('❌ Auto-indexing failed:', indexError.message);
        console.log('   📝 You can still manually index pages or refresh content later');
        return true; // Connection works, just indexing failed
      }
    } else {
      console.log('📝 Auto-indexing disabled or no main page ID set');
      console.log('   Use CONFLUENCE_AUTO_INDEX=true and set CONFLUENCE_MAIN_PAGE_ID to enable auto-indexing');
    }

    return true;
  } catch (error) {
    console.error('❌ Confluence initialization failed:', error.message);
    return false;
  }
}

// Test Confluence connection
async function testConfluenceConnection() {
  try {
    console.log("Testing Confluence connection...");
    const spaces = await callConfluenceApi("/space", { limit: 1 });
    console.log(`Successfully connected to Confluence! Found ${spaces.size || 0} accessible spaces.`);
    return true;
  } catch (error) {
    console.error("Failed to connect to Confluence:", error);
    return false;
  }
}


// CONFLUENCE FUNCTIONALITY END
