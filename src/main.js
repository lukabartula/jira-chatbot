import "./style.scss";

const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

// Get project name from the header to use in welcome message
const projectName = document.querySelector(".bg-accent span").textContent.split("–")[1]?.trim() || "IHKA";

// Enhanced welcome messages with more specific examples
const welcomeMessages = [
  `👋 Welcome to Jira Assistant for Project ${projectName}!`,
  "I can help you check project status, track tasks, find assignees, and more.",
  "Try asking questions like:\n• What's the status of our project?\n• Show me open tasks assigned to Sarah\n• Are there any blockers in the current sprint?\n• What task is IHKA-201?\n• What's due this week?",
];

// Bot is typing indicator
function showTypingIndicator() {
  const wrapper = document.createElement("div");
  wrapper.className = "flex justify-start";
  wrapper.id = "typing-indicator";

  const bubble = document.createElement("div");
  bubble.className = "max-w-[75%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap shadow-md bg-bubbleBot text-white animate-fade-in";
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  wrapper.appendChild(bubble);
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) indicator.remove();
}

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Enhanced message formatting function with improved markdown handling
function appendMessage(content, sender = "user") {
  const wrapper = document.createElement("div");
  wrapper.className = `${sender === "user" ? "flex justify-end" : "flex justify-start"}`;

  const bubble = document.createElement("div");
  bubble.className = `max-w-[85%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap shadow-md animate-fade-in relative ${
    sender === "user" ? "bg-bubbleUser text-white" : "bg-bubbleBot text-white"
  }`;

  if (sender === "bot" && content.startsWith("## ")) {
    bubble.className = `max-w-[85%] px-4 py-3 rounded-2xl text-sm shadow-md animate-fade-in relative bg-gray-800 text-white border border-gray-700`;
  }

  const timestamp = document.createElement("span");
  timestamp.textContent = formatTime();
  timestamp.className = "absolute -bottom-5 right-3 text-xs text-gray-400";

  if (sender === "bot") {
    const formattedContent = content
      // Markdown headers
      .replace(/^## (.*?)$/gm, '<h2 class="text-lg font-bold my-2">$1</h2>')
      .replace(/^### (.*?)$/gm, '<h3 class="text-base font-bold my-1">$1</h3>')

      // Markdown links [IHKA-201](...)
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">$1</a>'
      )

      // Line breaks
      .replace(/\n+/g, "<br>")

      // Bold, italic, code
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-gray-800 px-1 rounded text-xs">$1</code>')

      // Lists and tasks
      .replace(/^- (.*)/gm, '<span class="block ml-1">• $1</span>')
      .replace(/^• (.*)/gm, '<span class="block ml-1">• $1</span>')

      // Field blocks (optional formatting)
      .replace(
        /\*\*([^:]*)\*\*: (.*?)(?=<br>\*\*|$)/g,
        '<div class="flex"><span class="font-bold min-w-24">$1:</span><span>$2</span></div>'
      );

    bubble.innerHTML = formattedContent;
  } else {
    bubble.textContent = content;
  }

  bubble.appendChild(timestamp);
  wrapper.appendChild(bubble);
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;
}


function suggestVisualization(content, intent) {
  // Only suggest for data-heavy responses
  if (intent !== 'PROJECT_STATUS' && intent !== 'WORKLOAD' && intent !== 'TIMELINE') return;
  
  // Check if response has enough data to visualize
  if (content.split('\n').length < 10) return;
  
  setTimeout(() => {
    const vizSuggestion = document.createElement("div");
    vizSuggestion.className = "flex justify-center my-4";
    
    let suggestionText = '';
    if (intent === 'PROJECT_STATUS') {
      suggestionText = "View as project dashboard";
    } else if (intent === 'WORKLOAD') {
      suggestionText = "Show workload chart";
    } else if (intent === 'TIMELINE') {
      suggestionText = "View timeline visualization";
    }
    
    vizSuggestion.innerHTML = `
      <div class="px-3 py-1 text-xs bg-blue-800 text-white rounded-full cursor-pointer hover:bg-blue-700">
        <svg xmlns="http://www.w3.org/2000/svg" class="inline-block h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        ${suggestionText}
      </div>
    `;
    
    // For now just show an alert - you'd implement the actual visualization later
    vizSuggestion.querySelector('div').addEventListener('click', () => {
      alert('Visualization feature coming soon!');
    });
    
    chatBox.appendChild(vizSuggestion);
    chatBox.scrollTop = chatBox.scrollHeight;
  }, 800);
}

// Show welcome messages with typewriter effect
function displayWelcomeMessages() {
  let index = 0;

  function showNextMessage() {
    if (index < welcomeMessages.length) {
      appendMessage(welcomeMessages[index], "bot");
      index++;
      setTimeout(showNextMessage, 800);
    }
  }

  setTimeout(showNextMessage, 500);
}

// Enhanced project summary with more detailed information
async function loadProjectSummary() {
  try {
    const response = await fetch(`http://localhost:3000/api/project-summary`);
    // const response = await fetch(`${window.location.origin}/api/project-summary`);
    const data = await response.json();

    if (data) {
      let message = `📊 **Project Summary**\n`;
      message += `- Open tasks: ${data.openCount}\n`;

      if (data.highPriorityIssues && data.highPriorityIssues.length > 0) {
        message += `- High priority tasks: ${data.highPriorityIssues.length}\n`;

        // Add a brief summary of the top high priority issue
        if (data.highPriorityIssues[0]) {
          const topIssue = data.highPriorityIssues[0];
          message += `  • Top priority: ${topIssue.key}: ${topIssue.fields.summary}\n`;
        }
      }

      if (data.unassignedIssues && data.unassignedIssues.length > 0) {
        message += `- Unassigned tasks: ${data.unassignedIssues.length}\n`;
      }

      if (data.recentIssues && data.recentIssues.length > 0) {
        message += `- Recently updated: ${data.recentIssues.length} tasks\n`;

        // Add the most recently updated issue
        if (data.recentIssues[0]) {
          const recentIssue = data.recentIssues[0];
          const updatedDate = new Date(recentIssue.fields.updated).toLocaleDateString();
          message += `  • Latest update: ${recentIssue.key} (${updatedDate})`;
        }
      }

      setTimeout(() => {
        appendMessage(message, "bot");
      }, 3000); // Show after welcome messages
    }
  } catch (error) {
    console.error("Error loading project summary:", error);
    // Don't show an error message to the user on initial load
  }
}

// Enhanced function to fetch Jira data with better error handling
async function fetchJiraData(query) {
  // Show typing indicator
  showTypingIndicator();

  try {
    const response = await fetch(`http://localhost:3000/api/query`, {
    // const response = await fetch(`${window.location.origin}/api/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    // Check if request was successful
    if (!response.ok) {
      const errorData = await response.json();
      removeTypingIndicator();
      appendMessage(errorData.message || "Something went wrong with your request. Please try again.", "bot");
      return;
    }

    const data = await response.json();

    // Remove typing indicator
    removeTypingIndicator();

    if (data.message) {
      appendMessage(data.message, "bot");

      // Optional: Store intent for context in future responses
      if (data.meta && data.meta.intent) {
        window.lastQueryIntent = data.meta.intent;
        suggestVisualization(data.message, data.meta.intent);
      }
    } else {
      appendMessage("I couldn't process that request. Could you try rephrasing your question?", "bot");
    }
  } catch (error) {
    console.error("Error fetching data from Jira:", error);
    removeTypingIndicator();

    // More varied error messages
    const errorMessages = [
      "I'm having trouble connecting to Jira right now. Could you try again in a moment?",
      "Sorry, I encountered a technical issue while fetching your data. Please try again.",
      "I couldn't complete that request due to a connection issue with Jira. Let's try again.",
      "There was a problem processing your request. Can you try asking in a different way?",
    ];

    appendMessage(errorMessages[Math.floor(Math.random() * errorMessages.length)], "bot");
  }
}

// Suggest related queries based on current conversation
function suggestRelatedQueries(intent, query) {
  // Only suggest occasionally to avoid being annoying
  if (Math.random() > 0.3) return;

  const suggestions = {
    PROJECT_STATUS: ["Show me high priority tasks", "What's changed in the last week?", "Any blockers in the project?"],
    TASK_LIST: ["Who's assigned to these tasks?", "When are these due?", "Show me tasks by priority"],
    ASSIGNED_TASKS: ["What's the status of these tasks?", "When are these tasks due?", "What else is this person working on?"],
    TASK_DETAILS: ["Are there any related issues?", "Show me recent comments", "Who made the last update?"],
    BLOCKERS: ["Who's working on resolving these?", "When were these blockers identified?", "Are any blockers close to resolution?"],
    TIMELINE: ["What's due next week?", "Are we on track with deadlines?", "Any overdue tasks?"],
  };

  if (intent && suggestions[intent]) {
    const options = suggestions[intent];
    const suggestion = options[Math.floor(Math.random() * options.length)];

    setTimeout(() => {
      const suggestionBubble = document.createElement("div");
      suggestionBubble.className = "flex justify-center my-4";
      suggestionBubble.innerHTML = `
        <div class="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded-full cursor-pointer hover:bg-gray-600" 
             onclick="document.getElementById('user-input').value='${suggestion}'; document.getElementById('send-btn').click()">
          Try asking: "${suggestion}"
        </div>
      `;
      chatBox.appendChild(suggestionBubble);
      chatBox.scrollTop = chatBox.scrollHeight;
    }, 1000);
  }
}

// Handle sending user messages
function handleSendMessage() {
  const question = userInput.value.trim();
  if (!question) return;

  appendMessage(question, "user");
  userInput.value = "";

  // Fetch data based on the question
  fetchJiraData(question);
}

// Event Listeners
sendBtn.addEventListener("click", handleSendMessage);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSendMessage();
});

// Auto-focus the input field on page load
userInput.focus();

// Initialize the chat
document.addEventListener("DOMContentLoaded", () => {
  displayWelcomeMessages();
  loadProjectSummary();
});
