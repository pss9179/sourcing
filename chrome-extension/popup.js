// CadenceFlow Chrome Extension - Popup Script

const API_BASE = 'http://localhost:3000';
let profileData = null;
let authToken = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Popup initialized');
    
    // Try to get token from Chrome storage first
    chrome.storage.local.get(['authToken'], async (result) => {
        authToken = result.authToken;
        console.log('Token from storage:', authToken ? 'Found' : 'Not found');
        
        // If no token in storage, try to get it from the main app's localStorage
        if (!authToken) {
            try {
                console.log('Trying to get token from main app...');
                const tabs = await chrome.tabs.query({});
                const appTab = tabs.find(tab => 
                    tab.url && (tab.url.includes('localhost:8081') || tab.url.includes('127.0.0.1:8081'))
                );
                
                console.log('Found app tab:', appTab ? 'Yes' : 'No');
                
                if (appTab) {
                    console.log('Sending message to tab:', appTab.id);
                    
                    // Use content script to get token
                    chrome.tabs.sendMessage(appTab.id, { action: 'getAuthToken' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('Message error:', chrome.runtime.lastError.message);
                            showLoginView();
                            return;
                        }
                        
                        console.log('Response from content script:', response);
                        
                        if (response && response.token) {
                            authToken = response.token;
                            chrome.storage.local.set({ authToken: authToken });
                            console.log('✅ Got token from main app!');
                            loadPopup();
                        } else {
                            console.log('No token in response');
                            showLoginView();
                        }
                    });
                    return;
                }
                
                console.log('No app tab found, showing login view');
            } catch (error) {
                console.error('Error getting token from main app:', error);
            }
            
            showLoginView();
            return;
        }
        
        await loadPopup();
    });
});

async function loadPopup() {
    showLoadingView();
    
    try {
        // Get profile data from active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('Current tab URL:', tab.url);
        
        if (!tab.url || !tab.url.includes('linkedin.com')) {
            showError('Please open a LinkedIn profile page first');
            return;
        }
        
        if (!tab.url.includes('/in/')) {
            showError('Please navigate to a LinkedIn profile page (URL should contain /in/)');
            return;
        }
        
        console.log('Sending message to content script...');
        
        // Extract profile data from page
        try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProfileData' });
            console.log('Content script response:', response);
            
            if (response && response.success) {
                profileData = response.data;
                console.log('Profile data:', profileData);
                
                await loadCadences();
                await populateProfileData();
                showMainView();
            } else {
                showError('Could not extract profile data. Please refresh the LinkedIn page and try again.');
            }
        } catch (msgError) {
            console.error('Message error:', msgError);
            showError('Could not connect to LinkedIn page. Please refresh the page and try again.');
        }
    } catch (error) {
        console.error('Error loading popup:', error);
        showError('Error: ' + error.message);
    }
}

async function populateProfileData() {
    document.getElementById('profileName').textContent = profileData.fullName || '-';
    document.getElementById('profileCompany').textContent = profileData.company || '-';
    document.getElementById('profileTitle').textContent = profileData.title || '-';
    
    const emailInput = document.getElementById('emailInput');
    const cadenceSelect = document.getElementById('cadenceSelect');
    const addBtn = document.getElementById('addToCadenceBtn');
    
    // Auto-find email via API
    if (!profileData.email && profileData.firstName && profileData.lastName) {
        emailInput.placeholder = 'Finding email...';
        emailInput.disabled = true;
        
        try {
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
            
            if (response.ok) {
                const result = await response.json();
                if (result.email) {
                    emailInput.value = result.email;
                    profileData.email = result.email;
                    emailInput.style.borderColor = '#10B981';
                    emailInput.style.backgroundColor = '#f0fdf4';
                } else if (result.suggestions && result.suggestions.length > 0) {
                    emailInput.value = result.suggestions[0];
                    emailInput.placeholder = 'Best guess - please verify';
                }
            }
        } catch (error) {
            console.error('Error finding email:', error);
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
    
    // Check initial state
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
            select.innerHTML = '<option value="">No cadences available</option>';
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
    
    if (e.target.id === 'setTokenBtn') {
        const tokenInput = document.getElementById('manualTokenInput');
        const token = tokenInput.value.trim();
        
        if (token) {
            authToken = token;
            chrome.storage.local.set({ authToken: token }, () => {
                console.log('✅ Token manually set!');
                location.reload(); // Reload the popup
            });
        }
    }
    
    if (e.target.id === 'openCadenceFlowBtn') {
        // Just open the app - they can copy the token manually
        chrome.tabs.create({ url: 'http://localhost:8081' });
        
        // Update the view to show token instructions
        const loginView = document.getElementById('loginView');
        loginView.innerHTML = `
            <div class="login-required" style="padding: 20px;">
                <p style="margin-bottom: 15px; font-size: 14px; color: #666;">
                    ✅ App opened in new tab!
                </p>
                <p style="margin-bottom: 20px; font-size: 13px; color: #666; line-height: 1.6;">
                    Once logged in, copy your token from the app and paste it below:
                </p>
                <p style="margin-bottom: 10px; font-size: 12px; color: #999;">
                    In the app, press F12 → Console → Type: <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">localStorage.getItem('authToken')</code>
                </p>
                <input type="text" id="manualTokenInput" placeholder="Paste token here" style="width: 100%; padding: 10px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 13px; margin-bottom: 12px; font-family: monospace;">
                <button class="btn btn-primary" id="setTokenBtn" style="width: 100%; padding: 12px;">Save Token & Continue</button>
            </div>
        `;
    }
});

async function addToCadence() {
    const emailInput = document.getElementById('emailInput');
    const cadenceSelect = document.getElementById('cadenceSelect');
    const addBtn = document.getElementById('addToCadenceBtn');
    const statusMessage = document.getElementById('statusMessage');
    
    const email = emailInput.value.trim();
    const cadenceId = cadenceSelect.value;
    
    if (!email || !cadenceId) {
        showStatus('Please fill in all fields', 'error');
        return;
    }
    
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';
    
    try {
        // First, create/update the contact
        const contactData = {
            name: profileData.fullName,
            email: email,
            company: profileData.company,
            title: profileData.title,
            linkedinUrl: profileData.linkedinUrl,
            firstName: profileData.firstName,
            lastName: profileData.lastName
        };
        
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
        
        // Then, add them to the cadence
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
        
        showStatus(`✅ ${profileData.fullName} added to cadence!`, 'success');
        
        // Notify the main app tab about the new contact
        try {
            const tabs = await chrome.tabs.query({});
            const appTab = tabs.find(tab => 
                tab.url && (tab.url.includes('localhost:8081') || tab.url.includes('127.0.0.1:8081'))
            );
            
            if (appTab) {
                chrome.tabs.sendMessage(appTab.id, {
                    action: 'contactAdded',
                    contact: {
                        ...contactData,
                        id: contact.id
                    },
                    cadenceId: cadenceId
                });
                console.log('✅ Notified main app of new contact');
            }
        } catch (error) {
            console.log('Could not notify main app:', error);
        }
        
        setTimeout(() => {
            window.close();
        }, 2000);
        
    } catch (error) {
        console.error('Error adding to cadence:', error);
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


