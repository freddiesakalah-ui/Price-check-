// =========================================================================
// 1. ALL IMPORTS (Using CommonJS require)
// =========================================================================
const express = require('express');
const Airtable = require('airtable');
const multer = require('multer');
const FormData = require('form-data');
const crypto = require('crypto');
const cors = require('cors');

// 1. Initialize Express App ONCE
const app = express();

// Add this middleware configuration
app.use(cors({
    origin: [
        'https://freddiesakalah-ui.github.io',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

//  app.use(express.json());

// =========================================================================
// 2. EXPRESS & MIDDLEWARE INITIALIZATION
// =========================================================================
// const app = express();
app.use(express.json({ limit: '10mb' }));

// Memory storage setup for Mailgun CSV attachments
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// Environment Variables
const PORT = process.env.PORT || 3000;
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const AIRTABLE_TOKEN = process.env.AIRTABLE_ACCESS_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID; // Base ID: appwQZHTlwlpuDBUa
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;


// =========================================================================
// 3. YOUR EXISTING WORKING DIALOGFLOW CODE (FROM SCREENSHOT 1)
// =========================================================================
app.post('/', async (req, res) => {
  // -----------------------------------------------------------------------
  // KEEP ALL YOUR WORKING DIALOGFLOW FULFILLMENT LOGIC HERE EXACTLY AS IT IS
  // -----------------------------------------------------------------------
const express = require('express');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

// Initialize Airtable using environment variables
const base = new Airtable({ apiKey: process.env.AIRTABLE_ACCESS_TOKEN }).base(process.env.AIRTABLE_BASE_ID);

// Google Maps API Key for Geocoding
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Webhook server is running! 🚀');
});

// Main Dialogflow CX Webhook Route
app.post('/webhook', async (req, res) => {
    const body = req.body;
    const tag = body.fulfillmentInfo?.tag;
    const sessionParameters = body.sessionInfo?.parameters || {};

    // =========================================================================
    // FEATURE 1: Google Maps Reverse Geocoding (tag: "reverseGeocode")
    // =========================================================================
    if (tag === 'reverseGeocode') {
        const lat = sessionParameters.lat;
        const lng = sessionParameters.lng;

        if (!lat || !lng) {
            return res.status(200).json({
                sessionInfo: { parameters: { ...sessionParameters } }
            });
        }

        try {
            const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
            const apiRes = await fetch(geocodeUrl);
            const apiData = await apiRes.json();
            const results = apiData.results;

            let city = '';
            let subLocation = '';

            if (results && results.length > 0) {
                for (const component of results[0].address_components) {
                    if (component.types.includes('sublocality') || component.types.includes('neighborhood')) {
                        subLocation = component.long_name;
                    }
                    if (component.types.includes('locality')) {
                        city = component.long_name;
                    }
                }
            }

            return res.status(200).json({
                sessionInfo: {
                    parameters: {
                        ...sessionParameters,
                        city: city || sessionParameters.city || '',
                        sub_location: subLocation || sessionParameters.sub_location || sessionParameters.sublocation || ''
                    }
                },
                fulfillment_response: {
                    messages: [
                        {
                            text: {
                                text: [`📍 Location detected: ${subLocation ? subLocation + ', ' : ''}${city}`]
                            }
                        }
                    ]
                }
            });
        } catch (error) {
            console.error('Reverse Geocoding Error:', error.message);
            return res.status(200).json({
                sessionInfo: { parameters: { ...sessionParameters } }
            });
        }
    }

    // =========================================================================
    // FEATURE 2: Airtable Price Search & Basket Management (Default Search)
    // =========================================================================
    
    // Extract all parameters from Dialogflow CX session
    const product = (sessionParameters.product || '').trim();
    const city = (sessionParameters.city || '').trim();
    const subLocation = (sessionParameters.sub_location || sessionParameters.sublocation || '').trim();
    const brand = (sessionParameters.brand || '').trim();
    const flavour = (sessionParameters.flavour || sessionParameters.flavor || '').trim();
    const unit = (sessionParameters.unit || '').trim();

    // Retrieve existing cart/history from session parameters or initialize an empty array
    let cart = Array.isArray(sessionParameters.cart) ? sessionParameters.cart : [];

    try {
        let formulaConditions = [
            `FIND(LOWER("${product}"), LOWER(ARRAYJOIN({Product}, ",")))`,
            `FIND(LOWER("${city}"), LOWER(ARRAYJOIN({City}, ",")))`,
            `{Availability} = 'In Stock'`,
            `{Outdated Flag} = 'NO'`
        ];

        if (subLocation) {
            formulaConditions.push(`FIND(LOWER("${subLocation}"), LOWER(ARRAYJOIN({Sub_Location}, ",")))`);
        }

        if (brand && brand.toLowerCase() !== 'any') {
            formulaConditions.push(`FIND(LOWER("${brand}"), LOWER(ARRAYJOIN({Brand}, ",")))`);
        }

        if (flavour && flavour.toLowerCase() !== 'any') {
            formulaConditions.push(`FIND(LOWER("${flavour}"), LOWER(ARRAYJOIN({Flavour}, ",")))`);
        }

        if (unit && unit.toLowerCase() !== 'any') {
            formulaConditions.push(`FIND(LOWER("${unit}"), LOWER(ARRAYJOIN({Unit}, ",")))`);
        }

        const formula = `AND(${formulaConditions.join(', ')})`;

        const records = await base('Prices').select({
            filterByFormula: formula,
            sort: [{ field: 'Price USD', direction: 'asc' }]
        }).firstPage();

        let responseText = "";

        const unitLabel = (unit && unit.toLowerCase() !== 'any') ? `${unit} ` : '';
        const brandLabel = (brand && brand.toLowerCase() !== 'any') ? `${brand} ` : '';
        const flavourLabel = (flavour && flavour.toLowerCase() !== 'any') ? `${flavour} ` : '';
        const fullProductTitle = `${unitLabel}${brandLabel}${flavourLabel}${product}`.trim();
        const locationLabel = subLocation ? `${subLocation}, ${city}` : city;

        if (!records || records.length === 0) {
            responseText = `❌ Sorry, no live in-stock prices found for **${fullProductTitle}** in ${locationLabel}.\n\n`;
        } else {
            responseText = `📊 **Price Comparison: ${fullProductTitle}**\n📍 *${locationLabel}*\n\n`;
            const medals = ['🥇', '🥈', '🥉'];

            records.forEach((record, index) => {
                const medal = medals[index] || '🔹';

                const shopLookup = record.get('shop_name');
                const rawShop = record.get('Shop');
                let shopName = '';

                if (Array.isArray(shopLookup) && shopLookup.length > 0) {
                    shopName = shopLookup[0];
                } else if (typeof shopLookup === 'string' && shopLookup.trim() !== '') {
                    shopName = shopLookup;
                } else if (Array.isArray(rawShop) && rawShop.length > 0) {
                    shopName = rawShop[0];
                } else if (typeof rawShop === 'string') {
                    shopName = rawShop;
                }

                if (!shopName || shopName.startsWith('rec')) {
                    shopName = 'Store';
                }

                const price = Number(record.get('Price USD') || 0);
                const timestamp = record.get('Formatted_Timestamp') || '';
                const timeDisplay = timestamp ? ` _(Updated: ${timestamp})_` : '';

                responseText += `${medal} **${shopName}**: $${price.toFixed(2)}${index === 0 ? ' (Cheapest! 🥳)' : ''}${timeDisplay}\n`;

                if (index === 0) {
                    const cartItem = {
                        item: fullProductTitle,
                        shop: shopName,
                        price: price,
                        timestamp: timestamp
                    };
                    cart.push(cartItem);
                }
            });
        }

        let totalCost = cart.reduce((sum, entry) => sum + entry.price, 0);

        let cartSummary = "";
        if (cart.length > 0) {
            cartSummary += `\n──────────────────────────────\n🛒 **Your Saved Search Basket:**\n`;
            cart.forEach((c, i) => {
                cartSummary += `  ${i + 1}. ${c.item} - **${c.shop}**: $${c.price.toFixed(2)}${c.timestamp ? ` [${c.timestamp}]` : ''}\n`;
            });
            cartSummary += `\n💰 **TOTAL BUDGET COST: $${totalCost.toFixed(2)}**\n`;
        }

        responseText += `${cartSummary}\n💭 *Would you like to check another item or end here?*\n• Type a new item (e.g., "Sugar")\n• Type "Exit" or "Done" to finish`;

        return res.status(200).json({
            sessionInfo: {
                parameters: {
                    ...sessionParameters,
                    cart: cart
                }
            },
            fulfillment_response: {
                messages: [
                    {
                        text: {
                            text: [responseText]
                        }
                    }
                ]
            }
        });

    } catch (err) {
        console.error('Airtable Query Error:', err);
        return res.status(200).json({
            fulfillment_response: {
                messages: [
                    {
                        text: {
                            text: ["An error occurred while fetching prices. Please try again later."]
                        }
                    }
                ]
            }
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Webhook active on port ${PORT}`));


    
});


// =========================================================================
// 4. NEW MAILGUN EMAIL INGESTION ROUTE
// =========================================================================
app.post('/api/email-ingest', upload.any(), async (req, res) => {
  try {
    const senderEmail = (req.body.sender || req.body.from || '').toLowerCase().trim();
    const subject = req.body.subject || '';
    const files = req.files || [];

    // 1. Find CSV File
    const csvFile = files.find(f => f.originalname && f.originalname.endsWith('.csv'));
    if (!csvFile) return res.status(200).send('No CSV attachment found.');

    // 2. Extract PIN from Subject
    const pinMatch = subject.match(/PIN:\s*(\d{4,6})/i);
    const providedPin = pinMatch ? pinMatch[1] : null;

    if (!providedPin) {
      await sendOutboundEmail(senderEmail, 'Update Failed: Missing PIN', 'Submission rejected: Missing PIN in subject.');
      return res.status(200).send('Missing PIN');
    }

    // 3. Authenticate Shop Credentials against "Shops" Table
    const shopFormula = encodeURIComponent(`AND({Authorized Email} = '${senderEmail}', {Security PIN} = '${providedPin}', {Active} = 1)`);
    const shopRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Shops?filterByFormula=${shopFormula}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const shopData = await shopRes.json();

    if (!shopData.records || shopData.records.length === 0) {
      await sendOutboundEmail(senderEmail, 'Update Failed', 'Unauthorized email or invalid PIN.');
      return res.status(200).send('Unauthorized');
    }

    const shop = shopData.records[0].fields;
    const shopId = shop['Shop ID'];
    const city = shop['City'] || '';
    const subLocation = shop['Sub Location'] || '';

    // 4. Archive Historical Prices in "Prices" Table
    const oldFormula = encodeURIComponent(`AND({Shop ID} = '${shopId}', {Outdated Flag} = 'NO')`);
    const oldRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Prices?filterByFormula=${oldFormula}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const oldData = await oldRes.json();

    if (oldData.records && oldData.records.length > 0) {
      const archiveBatch = oldData.records.map(r => ({ id: r.id, fields: { 'Outdated Flag': 'YES' } }));
      for (let i = 0; i < archiveBatch.length; i += 10) {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/Prices`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: archiveBatch.slice(i, i + 10) })
        });
      }
    }

    // 5. Parse CSV Buffer & Write Clean Items
    const csvText = csvFile.buffer.toString('utf-8');
    const lines = csvText.split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    const newRecords = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].split(',').map(c => c.trim());

      const product = cols[headers.indexOf('product')] || '';
      const brand = cols[headers.indexOf('brand')] || '';
      const flavour = cols[headers.indexOf('flavour')] || cols[headers.indexOf('flavor')] || '';
      const unit = cols[headers.indexOf('unit')] || 'Each';
      const rawPrice = cols[headers.indexOf('price_usd')] || cols[headers.indexOf('price')] || '0';
      const cleanPrice = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));

      if (product && !isNaN(cleanPrice) && cleanPrice > 0) {
        newRecords.push({
          fields: {
            'Shop ID': [shopData.records[0].id],
            'Product': product,
            'Brand': brand,
            'Flavour': flavour,
            'Unit': unit,
            'Price': cleanPrice,
            'City': city,
            'Sub Location': subLocation,
            'Availability': 'In Stock',
            'Outdated Flag': 'NO',
            'Status': 'Approved'
          }
        });
      }
    }

    for (let i = 0; i < newRecords.length; i += 10) {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/Prices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: newRecords.slice(i, i + 10) })
      });
    }

    await sendOutboundEmail(senderEmail, 'Update Successful', `Processed ${newRecords.length} items for Shop ID ${shopId}.`);
    return res.status(200).send('Ingestion Complete');

  } catch (error) {
    console.error('[Email Ingest Error]:', error);
    return res.status(500).send('Internal Server Error');
  }
});


