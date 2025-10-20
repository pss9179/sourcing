// LinkedIn Profile Data Extractor for CadenceFlow

console.log('🚀 CadenceFlow LinkedIn Extension Loaded');

// Function to extract profile data from LinkedIn
function extractLinkedInData() {
    const data = {
        firstName: '',
        lastName: '',
        fullName: '',
        company: '',
        companyDomain: '',
        title: '',
        email: '',
        linkedinUrl: window.location.href
    };

    try {
        // Extract name from the profile - try multiple selectors
        let nameElement = document.querySelector('h1.text-heading-xlarge');
        if (!nameElement) {
            nameElement = document.querySelector('h1[class*="text-heading"]');
        }
        if (!nameElement) {
            nameElement = document.querySelector('.pv-text-details__left-panel h1');
        }
        
        if (nameElement) {
            data.fullName = nameElement.textContent.trim();
            const nameParts = data.fullName.split(' ');
            data.firstName = nameParts[0] || '';
            data.lastName = nameParts.slice(1).join(' ') || '';
        }

        // Extract title and company - try multiple methods
        // Method 1: Look for the subtitle/headline
        let subtitleElement = document.querySelector('.text-body-medium.break-words');
        if (!subtitleElement) {
            subtitleElement = document.querySelector('.pv-text-details__left-panel .text-body-medium');
        }
        if (!subtitleElement) {
            subtitleElement = document.querySelector('[class*="pv-top-card"] [class*="text-body-medium"]');
        }
        
        if (subtitleElement) {
            const text = subtitleElement.textContent.trim();
            console.log('Found subtitle text:', text);
            
            // Try to parse "Title at Company" format
            const atIndex = text.indexOf(' at ');
            if (atIndex !== -1) {
                data.title = text.substring(0, atIndex).trim();
                data.company = text.substring(atIndex + 4).trim();
            } else {
                // If no "at", might just be the title
                data.title = text;
            }
        }

        // Method 2: Look in the experience section
        if (!data.company) {
            const experienceSection = document.querySelector('.pv-top-card--experience-list');
            if (experienceSection) {
                const companyElement = experienceSection.querySelector('.text-body-medium');
                if (companyElement) {
                    data.company = companyElement.textContent.trim();
                }
            }
        }
        
        // Method 3: Try to find company from any visible text
        if (!data.company) {
            const allTextElements = document.querySelectorAll('.pv-text-details__left-panel div');
            for (const el of allTextElements) {
                const text = el.textContent.trim();
                if (text.includes(' at ') && text.length < 200) {
                    const parts = text.split(' at ');
                    if (parts.length === 2) {
                        data.company = parts[1].trim();
                        if (!data.title) data.title = parts[0].trim();
                        break;
                    }
                }
            }
        }

        // Try to find email from contact info (if available)
        const contactSection = document.querySelector('section[data-section="contact"]');
        if (contactSection) {
            const emailLink = contactSection.querySelector('a[href^="mailto:"]');
            if (emailLink) {
                data.email = emailLink.href.replace('mailto:', '');
            }
        }
        
        // Try to extract company website/domain
        // Check for website link in the experience section
        const companyLinks = document.querySelectorAll('a[href*="http"]');
        for (const link of companyLinks) {
            const href = link.href;
            // Look for company website (exclude linkedin, social media, etc)
            if (href && 
                !href.includes('linkedin.com') && 
                !href.includes('twitter.com') &&
                !href.includes('facebook.com') &&
                !href.includes('instagram.com')) {
                try {
                    const url = new URL(href);
                    data.companyDomain = url.hostname.replace('www.', '');
                    break;
                } catch (e) {
                    // Invalid URL, continue
                }
            }
        }
        
        // If no domain found, try to guess from company name
        if (!data.companyDomain && data.company) {
            // Simple guess: company name -> domain
            data.companyDomain = data.company.toLowerCase()
                .replace(/[^a-z0-9]/g, '') + '.com';
            console.log(`💡 Guessing domain: ${data.companyDomain}`);
        }

        console.log('📊 Extracted LinkedIn Data:', data);
        return data;
    } catch (error) {
        console.error('❌ Error extracting LinkedIn data:', error);
        return data;
    }
}

// Add floating button to LinkedIn profile pages
function addCadenceFlowButton() {
    // Check if we're on a profile page
    if (!window.location.pathname.startsWith('/in/')) {
        return;
    }

    // Check if button already exists
    if (document.getElementById('cadenceflow-btn')) {
        return;
    }

    // Create the floating button
    const button = document.createElement('button');
    button.id = 'cadenceflow-btn';
    button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
        <span>Add to Cadence</span>
    `;
    button.className = 'cadenceflow-button';
    
    button.addEventListener('click', async () => {
        button.classList.add('loading');
        button.innerHTML = '<span>Extracting...</span>';
        
        const profileData = extractLinkedInData();
        
        // Send data to extension popup
        chrome.runtime.sendMessage({
            action: 'openCadenceSelector',
            data: profileData
        });
        
        setTimeout(() => {
            button.classList.remove('loading');
            button.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                </svg>
                <span>Add to Cadence</span>
            `;
        }, 1000);
    });

    document.body.appendChild(button);
}

// Run when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addCadenceFlowButton);
} else {
    addCadenceFlowButton();
}

// Re-run when navigating within LinkedIn (SPA behavior)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(addCadenceFlowButton, 1000);
    }
}).observe(document, { subtree: true, childList: true });

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getProfileData') {
        const data = extractLinkedInData();
        sendResponse({ success: true, data: data });
    }
    return true;
});

