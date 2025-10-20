// CadenceFlow Chrome Extension - Popup Script

const API_BASE = 'http://localhost:3000';
let profileData = null;
let authToken = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Popup initialized');
    await initializeExtension();
});

async function initializeExtension() {
    showLoadingView();
    
    // Step 1: Get auth token
    authToken = await getAuthToken();
    
    if (!authToken) {
        console.log('❌ No auth token found');
        showLoginView();
        return;
    }
    
    console.log('✅ Auth token found!');
    
    // Step 2: Check if we're on LinkedIn
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url || !tab.url.includes('linkedin.com/in/')) {
        showError('Please open a LinkedIn profile page first (URL should contain /in/)');
        return;
    }
    
    // Step 3: Extract profile data
    try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProfileData' });
        
        if (!response || !response.success) {
            showError('Could not extract profile data. Please refresh the LinkedIn page.');
            return;
        }
        
        profileData = response.data;
        console.log('📊 Profile data:', profileData);
        
        if (!profileData.firstName || !profileData.lastName) {
            showError('Could not extract name from profile. Please refresh the page.');
            return;
        }
        
    } catch (error) {
        console.error('Error extracting profile:', error);
        showError('Could not connect to LinkedIn page. Please refresh the page.');
        return;
    }
    
    // Step 4: Load cadences
    await loadCadences();
    
    // Step 5: Populate UI and find email
    await populateProfileData();
    
    // Step 6: Show main view
    showMainView();
}

async function getAuthToken() {
    // Try Chrome storage first
    const stored = await chrome.storage.local.get(['authToken']);
    if (stored.authToken) {
        console.log('✅ Token from storage');
        return stored.authToken;
    }
    
    // Try to get from main app tab
    try {
        const tabs = await chrome.tabs.query({});
        const appTab = tabs.find(tab => 
            tab.url && (tab.url.includes('localhost:8081') || tab.url.includes('127.0.0.1:8081'))
        );
        
        if (!appTab) {
            console.log('❌ No app tab found');
            return null;
        }
        
        console.log('🔍 Found app tab, getting token...');
        
        // Directly execute script to get localStorage token
        const results = await chrome.scripting.executeScript({
            target: { tabId: appTab.id },
            func: () => localStorage.getItem('authToken')
        });
        
        if (results && results[0] && results[0].result) {
            const token = results[0].result;
            console.log('✅ Got token from app!');
            
            // Save it to storage for next time
            await chrome.storage.local.set({ authToken: token });
            
            return token;
        }
    } catch (error) {
        console.error('Error getting token from app:', error);
    }
    
    return null;
}