// =========================================================================
// 5. NEW ADMIN ONBOARDING ROUTE
// =========================================================================
app.post('/api/admin/stores', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${ADMIN_API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { shopId, shopName, managerEmail, city, subLocation } = req.body;
    const generatedPin = crypto.randomInt(1000, 10000).toString();

    const airtableRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Shops`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{
          fields: {
         //  ==THIS LINE OF CODE IS TEMPORALILY DISABLED TO ALLOW AUTO INCREMENT OF SHOPID IN AIRTABLE =='Shop ID': shopId ? (parseInt(shopId, 10) || shopId) : '',
            'Shop Name': shopName ? String(shopName).trim() : '',
            'Authorized Email': managerEmail ? String(managerEmail).toLowerCase().trim() : '',
            'Security PIN': generatedPin,
            'City': city ? String(city).trim() : '',
            'sub_location': subLocation ? String(subLocation).trim() : '',
            'Active': true
          }
        }]
      })
    });

    if (!airtableRes.ok) {
    const errorBody = await airtableRes.text();
    console.error("Airtable API Error Details:", errorBody);
    throw new Error('Failed to create shop in Airtable');
}

    const emailBody = `Welcome ${shopName}!\n\nShop ID: ${shopId}\nSecurity PIN: ${generatedPin}\n\nTo submit price updates, send a CSV attachment to updates@${MAILGUN_DOMAIN} with Subject: "Weekly Update - PIN: ${generatedPin}"`;
    await sendOutboundEmail(managerEmail, `Shop Setup - PIN: ${generatedPin}`, emailBody);

    return res.status(201).json({ status: 'Success', shopId, securityPin: generatedPin });
  } catch (err) {
    console.error('[Onboarding Error]:', err);
    return res.status(500).json({ error: 'Onboarding failed.' });
  }
});


// Helper: Outbound Mailgun Sender
async function sendOutboundEmail(to, subject, textBody) {
  try {
    const form = new FormData();
    form.append('from', `PriceCheck Updates <postmaster@${MAILGUN_DOMAIN}>`);
    form.append('to', to);
    form.append('subject', subject);
    form.append('text', textBody);

    const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
    await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body: form
    });
  } catch (err) {
    console.error('[Mailgun Outbound Error]:', err);
  }
}
// =========================================================================
// PIN RECOVERY & OTP ENDPOINTS
// =========================================================================

// Temporary in-memory OTP storage (For MVP)
const otpStore = new Map();

// Helper to generate 6-digit numeric OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. REQUEST OTP ENDPOINT
app.post('/api/auth/pin-reset-request', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const otp = generateOTP();
        
        // Store in memory with 15-minute expiration
        otpStore.set(email.toLowerCase(), {
            otp,
            expiresAt: Date.now() + 15 * 60 * 1000
        });

        console.log(`[OTP Generated] For: ${email} | Code: ${otp}`);

        // Send OTP via Mailgun using your existing outbound sender
        await sendOutboundEmail(
            email.toLowerCase(), 
            "PriceCheck - PIN Reset Verification Code", 
            `Your secure 6-digit PIN recovery verification code is: ${otp}\n\nThis code expires in 15 minutes.`
        );

        return res.status(200).json({ success: true, message: 'Verification OTP sent successfully via Mailgun' });
    } catch (err) {
        console.error('Error in pin-reset-request:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 2. VERIFY OTP ENDPOINT
app.post('/api/auth/pin-reset-verify', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const storedRecord = otpStore.get(email?.toLowerCase());

        if (!storedRecord || storedRecord.otp !== otp || Date.now() > storedRecord.expiresAt) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP code' });
        }

        return res.status(200).json({ success: true, message: 'OTP verified successfully' });
    } catch (err) {
        console.error('Error in pin-reset-verify:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 3. UPDATE PIN ENDPOINT (Updates Airtable)
app.post('/api/auth/pin-reset-update', async (req, res) => {
    try {
        const { email, otp, newPin } = req.body;
        const storedRecord = otpStore.get(email?.toLowerCase());

        if (!storedRecord || storedRecord.otp !== otp || Date.now() > storedRecord.expiresAt) {
            return res.status(400).json({ success: false, message: 'Session expired. Please request a new OTP.' });
        }

        if (!newPin || newPin.length !== 4) {
            return res.status(400).json({ success: false, message: 'Security PIN must be exactly 4 digits' });
        }

        // Initialize Airtable base connection
        const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(process.env.AIRTABLE_BASE_ID || "appwQZHT1w1pDBUa");

        // Find the store record by email
        const records = await base('Shops').select({
            filterByFormula: `{Authorized Email} = '${email}'`
        }).firstPage();

        if (records.length === 0) {
            return res.status(404).json({ success: false, message: 'Shop authorized email not found in Airtable records' });
        }

        const recordId = records[0].id;

        // Update the Security PIN field in Airtable
        await base('Shops').update(recordId, {
            "Security PIN": newPin
        });

        // Clear the used OTP from memory
        otpStore.delete(email.toLowerCase());

        return res.status(200).json({ success: true, message: 'Security PIN successfully updated in Airtable' });
    } catch (err) {
        console.error('Error in pin-reset-update:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// SECURE BULK PRICE SUBMISSION ENDPOINT
app.post('/api/prices/bulk-submit', async (req, res) => {
    try {
        const { email, pin, updates } = req.body;

        if (!email || !pin || !updates || !Array.isArray(updates)) {
            return res.status(400).json({ success: false, message: 'Missing required fields or invalid updates format.' });
        }

        // 1. Authenticate Shop Manager
        const shops = await base('Shops').select({
            filterByFormula: `{Authorized Email} = '${email}'`,
            maxRecords: 1
        }).firstPage();

        if (shops.length === 0) {
            return res.status(401).json({ success: false, message: 'Unauthorized email address.' });
        }

        const shopRecord = shops[0];
        const storedPin = shopRecord.get('Security PIN');

        if (String(storedPin) !== String(pin)) {
            return res.status(401).json({ success: false, message: 'Invalid security PIN.' });
        }

        // 2. Process and Translate Product IDs to Airtable Record IDs
        const airtablePayload = [];
        for (const item of updates) {
            // Look up the product where the AutoNumber/Product field matches item.productId
            const productsRes = await base('Products').select({
                filterByFormula: `{Product} = '${item.productId}'`,
                maxRecords: 1
            }).firstPage();

            if (productsRes.length === 0) {
                return res.status(400).json({ success: false, message: `Product ID ${item.productId} not found in catalog.` });
            }

            const realProductRecordId = productsRes[0].id; // Internal Airtable record ID

            airtablePayload.push({
                fields: {
                    "Shop": [shopRecord.id],          // Linked Shop record
                    "Product": [realProductRecordId], // Translated linked Product record ID
                    "Price": Number(item.newPrice),         
                    "Updated At": new Date().toISOString()
                }
            });
        }

        // 3. Batch Create Records in Airtable (Handles Airtable's 10-record limit per batch)
        const chunkSize = 10;
        for (let i = 0; i < airtablePayload.length; i += chunkSize) {
            const chunk = airtablePayload.slice(i, i + chunkSize);
            await base('Prices').create(chunk);
        }

        console.log(`[Bulk Price Update Authorized] Manager ${email} successfully updated ${airtablePayload.length} items.`);
        return res.status(200).json({ 
            success: true, 
            message: `Successfully processed ${airtablePayload.length} price updates`, 
            count: airtablePayload.length 
        });

    } catch (error) {
        console.error('Bulk submission error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// =========================================================================
// 6. SERVER LISTEN
// =========================================================================
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
