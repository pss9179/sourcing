// LinkedIn Profile Data Extractor for CadenceFlow

console.log('🚀 CadenceFlow LinkedIn Extension Loaded');

// Function to extract profile data from LinkedIn
async function extractLinkedInData() {
    const data = {
        firstName: '',
        lastName: '',
        fullName: '',
        company: '',
        companyDomain: '',
        title: '',
        email: '',
        linkedinUrl: window.location.href,
        rawCompany: '' // Store original company name before GPT processing
    };

    try {
        // Extract name - simple and direct
        const nameElement = document.querySelector('h1');
        if (nameElement) {
            data.fullName = nameElement.textContent.trim();
            
            // Remove anything in parentheses for cleaner name parsing
            const cleanName = data.fullName.replace(/\([^)]*\)/g, '').trim();
            const nameParts = cleanName.split(' ');
            data.firstName = nameParts[0] || '';
            data.lastName = nameParts.slice(1).join(' ') || '';
        }

        // Extract title and company - find ANY text that looks like a headline
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            const text = div.textContent.trim();
            
            // Look for patterns like "CEO @ Company" or "Title at Company"
            if ((text.includes(' @ ') || text.includes(' at ')) && text.length > 5 && text.length < 300) {
                console.log('Found subtitle text:', text);
                
                // Parse "CEO @ Company" format
                if (text.includes(' @ ')) {
                    const parts = text.split(' @ ');
                    data.title = parts[0].trim();
                    // Get everything after @ but before any comma
                    const companyPart = parts[1].split(',')[0].trim();
                    data.rawCompany = companyPart; // Store raw company name
                    data.company = companyPart; // Will be updated by GPT
                    break;
                }
                // Parse "Title at Company" format
                else if (text.includes(' at ')) {
                    const parts = text.split(' at ');
                    data.title = parts[0].trim();
                    data.rawCompany = parts[1].split(',')[0].trim(); // Store raw company name
                    data.company = parts[1].split(',')[0].trim(); // Will be updated by GPT
                    break;
                }
            }
        }

        // Use GPT to parse and verify company name
        if (data.rawCompany && data.fullName && data.title) {
            try {
                console.log(`🤖 Sending company name to GPT for parsing: "${data.rawCompany}"`);
                
                const response = await fetch('http://localhost:3000/api/parse-company', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                    },
                    body: JSON.stringify({
                        rawCompanyName: data.rawCompany,
                        personName: data.fullName,
                        personTitle: data.title
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        console.log(`✅ GPT parsed company: "${result.originalName}" → "${result.cleanedName}"`);
                        console.log(`📊 Confidence: ${result.confidence}, Real Company: ${result.isRealCompany}`);
                        console.log(`💭 Reasoning: ${result.reasoning}`);
                        
                        data.company = result.cleanedName;
                        data.companyParsed = true;
                        data.companyConfidence = result.confidence;
                        data.companyIsReal = result.isRealCompany;
                    } else {
                        console.log(`⚠️ GPT parsing failed: ${result.error}, using original: "${data.rawCompany}"`);
                        data.companyParsed = false;
                    }
                } else {
                    console.log(`⚠️ GPT API error: ${response.status}, using original: "${data.rawCompany}"`);
                    data.companyParsed = false;
                }
            } catch (error) {
                console.log(`⚠️ GPT parsing error: ${error.message}, using original: "${data.rawCompany}"`);
                data.companyParsed = false;
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

// No floating button - user just clicks the extension icon in toolbar
// This is simpler and more reliable

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getProfileData') {
        // Handle async function properly
        extractLinkedInData().then(data => {
            sendResponse({ success: true, data: data });
        }).catch(error => {
            console.error('❌ Error extracting LinkedIn data:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep message channel open for async response
    }
    return true;
});

