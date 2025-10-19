const fs = require('fs');
const { createCanvas } = require('canvas');

function createIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    // Draw envelope icon
    ctx.fillStyle = 'white';
    const padding = size * 0.2;
    const envWidth = size - (padding * 2);
    const envHeight = envWidth * 0.7;
    const startX = padding;
    const startY = (size - envHeight) / 2;
    
    // Envelope body
    ctx.fillRect(startX, startY, envWidth, envHeight);
    
    // Envelope flap
    ctx.fillStyle = '#667eea';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + envWidth / 2, startY + envHeight / 2);
    ctx.lineTo(startX + envWidth, startY);
    ctx.closePath();
    ctx.fill();
    
    return canvas.toBuffer('image/png');
}

// Create all three icon sizes
try {
    const sizes = [16, 48, 128];
    sizes.forEach(size => {
        const buffer = createIcon(size);
        fs.writeFileSync(`icons/icon${size}.png`, buffer);
        console.log(`✅ Created icon${size}.png`);
    });
    console.log('🎉 All icons created successfully!');
} catch (error) {
    console.error('Error creating icons:', error.message);
    console.log('\n⚠️  Falling back to simple solid color icons...\n');
    
    // Fallback: Create minimal valid PNG files
    const simplePNG = (size) => {
        // Minimal 1x1 purple PNG, we'll just copy it for each size
        // This is a base64 encoded 1x1 purple PNG
        const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        return Buffer.from(base64, 'base64');
    };
    
    [16, 48, 128].forEach(size => {
        fs.writeFileSync(`icons/icon${size}.png`, simplePNG(size));
        console.log(`✅ Created simple icon${size}.png`);
    });
}


