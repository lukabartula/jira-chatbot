// test-bitbucket-auth.js
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Get credentials from .env
const BITBUCKET_USER = process.env.BITBUCKET_USER || process.env.JIRA_USER;
const BITBUCKET_API_TOKEN = process.env.BITBUCKET_API_TOKEN || process.env.JIRA_API_TOKEN;

const auth = {
  username: BITBUCKET_USER,
  password: BITBUCKET_API_TOKEN
};

// Simple function to test Bitbucket authentication without repositories
async function testBitbucketAuth() {
  console.log('====== Bitbucket Authentication Test ======');
  console.log(`Using username: ${BITBUCKET_USER}`);
  console.log(`API token: ${BITBUCKET_API_TOKEN ? '********' + BITBUCKET_API_TOKEN.slice(-4) : 'Not provided'}`);
  console.log('==========================================');

  try {
    // Test 1: Simple user endpoint
    console.log('\n[1] Testing user authentication...');
    try {
      const userResponse = await axios.get('https://api.bitbucket.org/2.0/user', {
        auth: auth
      });
      
      console.log('✅ Authentication successful!');
      console.log(`Connected as: ${userResponse.data.display_name} (${userResponse.data.username})`);
      console.log(`Account ID: ${userResponse.data.account_id}`);
      return true;
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error('Error details:', error.response.data.error || error.response.data);
      }
      
      // Test 2: Try with workspace listing as fallback
      console.log('\n[2] Trying workspace listing as fallback...');
      try {
        const workspacesResponse = await axios.get('https://api.bitbucket.org/2.0/workspaces', {
          auth: auth
        });
        
        console.log('✅ Authentication successful!');
        const workspaces = workspacesResponse.data.values || [];
        console.log(`You have access to ${workspaces.length} workspaces.`);
        
        if (workspaces.length > 0) {
          console.log('\nWorkspaces:');
          workspaces.forEach((workspace, index) => {
            console.log(`  ${index + 1}. ${workspace.name} (${workspace.slug})`);
          });
        }
        return true;
      } catch (secondError) {
        console.error('❌ Authentication failed on second attempt:', secondError.message);
        if (secondError.response) {
          console.error(`Status: ${secondError.response.status}`);
          console.error('Error details:', secondError.response.data.error || secondError.response.data);
        }
      }
    }
  } catch (error) {
    console.error('❌ Test execution error:', error.message);
  }
  
  console.log('\n===== Authentication Troubleshooting =====');
  console.log('1. For Atlassian API tokens:');
  console.log('   - Username should be your EMAIL ADDRESS (not username)');
  console.log('   - Token should be the API token from https://id.atlassian.com/manage-profile/security/api-tokens');
  console.log('\n2. For Bitbucket App Passwords:');
  console.log('   - Username should be your BITBUCKET USERNAME');
  console.log('   - Token should be an App Password created in Bitbucket settings');
  console.log('\n3. Check for typos and extra spaces in your credentials');
  console.log('4. Ensure your account has access to Bitbucket');
  console.log('=============================================');
  
  return false;
}

// Run the test
testBitbucketAuth().then(success => {
  if (success) {
    console.log('\n✅ Ready to proceed with Bitbucket integration!');
  } else {
    console.log('\n❌ Please fix the authentication issues before proceeding.');
  }
});