async function populateProfileData() {
    document.getElementById('profileName').textContent = profileData.fullName || '-';
    document.getElementById('profileCompany').textContent = profileData.company || '-';
    document.getElementById('profileTitle').textContent = profileData.title || '-';
    
    const emailInput = document.getElementById('emailInput');
    const cadenceSelect = document.getElementById('cadenceSelect');
    const addBtn = document.getElementById('addToCadenceBtn');
    
    // Auto-find email via RocketReach
    if (profileData.firstName && profileData.lastName && profileData.company) {
        emailInput.placeholder = '🔍 Finding email via RocketReach...';
        emailInput.disabled = true;
        
        try {
            console.log('🚀 Calling RocketReach API...');
            const response = await fetch(`${API_BASE}/api/find-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    firstName: profileData.firstName,
                    lastName: profileData.lastName,
                    company: profileData.company,
                    domain: profileData.companyDomain
                })
            });
            
            console.log('Response status:', response.status);
            
            if (response.ok) {
                const result = await response.json();
                console.log('Email result:', result);
                
                if (result.email) {
                    emailInput.value = result.email;
                    profileData.email = result.email;
                    emailInput.style.borderColor = '#10B981';
                    emailInput.style.backgroundColor = '#f0fdf4';
                    console.log('✅ Found email:', result.email);
                } else if (result.suggestions && result.suggestions.length > 0) {
                    emailInput.value = result.suggestions[0];
                    emailInput.placeholder = 'Best guess - please verify';
                    console.log('💡 Using email guess:', result.suggestions[0]);
                }
            } else {
                console.error('Email API error:', await response.text());
            }
        } catch (error) {
            console.error('❌ Error finding email:', error);
        } finally {
            emailInput.disabled = false;
            emailInput.placeholder = 'Enter email address';
        }
    } else {
        emailInput.value = profileData.email || '';
        emailInput.placeholder = 'Enter email address';
    }
    
    // Enable button when email is entered
    function checkFormValid() {
        const hasEmail = emailInput.value.trim() !== '';
        const hasCadence = cadenceSelect.value !== '';
        addBtn.disabled = !(hasEmail && hasCadence);
    }
    
    emailInput.addEventListener('input', checkFormValid);
    cadenceSelect.addEventListener('change', checkFormValid);
    
    checkFormValid();
}

async function loadCadences() {
    try {
        const response = await fetch(`${API_BASE}/api/cadences`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load cadences');
        }
        
        const cadences = await response.json();
        const select = document.getElementById('cadenceSelect');
        
        if (cadences.length === 0) {
            select.innerHTML = '<option value="">No cadences available - create one first</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Select a cadence...</option>';
        cadences.forEach(cadence => {
            const option = document.createElement('option');
            option.value = cadence.id;
            option.textContent = cadence.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading cadences:', error);
        document.getElementById('cadenceSelect').innerHTML = '<option value="">Error loading cadences</option>';
    }
}

// Button click handlers
document.addEventListener('click', async (e) => {
    if (e.target.id === 'addToCadenceBtn') {
        await addToCadence();
    }
    
    if (e.target.id === 'openCadenceFlowBtn') {
        chrome.tabs.create({ url: 'http://localhost:8081' });
    }
});

async function addToCadence() {
    const emailInput = document.getElementById('emailInput');
    const cadenceSelect = document.getElementById('cadenceSelect');
    const addBtn = document.getElementById('addToCadenceBtn');
    
    const email = emailInput.value.trim();
    const cadenceId = cadenceSelect.value;
    
    if (!email || !cadenceId) {
        showStatus('Please fill in all fields', 'error');
        return;
    }
    
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';
    
    try {
        // Create/update the contact
        const contactData = {
            name: profileData.fullName,
            email: email,
            company: profileData.company,
            title: profileData.title,
            linkedinUrl: profileData.linkedinUrl,
            firstName: profileData.firstName,
            lastName: profileData.lastName
        };
        
        console.log('📤 Creating contact:', contactData);
        
        const contactResponse = await fetch(`${API_BASE}/api/contacts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(contactData)
        });
        
        if (!contactResponse.ok) {
            throw new Error('Failed to create contact');
        }
        
        const contact = await contactResponse.json();
        console.log('✅ Contact created:', contact);
        
        // Add them to the cadence
        console.log('📤 Adding to cadence...');
        const addToCadenceResponse = await fetch(`${API_BASE}/api/cadences/${cadenceId}/add-contact`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                contactId: contact.id
            })
        });
        
        if (!addToCadenceResponse.ok) {
            throw new Error('Failed to add to cadence');
        }
        
        const result = await addToCadenceResponse.json();
        console.log('✅ Added to cadence:', result);
        
        showStatus(`✅ ${profileData.fullName} added to cadence!`, 'success');
        
        setTimeout(() => {
            window.close();
        }, 1500);
        
    } catch (error) {
        console.error('❌ Error adding to cadence:', error);
        showStatus('Error: ' + error.message, 'error');
        addBtn.disabled = false;
        addBtn.textContent = 'Add to Cadence';
    }
}

function showLoadingView() {
    document.getElementById('loadingView').style.display = 'block';
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('mainView').style.display = 'none';
}

function showLoginView() {
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('mainView').style.display = 'none';
}

function showMainView() {
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('mainView').style.display = 'block';
}

function showStatus(message, type) {
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
}

function showError(message) {
    showMainView();
    showStatus(message, 'error');
}
