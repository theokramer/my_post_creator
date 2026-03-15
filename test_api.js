const fs = require('fs');

async function testApiWithLogo() {
    console.log("Sending POST request to http://localhost:3000/api/generate...");
    
    // The payload containing your automation data
    const payload = {
        caption: "PRO VIDEO EDITOR API\nNow testing with dual-image composition!\nThis features a background and a floating logo.",
        imageUrl: "https://picsum.photos/1080/1080?random=1", // Main Background
        logoUrl: "https://picsum.photos/400/200?random=2", // A mock logo image
        settings: {
            videoDuration: 3.5,       
            fadeDuration: 0.5,        
            cinemaZoom: true,         
            
            // Layout Overrides
            bgColor: "#121214",
            captionBgColor: "#09090B", 
            captionTextColor: "#3B82F6", // Accent Blue
            captionFontSize: 56,
            captionFontWeight: "800",
            
            // Image Borders
            imageBorderRadius: 24,
            imagePadding: 40,
            imageFit: "cover"
        },
        // You can even override the panning mathematically!
        override: {
            imagePanX: 0,
            imagePanY: 50,
            logoPanY: -20
        }
    };

    try {
        const response = await fetch('http://localhost:3000/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API failed with status ${response.status}: ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const outputPath = 'api_output_with_logo.webm';
        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ Success! The video with the Logo has been saved as '${outputPath}'.`);
        
    } catch (err) {
        console.error("❌ Test failed:", err);
    }
}

testApiWithLogo();
