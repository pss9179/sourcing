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
                    data.company = companyPart;
                    break;
                }
                // Parse "Title at Company" format
                else if (text.includes(' at ')) {
                    const parts = text.split(' at ');
                    data.title = parts[0].trim();
                    data.company = parts[1].split(',')[0].trim();
                    break;
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

// No floating button - user just clicks the extension icon in toolbar
// This is simpler and more reliable

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getProfileData') {
        const data = extractLinkedInData();
        sendResponse({ success: true, data: data });
    }
    return true;
});

