// jira-test.js - A standalone script to test Jira connection
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Log environment variables (without exposing tokens)
console.log(`JIRA_URL: ${process.env.JIRA_URL}`);
console.log(`JIRA_USER: ${process.env.JIRA_USER ? "is set" : "is NOT set"}`);
console.log(`JIRA_API_TOKEN: ${process.env.JIRA_API_TOKEN ? "is set" : "is NOT set"}`);
console.log(`JIRA_PROJECT_KEY: ${process.env.JIRA_PROJECT_KEY}`);

// Authentication setup
const auth = {
  username: process.env.JIRA_USER,
  password: process.env.JIRA_API_TOKEN
};

// Function to test authentication
async function testAuth() {
  try {
    console.log("\nTesting authentication...");
    const response = await axios.get(`${process.env.JIRA_URL}/rest/api/3/myself`, { auth });
    console.log(`✅ Authentication successful! Logged in as: ${response.data.displayName}`);
    console.log(`Account ID: ${response.data.accountId}`);
    console.log(`Email: ${response.data.emailAddress}`);
    return true;
  } catch (error) {
    console.error("❌ Authentication failed!");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Function to list all accessible projects
async function listProjects() {
  try {
    console.log("\nListing all accessible projects...");
    const response = await axios.get(`${process.env.JIRA_URL}/rest/api/3/project`, { auth });
    console.log(`✅ Found ${response.data.length} projects:`);
    response.data.forEach(project => {
      console.log(`- ${project.key}: ${project.name}`);
    });
    
    // Check if our project key exists in the list
    const projectExists = response.data.some(p => p.key === process.env.JIRA_PROJECT_KEY);
    if (projectExists) {
      console.log(`✅ Project ${process.env.JIRA_PROJECT_KEY} was found in the list!`);
    } else {
      console.log(`❌ Project ${process.env.JIRA_PROJECT_KEY} was NOT found in the list!`);
    }
    
    return response.data;
  } catch (error) {
    console.error("❌ Failed to list projects!");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }
    return [];
  }
}

// Function to try different method of accessing a project
async function testProjectAccess() {
  const projectKey = process.env.JIRA_PROJECT_KEY;
  console.log(`\nTesting access to project: ${projectKey}`);
  
  // Method 1: Direct project access
  try {
    console.log("Method 1: Direct project API...");
    const response = await axios.get(`${process.env.JIRA_URL}/rest/api/3/project/${projectKey}`, { auth });
    console.log(`✅ Success! Project name: ${response.data.name}`);
  } catch (error) {
    console.error("❌ Direct project access failed!");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
  
  // Method 2: JQL search with quotes
  try {
    console.log("\nMethod 2: JQL with double quotes...");
    const response = await axios.get(`${process.env.JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: `project = "${projectKey}"`,
        maxResults: 1
      },
      auth
    });
    console.log(`✅ Success! Found ${response.data.total} issues.`);
  } catch (error) {
    console.error("❌ JQL with quotes failed!");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
  
  // Method 3: JQL search without quotes
  try {
    console.log("\nMethod 3: JQL without quotes...");
    const response = await axios.get(`${process.env.JIRA_URL}/rest/api/3/search`, {
      params: {
        jql: `project = ${projectKey}`,
        maxResults: 1
      },
      auth
    });
    console.log(`✅ Success! Found ${response.data.total} issues.`);
  } catch (error) {
    console.error("❌ JQL without quotes failed!");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
  
  // Method 4: Try API version 2
  try {
    console.log("\nMethod 4: Using API v2...");
    const response = await axios.get(`${process.env.JIRA_URL}/rest/api/2/search`, {
      params: {
        jql: `project = "${projectKey}"`,
        maxResults: 1
      },
      auth
    });
    console.log(`✅ Success! Found ${response.data.total} issues.`);
  } catch (error) {
    console.error("❌ API v2 failed!");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

// Run all the tests
async function runTests() {
  const authSuccess = await testAuth();
  if (!authSuccess) {
    console.error("\n⛔ Authentication failed. Cannot continue tests.");
    return;
  }
  
  const projects = await listProjects();
  await testProjectAccess();
  
  console.log("\n=== Test Summary ===");
  const projectExists = projects.some(p => p.key === process.env.JIRA_PROJECT_KEY);
  if (projectExists) {
    console.log(`✅ Project ${process.env.JIRA_PROJECT_KEY} is accessible to your API user.`);
  } else {
    console.log(`❌ Project ${process.env.JIRA_PROJECT_KEY} is NOT accessible to your API user.`);
    console.log("Suggestions:");
    console.log("1. Check if you're using the correct project key (case sensitive)");
    console.log("2. Verify API token permissions");
    console.log("3. Check if the project is in a different Jira instance");
  }
}

// Run the tests
runTests().catch(error => {
  console.error("An unexpected error occurred:", error);
});