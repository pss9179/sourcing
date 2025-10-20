// Content script for CadenceFlow app (http://localhost:8081)
// This allows the extension popup to get the auth token from localStorage

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getAuthToken') {
        const token = localStorage.getItem('authToken');
        sendResponse({ token: token });
    }
    
    if (request.action === 'contactAdded') {
        console.log('🎉 New contact added:', request.contact);
        
        // Show a toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px 30px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            animation: slideInRight 0.4s ease-out;
            max-width: 400px;
        `;
        
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="font-size: 32px;">🎯</div>
                <div>
                    <div style="font-weight: 700; font-size: 16px; margin-bottom: 5px;">
                        Contact Added to Cadence!
                    </div>
                    <div style="font-size: 14px; opacity: 0.9;">
                        ${request.contact.name} from ${request.contact.company || 'Unknown Company'}
                    </div>
                    <div style="font-size: 12px; opacity: 0.7; margin-top: 3px;">
                        📧 ${request.contact.email}
                    </div>
                </div>
            </div>
        `;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(toast);
        
        // Remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideInRight 0.4s ease-out reverse';
            setTimeout(() => toast.remove(), 400);
        }, 5000);
        
        sendResponse({ success: true });
    }
    
    return true; // Keep the message channel open for async response
});

console.log('✅ CadenceFlow extension connected to main app');

